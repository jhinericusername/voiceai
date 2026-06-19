"""The RealtimeInterviewRunner — orchestration core for realtime interviews.

Unlike the cascade `InterviewRunner`, which drives the conversation turn by
turn, the realtime model runs the conversation autonomously. This runner
consumes the realtime event stream and steers *by exception*:

- it logs every agent and candidate turn into the transcript + event log,
- it runs the guardrail classifier off-loop on each agent turn and injects a
  correction when the turn violates a guardrail,
- it routes the four control tools (advance / probe / off-script / close)
  through the in-path `ControlBus`, which enforces verbatim coverage,
- it owns coverage: each candidate answer marks the current question covered
  so the final question can be covered (the bus does not auto-mark on close),
- it enforces a hard session time cap, and rolls the transcript into a
  transcript-only `Assessment` (post-hoc scoring happens in the backend).

Blocking work (the guardrail / probe calls) runs in worker threads so the
realtime audio event loop is never starved. Artifact emission is best-effort
and never breaks the loop.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable

from agent.config import REALTIME, SCORING
from agent.controller.emit import ArtifactEmitter, _emit_best_effort
from agent.controller.event_log import EventLog
from agent.controller.machine import InterviewStateMachine, InvalidTransition
from agent.controller.realtime.control_bus import ControlBus, ToolResult
from agent.controller.realtime.coverage import CoverageTracker
from agent.controller.realtime.guardrail_monitor import GuardrailMonitor
from agent.controller.realtime.plan_builder import build_interview_plan
from agent.controller.states import InterviewState
from agent.controller.timing import InterviewClock
from agent.domain.types import Assessment, Question, Rubric, TranscriptTurn
from agent.scoring.rollup import roll_up_assessment
from agent.voice.realtime.interface import (
    InputTranscript,
    OutputTranscript,
    RealtimeSession,
    ToolCall,
)

logger = logging.getLogger(__name__)

_FALLBACK_PROBE = "Could you tell me a little more about that?"
_WRAP_UP_LINE = "We need to wrap up now."


async def _noop_emit(_payload: dict[str, object]) -> None:
    return None


class RealtimeInterviewRunner:
    """Runs one realtime interview to a finalized `Assessment`."""

    def __init__(
        self,
        rubric: Rubric,
        session: RealtimeSession,
        guardrail_monitor: GuardrailMonitor,
        event_log: EventLog,
        clock_now: Callable[[], float],
        *,
        emit_transcript_turn: ArtifactEmitter | None = None,
        emit_agent_event: ArtifactEmitter | None = None,
        candidate_transcript_source: str = "realtime",
    ) -> None:
        self._rubric = rubric
        self._session = session
        self._guardrail_monitor = guardrail_monitor
        self._event_log = event_log
        self._clock_now = clock_now
        self._questions: dict[str, Question] = {
            q.question_id: q for q in rubric.questions
        }
        self._probe_cursor: dict[str, int] = {}

        self._plan = build_interview_plan(rubric)
        self._coverage = CoverageTracker(self._plan.required_coverage)
        self._bus = ControlBus(
            self._plan,
            self._coverage,
            probe_provider=self._probe_provider,
            deflection_line=(
                "That's not something I can get into here — let's keep going."
            ),
        )
        self._clock = InterviewClock(
            total_cap_seconds=rubric.total_cap_seconds, now=clock_now
        )
        self._state_machine = InterviewStateMachine(
            num_questions=len(rubric.questions)
        )
        self._transcript: list[TranscriptTurn] = []
        self._turn_index = 0
        self._current_question_id: str | None = None

        self._emit_transcript_turn = emit_transcript_turn or _noop_emit
        self._emit_agent_event = emit_agent_event or _noop_emit
        self._candidate_transcript_source = candidate_transcript_source
        self._agent_event_sequence = 0
        self._ended = False
        self._bg_tasks: set[asyncio.Task] = set()

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def transcript(self) -> list[TranscriptTurn]:
        return list(self._transcript)

    @property
    def event_log(self) -> EventLog:
        return self._event_log

    # ------------------------------------------------------------------
    # Run loop
    # ------------------------------------------------------------------

    async def run(self, session_id: str) -> Assessment:
        """Consume the realtime event stream and return the `Assessment`."""
        logger.info("realtime interview run started", extra={"session_id": session_id})
        start = self._clock_now()
        self._clock.start()
        self._enter(InterviewState.CANDIDATE_JOINED)
        self._enter(InterviewState.PREFLIGHT_COMPLETE)
        self._enter(InterviewState.CONSENT_CAPTURED)
        self._enter(InterviewState.INTRO)

        await self._session.start(
            instructions=self._plan.instructions, tools=self._plan.tool_schemas
        )

        async for event in self._session.events():
            if isinstance(event, OutputTranscript):
                await self._on_agent_turn(event)
            elif isinstance(event, InputTranscript):
                await self._on_candidate_turn(event)
            elif isinstance(event, ToolCall):
                await self._on_tool_call(event)

            if self._ended:
                break

            if self._clock_now() - start > REALTIME.max_session_seconds:
                await self._force_wrap_up()
                if self._ended:
                    break

        self._enter(InterviewState.CLOSING)
        await self._drain_background()
        await self._session.aclose()
        logger.info("realtime interview run closing", extra={"session_id": session_id})
        return roll_up_assessment(
            session_id=session_id,
            script_version=self._rubric.script_version,
            final_assessments={},
            integrity_flags=[],
            confidence_threshold=SCORING.confidence_threshold,
        )

    # ------------------------------------------------------------------
    # Event handlers
    # ------------------------------------------------------------------

    async def _on_agent_turn(self, event: OutputTranscript) -> None:
        """Log an agent turn, emit it, and run the guardrail check off-loop."""
        await self._append_turn(
            speaker="agent",
            text=event.text,
            source="agent-controller",
        )
        self._event_log.record_utterance(
            utterance=event.text,
            reason_code="REALTIME_QUESTION",
            question_id=self._current_question_id,
        )
        await self._emit_agent_event_payload(
            utterance=event.text, reason_code="REALTIME_QUESTION"
        )

        task = asyncio.create_task(self._run_guardrail(event.text))
        self._bg_tasks.add(task)
        task.add_done_callback(self._bg_tasks.discard)

    async def _on_candidate_turn(self, event: InputTranscript) -> None:
        """Log a candidate turn and mark its question covered. No live scoring."""
        await self._append_turn(
            speaker="candidate",
            text=event.text,
            source=self._candidate_transcript_source,
        )
        scored_question_id = self._current_question_id
        if scored_question_id is None:
            # Candidate spoke before any question was asked (opener small-talk).
            return
        # Runner-owned coverage signal: the bus does not auto-mark the last-asked
        # question on close, so mark it here when its answer arrives.
        self._coverage.mark_covered(scored_question_id)

    async def _on_tool_call(self, event: ToolCall) -> None:
        """Dispatch a control tool through the bus and reply to the session."""
        result = await asyncio.to_thread(self._dispatch_tool, event)
        await self._session.respond_to_tool(event.call_id, result.speak)
        self._event_log.record_utterance(
            utterance=result.speak,
            reason_code=result.reason_code,
            question_id=result.question_id,
            category=result.category,
        )
        await self._emit_agent_event_payload(
            utterance=result.speak,
            reason_code=result.reason_code,
            question_id=result.question_id,
            category=result.category,
        )
        if result.question_id is not None:
            self._current_question_id = result.question_id
            self._enter(InterviewState.QUESTION_ASKING)
        if result.ended:
            self._ended = True

    def _dispatch_tool(self, event: ToolCall) -> ToolResult:
        """Run the matching ControlBus handler (sync; called via to_thread)."""
        args = event.arguments
        if event.name == "advance_question":
            return self._bus.advance_question(str(args["next_question_id"]))
        if event.name == "request_probe":
            return self._bus.request_probe(str(args["category"]))
        if event.name == "flag_off_script":
            return self._bus.flag_off_script(str(args.get("reason", "")))
        if event.name == "close_interview":
            return self._bus.close_interview()
        logger.warning("unknown realtime tool call", extra={"tool": event.name})
        return ToolResult(
            speak=self._plan.closer_text,
            reason_code="REALTIME_QUESTION",
        )

    async def _force_wrap_up(self) -> None:
        """Hit the session cap: announce the wrap and close through the bus."""
        logger.warning("realtime session cap reached; forcing wrap-up")
        await self._session.inject_message(_WRAP_UP_LINE)
        result = self._bus.close_interview()
        await self._session.respond_to_tool("time-guard-close", result.speak)
        self._event_log.record_utterance(
            utterance=result.speak,
            reason_code=result.reason_code,
            question_id=result.question_id,
            category=result.category,
        )
        await self._emit_agent_event_payload(
            utterance=result.speak,
            reason_code=result.reason_code,
            question_id=result.question_id,
            category=result.category,
        )
        # Force the loop to end regardless of remaining coverage: the cap is a
        # hard server-side boundary.
        self._ended = True

    async def _run_guardrail(self, agent_text: str) -> None:
        """Off-path guardrail check: log + inject a next-turn correction."""
        verdict = await asyncio.to_thread(self._guardrail_monitor.check_turn, agent_text)
        if not verdict.violation:
            return
        logger.info("guardrail violation (non-blocking)", extra={"kind": verdict.kind})
        with contextlib.suppress(Exception):
            await self._session.inject_message(verdict.correction)
        self._event_log.record_utterance(
            utterance=verdict.correction,
            reason_code="GUARDRAIL_CORRECTION",
            question_id=self._current_question_id,
        )
        await self._emit_agent_event_payload(
            utterance=verdict.correction, reason_code="GUARDRAIL_CORRECTION"
        )

    async def _drain_background(self) -> None:
        """Await any in-flight background guardrail tasks (shutdown/tests)."""
        if self._bg_tasks:
            await asyncio.gather(*list(self._bg_tasks), return_exceptions=True)

    # ------------------------------------------------------------------
    # Probe provider (wired into the ControlBus)
    # ------------------------------------------------------------------

    def _probe_provider(self, category: str) -> str:
        """Serve the current question's scripted probes in order; neutral
        fallback when the pool is exhausted. No model call."""
        qid = self._current_question_id
        question = self._questions.get(qid) if qid else None
        if question is None or not question.scripted_probes:
            return _FALLBACK_PROBE
        idx = self._probe_cursor.get(qid, 0)
        if idx >= len(question.scripted_probes):
            return _FALLBACK_PROBE
        self._probe_cursor[qid] = idx + 1
        return question.scripted_probes[idx]

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _enter(self, state: InterviewState) -> None:
        """Best-effort state-machine transition.

        The realtime flow is autonomous and does not follow the cascade's
        strict per-question table; transitions are advisory here, so an
        invalid one is suppressed rather than crashing the interview.
        """
        with contextlib.suppress(InvalidTransition):
            self._state_machine.transition(state)

    async def _append_turn(self, speaker: str, text: str, source: str) -> None:
        """Append a turn to the transcript and best-effort emit it."""
        turn_index = self._turn_index
        self._transcript.append(
            TranscriptTurn(
                turn_index=turn_index,
                speaker=speaker,  # type: ignore[arg-type]  # validated Literal
                text=text,
                question_id=self._current_question_id,
            )
        )
        self._turn_index += 1
        await _emit_best_effort(
            "transcript_turn",
            self._emit_transcript_turn,
            {
                "turnIndex": turn_index,
                "speaker": speaker,
                "text": text,
                "questionId": self._current_question_id,
                "source": source,
            },
        )

    async def _emit_agent_event_payload(
        self,
        utterance: str,
        reason_code: str,
        question_id: str | None = "__current__",
        category: str | None = None,
    ) -> None:
        """Best-effort emit one agent_event artifact."""
        qid = self._current_question_id if question_id == "__current__" else question_id
        payload = {
            "sequence": self._agent_event_sequence,
            "utterance": utterance,
            "reasonCode": reason_code,
            "questionId": qid,
            "category": category,
            "missingElement": None,
        }
        self._agent_event_sequence += 1
        await _emit_best_effort("agent_event", self._emit_agent_event, payload)

