"""The RealtimeInterviewRunner — orchestration core for realtime interviews.

Unlike the cascade `InterviewRunner`, which drives the conversation turn by
turn, the realtime model runs the conversation autonomously. This runner
consumes the realtime event stream and steers *by exception*:

- it logs every agent and candidate turn into the transcript + event log,
- it runs the guardrail classifier off-loop on each agent turn and injects a
  correction when the turn violates a guardrail,
- it scores each closed Q&A block off-loop and injects a steering nudge when
  the model advanced past a still-low-confidence category,
- it routes the four control tools (advance / probe / off-script / close)
  through the in-path `ControlBus`, which enforces verbatim coverage,
- it owns coverage: each candidate answer marks the current question covered
  so the final question can be covered (the bus does not auto-mark on close),
- it enforces a hard session time cap, and rolls the per-category assessments
  up into a final `Assessment`.

Blocking work (the Anthropic scorer / guardrail / probe calls) runs in worker
threads so the realtime audio event loop is never starved. Artifact emission
is best-effort and never breaks the loop.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable

from agent.config import MODELS, REALTIME, SCORING
from agent.controller.emit import ArtifactEmitter, _emit_best_effort
from agent.controller.event_log import EventLog
from agent.controller.machine import InterviewStateMachine, InvalidTransition
from agent.controller.realtime.control_bus import ControlBus, ToolResult
from agent.controller.realtime.coverage import CoverageTracker
from agent.controller.realtime.guardrail_monitor import GuardrailMonitor
from agent.controller.realtime.plan_builder import build_interview_plan
from agent.controller.realtime.steering import decide_steering
from agent.controller.states import InterviewState
from agent.controller.timing import InterviewClock
from agent.domain.types import Assessment, Question, Rubric, TranscriptTurn
from agent.scoring.io_types import CategoryAssessment, ScorerInput
from agent.scoring.probe import ProbeGenerator, ProbeRequest
from agent.scoring.rollup import roll_up_assessment
from agent.scoring.scorer import Scorer
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
        scorer: Scorer,
        probe_generator: ProbeGenerator,
        guardrail_monitor: GuardrailMonitor,
        event_log: EventLog,
        clock_now: Callable[[], float],
        *,
        emit_transcript_turn: ArtifactEmitter | None = None,
        emit_agent_event: ArtifactEmitter | None = None,
        emit_score_checkpoint: ArtifactEmitter | None = None,
        candidate_transcript_source: str = "realtime",
    ) -> None:
        self._rubric = rubric
        self._session = session
        self._scorer = scorer
        self._probe_generator = probe_generator
        self._guardrail_monitor = guardrail_monitor
        self._event_log = event_log
        self._clock_now = clock_now

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
        self._questions: dict[str, Question] = {
            q.question_id: q for q in rubric.questions
        }

        self._transcript: list[TranscriptTurn] = []
        self._turn_index = 0
        self._current_question_id: str | None = None
        self._probes_used = 0
        self._latest_assessments: dict[str, CategoryAssessment] = {}

        self._emit_transcript_turn = emit_transcript_turn or _noop_emit
        self._emit_agent_event = emit_agent_event or _noop_emit
        self._emit_score_checkpoint = emit_score_checkpoint or _noop_emit
        self._candidate_transcript_source = candidate_transcript_source
        self._agent_event_sequence = 0
        self._score_checkpoint_sequence = 0
        self._ended = False

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def transcript(self) -> list[TranscriptTurn]:
        return list(self._transcript)

    @property
    def event_log(self) -> EventLog:
        return self._event_log

    @property
    def score_checkpoint_count(self) -> int:
        return self._score_checkpoint_sequence

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
        await self._session.aclose()
        logger.info("realtime interview run closing", extra={"session_id": session_id})
        return roll_up_assessment(
            session_id=session_id,
            script_version=self._rubric.script_version,
            final_assessments=self._latest_assessments,
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

        verdict = await asyncio.to_thread(
            self._guardrail_monitor.check_turn, event.text
        )
        if verdict.violation:
            logger.info(
                "guardrail violation; injecting correction",
                extra={"kind": verdict.kind},
            )
            await self._session.inject_message(verdict.correction)
            self._event_log.record_utterance(
                utterance=verdict.correction,
                reason_code="GUARDRAIL_CORRECTION",
                question_id=self._current_question_id,
            )
            await self._emit_agent_event_payload(
                utterance=verdict.correction, reason_code="GUARDRAIL_CORRECTION"
            )

    async def _on_candidate_turn(self, event: InputTranscript) -> None:
        """Log a candidate turn, close its Q&A block, score, and maybe steer."""
        await self._append_turn(
            speaker="candidate",
            text=event.text,
            source=self._candidate_transcript_source,
        )

        scored_question_id = self._current_question_id
        if scored_question_id is None:
            # Candidate spoke before any question was asked (e.g. opener
            # small-talk). Nothing to close or score.
            return

        # Runner-owned coverage signal: the bus does not auto-mark the
        # last-asked question on close, so the final question would otherwise
        # stay uncovered forever. Mark it here when its answer arrives.
        self._coverage.mark_covered(scored_question_id)

        question = self._questions[scored_question_id]
        targets = list(question.rubric_categories)
        output = await asyncio.to_thread(
            self._scorer.score,
            ScorerInput(
                script_version=self._rubric.script_version,
                question_id=scored_question_id,
                target_categories=targets,
                transcript=list(self._transcript),
            ),
        )
        for category, assessment in output.by_category().items():
            self._latest_assessments[category] = assessment
        await self._emit_score_checkpoint_payload(scored_question_id, output)

        # If the model advanced to a new question while scoring ran, steering
        # back is appropriate; if it is still on the same question, let it
        # probe itself.
        already_advanced = self._current_question_id != scored_question_id
        steer = decide_steering(
            scorer_output=output,
            target_categories=targets,
            probes_used=self._probes_used,
            max_probes=question.max_probes,
            already_advanced=already_advanced,
        )
        if steer is not None:
            await self._session.inject_message(steer.text)
            self._event_log.record_utterance(
                utterance=steer.text,
                reason_code="STEER",
                question_id=scored_question_id,
                category=steer.category,
            )
            await self._emit_agent_event_payload(
                utterance=steer.text,
                reason_code="STEER",
                question_id=scored_question_id,
                category=steer.category,
            )

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

    # ------------------------------------------------------------------
    # Probe provider (wired into the ControlBus)
    # ------------------------------------------------------------------

    def _probe_provider(self, category: str) -> str:
        """Build a ProbeRequest from runner state and generate a probe.

        Falls back to a neutral follow-up when the category has not been
        assessed yet (so a request_probe never crashes the interview).
        """
        assessment = self._latest_assessments.get(category)
        if assessment is None:
            return _FALLBACK_PROBE
        max_probes = (
            self._questions[self._current_question_id].max_probes
            if self._current_question_id in self._questions
            else 2
        )
        try:
            probe = self._probe_generator.generate(
                ProbeRequest(
                    category_assessment=assessment,
                    transcript=list(self._transcript),
                    probes_used=self._probes_used,
                    max_probes=max_probes,
                )
            )
        except ValueError:
            # Probe budget exhausted — degrade to a neutral follow-up.
            return _FALLBACK_PROBE
        self._probes_used += 1
        return probe

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

    async def _emit_score_checkpoint_payload(
        self, question_id: str, output: object
    ) -> None:
        """Best-effort emit one score_checkpoint artifact."""
        payload = {
            "sequence": self._score_checkpoint_sequence,
            "questionId": question_id,
            "model": MODELS.scorer_model,
            "assessments": [
                {
                    "category": a.category,
                    "provisionalScore": a.provisional_score,
                    "confidence": a.confidence,
                    "evidenceQuotes": a.evidence_quotes,
                    "missingOrAmbiguous": a.missing_or_ambiguous,
                }
                for a in output.assessments  # type: ignore[attr-defined]
            ],
        }
        self._score_checkpoint_sequence += 1
        await _emit_best_effort(
            "score_checkpoint", self._emit_score_checkpoint, payload
        )
