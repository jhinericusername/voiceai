"""The InterviewRunner — wires Voice I/O, the state machine, the Scorer, the
Probe Generator, timing, and the event log into one score-driven interview.

This is the controller's run loop: it speaks only verbatim/approved text,
drives the state machine, and acts on the Scorer's confidence.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from collections.abc import Awaitable, Callable
from typing import Any

from agent.config import MODELS, SCORING
from agent.controller.decision import decide_next_action
from agent.controller.event_log import EventLog
from agent.controller.machine import InterviewStateMachine
from agent.controller.states import InterviewState
from agent.controller.timing import HUMANE_BOUNDARY_LINE, InterviewClock
from agent.controller.turn_metrics import TurnTimer
from agent.domain.types import Assessment, Rubric, TranscriptTurn
from agent.scoring.io_types import CategoryAssessment, ScorerInput
from agent.scoring.probe import ProbeGenerator, ProbeRequest
from agent.scoring.rollup import roll_up_assessment
from agent.scoring.scorer import Scorer
from agent.worker.backend_status import post_session_event

_INTRO_TEXT = (
    "Hello, and welcome. I'm an AI interviewer. I'll ask a few questions and "
    "may follow up on your answers. Let's begin."
)
_CLOSING_TEXT = "That's everything I wanted to cover. Thank you for your time."


def _join_nonempty(*parts: str) -> str:
    """Join non-empty strings with single spaces. Used to glue transitions in
    front of question verbatim text without leaving leading whitespace when the
    transition is absent."""
    return " ".join(p.strip() for p in parts if p and p.strip())

logger = logging.getLogger(__name__)

ArtifactEmitter = Callable[[dict[str, Any]], Awaitable[None]]


async def _noop_emit(_payload: dict[str, Any]) -> None:
    return None


def _positive_float_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        logger.warning("invalid float environment value", extra={"env_var": name})
        return default
    if value <= 0:
        logger.warning("non-positive float environment value", extra={"env_var": name})
        return default
    return value


def _positive_int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("invalid integer environment value", extra={"env_var": name})
        return default
    if value <= 0:
        logger.warning("non-positive integer environment value", extra={"env_var": name})
        return default
    return value


_ARTIFACT_EMIT_TIMEOUT_SECONDS = _positive_float_env(
    "PUDDLE_ARTIFACT_EMIT_TIMEOUT_SECONDS",
    0.5,
)
_LISTEN_INITIAL_TIMEOUT_SECONDS = _positive_float_env(
    "PUDDLE_LISTEN_INITIAL_TIMEOUT_SECONDS",
    20.0,
)
_LISTEN_REPAIR_TIMEOUT_SECONDS = _positive_float_env(
    "PUDDLE_LISTEN_REPAIR_TIMEOUT_SECONDS",
    12.0,
)
_LISTEN_MAX_REPAIR_ATTEMPTS = _positive_int_env(
    "PUDDLE_LISTEN_MAX_REPAIR_ATTEMPTS",
    2,
)
_AUDIO_REPAIR_LINES = (
    "I'm listening. Please answer out loud when you're ready.",
    (
        "I still can't hear a response. Please check that your microphone is "
        "unmuted, then continue."
    ),
)


class CandidateSilenceTimeoutError(TimeoutError):
    """Raised when a connected candidate remains silent after repair prompts."""


def _log_background_emit_result(kind: str, task: asyncio.Task[None]) -> None:
    try:
        task.result()
    except asyncio.CancelledError:
        logger.warning(
            "artifact emission task was cancelled",
            extra={"artifact_kind": kind},
        )
    except Exception:
        logger.warning(
            "artifact emission failed",
            extra={"artifact_kind": kind},
            exc_info=True,
        )


async def _emit_best_effort(
    kind: str,
    emitter: ArtifactEmitter,
    payload: dict[str, Any],
) -> None:
    task = asyncio.create_task(emitter(payload))
    try:
        await asyncio.wait_for(
            asyncio.shield(task),
            timeout=_ARTIFACT_EMIT_TIMEOUT_SECONDS,
        )
    except TimeoutError:
        task.add_done_callback(lambda done: _log_background_emit_result(kind, done))
        logger.warning(
            "artifact emission timed out",
            extra={
                "artifact_kind": kind,
                "timeout_seconds": _ARTIFACT_EMIT_TIMEOUT_SECONDS,
            },
        )
    except Exception:
        logger.warning(
            "artifact emission failed",
            extra={"artifact_kind": kind},
            exc_info=True,
        )


class InterviewRunner:
    """Runs one full score-driven voice interview to a finalized `Assessment`."""

    def __init__(
        self,
        rubric: Rubric,
        voice: object,
        scorer: Scorer,
        probe_generator: ProbeGenerator,
        event_log: EventLog,
        clock_now: Callable[[], float],
        perception: object | None = None,
        emit_transcript_turn: ArtifactEmitter | None = None,
        emit_agent_event: ArtifactEmitter | None = None,
        emit_score_checkpoint: ArtifactEmitter | None = None,
        candidate_transcript_source: str = "unknown",
    ) -> None:
        self._rubric = rubric
        self._voice = voice
        self._scorer = scorer
        self._probe_generator = probe_generator
        self._event_log = event_log
        self._perception = perception
        self.state_machine = InterviewStateMachine(
            num_questions=len(rubric.questions)
        )
        self._clock = InterviewClock(
            total_cap_seconds=rubric.total_cap_seconds, now=clock_now
        )
        self._transcript: list[TranscriptTurn] = []
        self._turn_index = 0
        self._ack_index = 0
        self._session_id: str | None = None
        self._reconnect_count = 0
        # Emitters are expected to be best-effort and handle backend failures.
        self._emit_transcript_turn = emit_transcript_turn or _noop_emit
        self._emit_agent_event = emit_agent_event or _noop_emit
        self._emit_score_checkpoint = emit_score_checkpoint or _noop_emit
        self._candidate_transcript_source = candidate_transcript_source
        self._agent_event_sequence = 0
        self._score_checkpoint_sequence = 0
        participant_handlers = getattr(voice, "set_participant_state_handlers", None)
        if callable(participant_handlers):
            participant_handlers(
                on_disconnect=self._handle_participant_disconnect,
                on_reconnect=self._handle_participant_reconnect,
                on_reconnect_grace_expired=self._handle_reconnect_grace_expired,
            )

    @property
    def transcript(self) -> list[TranscriptTurn]:
        return list(self._transcript)

    @property
    def event_log(self) -> EventLog:
        return self._event_log

    @property
    def score_checkpoint_count(self) -> int:
        return self._score_checkpoint_sequence

    async def run(self, session_id: str) -> Assessment:
        """Conduct the interview and return the rolled-up `Assessment`."""
        self._session_id = session_id
        logger.info("interview run started", extra={"session_id": session_id})
        self._clock.start()
        self.state_machine.transition(InterviewState.CANDIDATE_JOINED)
        self.state_machine.transition(InterviewState.PREFLIGHT_COMPLETE)
        self.state_machine.transition(InterviewState.CONSENT_CAPTURED)
        self.state_machine.transition(InterviewState.INTRO)
        await self._speak_opener()

        final: dict[str, CategoryAssessment] = {}
        for question in self._rubric.questions:
            logger.info(
                "starting interview question",
                extra={"session_id": session_id, "question_id": question.question_id},
            )
            # First question: transition from INTRO → QUESTION_ASKING.
            # Subsequent questions: advance_question() already set QUESTION_ASKING.
            if self.state_machine.state != InterviewState.QUESTION_ASKING:
                self.state_machine.transition(InterviewState.QUESTION_ASKING)
            self._clock.begin_question(question.soft_budget_seconds)
            await self._speak_question(question)
            assessments = await self._run_question(question)
            for category, assessment in assessments.items():
                final[category] = assessment
            self.state_machine.transition(InterviewState.QUESTION_CLOSED)
            self.state_machine.advance_question()

        await self._speak_closer()
        logger.info("interview run closing", extra={"session_id": session_id})
        integrity_flags: list[str] = (
            self._perception.integrity_flags()  # type: ignore[attr-defined]
            if self._perception is not None
            else []
        )
        return roll_up_assessment(
            session_id=session_id,
            script_version=self._rubric.script_version,
            final_assessments=final,
            integrity_flags=integrity_flags,
            confidence_threshold=SCORING.confidence_threshold,
        )

    def transcript_turns(self) -> list[TranscriptTurn]:
        """Return a copy of the transcript turns captured so far."""
        return list(self._transcript)

    async def _run_question(self, question: object) -> dict[str, CategoryAssessment]:
        """Run the answer/score/probe loop for one base question."""
        targets = list(question.rubric_categories)  # type: ignore[attr-defined]
        probes_used = 0
        latest: dict[str, CategoryAssessment] = {}
        while True:
            self.state_machine.transition(InterviewState.QUESTION_ANSWERING)
            await self._listen(question.question_id)  # type: ignore[attr-defined]
            timer = TurnTimer(question.question_id)  # type: ignore[attr-defined]
            try:
                output = await self._score_behind_ack(question, targets, timer)
                for assessment in output.assessments:
                    latest[assessment.category] = assessment
                score_payload = {
                    "sequence": self._score_checkpoint_sequence,
                    "questionId": question.question_id,  # type: ignore[attr-defined]
                    "model": MODELS.scorer_model,
                    "assessments": [
                        {
                            "category": assessment.category,
                            "provisionalScore": assessment.provisional_score,
                            "confidence": assessment.confidence,
                            "evidenceQuotes": assessment.evidence_quotes,
                            "missingOrAmbiguous": assessment.missing_or_ambiguous,
                        }
                        for assessment in output.assessments
                    ],
                }
                self._score_checkpoint_sequence += 1
                await _emit_best_effort(
                    "score_checkpoint",
                    self._emit_score_checkpoint,
                    score_payload,
                )

                directive = decide_next_action(
                    scorer_output=output,
                    target_categories=targets,
                    confidence_threshold=SCORING.confidence_threshold,
                    probes_used=probes_used,
                    max_probes=question.max_probes,  # type: ignore[attr-defined]
                    time_exhausted=self._clock.must_move_on(),
                )
                if directive.action == "advance":
                    timer.mark("next_prompt_started")
                    if self._clock.must_move_on():
                        await self._say(
                            HUMANE_BOUNDARY_LINE,
                            "TIMEBOX_MOVE_ON",
                            question.question_id,  # type: ignore[attr-defined]
                        )
                    return latest

                self.state_machine.transition(InterviewState.QUESTION_PROBING)
                logger.info(
                    "generating probe",
                    extra={
                        "question_id": question.question_id,  # type: ignore[attr-defined]
                        "category": directive.probe_category,
                    },
                )
                # Snapshot taken after the ack was spoken — probe generation
                # sees the full turn including the agent's acknowledgment
                # (the scorer intentionally sees only up to the answer).
                probe_request = ProbeRequest(
                    category_assessment=latest[directive.probe_category],  # type: ignore[index]
                    transcript=list(self._transcript),
                    probes_used=probes_used,
                    max_probes=question.max_probes,  # type: ignore[attr-defined]
                )
                timer.mark("probe_started")
                # Off the event loop for the same reason as scoring.
                probe_text = await asyncio.to_thread(
                    self._probe_generator.generate, probe_request
                )
                timer.mark("probe_finished")
                probes_used += 1
                timer.mark("next_prompt_started")
                await self._say(
                    probe_text,
                    "PROBE_LOW_CONFIDENCE",
                    question.question_id,  # type: ignore[attr-defined]
                    category=directive.probe_category,
                    missing_element=directive.missing_element,
                )
            finally:
                # Also fires when scoring/probing raises, so latency data has
                # no gaps for failed turns (emit is idempotent).
                timer.emit()

    async def _score_behind_ack(
        self, question: object, targets: list[str], timer: TurnTimer
    ) -> object:
        """Score the just-captured answer concurrently with the spoken ack.

        The Anthropic call runs in a worker thread so the acknowledgment plays
        immediately — and so the LiveKit audio tasks sharing this event loop
        are never starved by a blocking HTTP call. Without configured
        acknowledgments this degrades to awaiting the scorer directly.
        """
        self.state_machine.transition(InterviewState.QUESTION_SCORING)
        logger.info(
            "scoring candidate answer",
            extra={"question_id": question.question_id},  # type: ignore[attr-defined]
        )
        # Snapshot ends at the candidate's answer; the concurrent ack is
        # deliberately not part of what the scorer sees.
        scorer_input = ScorerInput(
            script_version=self._rubric.script_version,
            question_id=question.question_id,  # type: ignore[attr-defined]
            target_categories=targets,
            transcript=list(self._transcript),
        )
        timer.mark("score_started")
        score_task = asyncio.create_task(
            asyncio.to_thread(self._scorer.score, scorer_input)
        )
        try:
            ack = self._next_acknowledgment()
            if ack:
                timer.mark("ack_started")
                await self._say(ack, "ACK", question.question_id)  # type: ignore[attr-defined]
            output = await score_task
        except BaseException:
            # _say can raise (e.g. participant disconnect). Don't leak the
            # scorer task or let its exception go unretrieved; cancelling only
            # detaches the asyncio wrapper — the worker thread itself runs out.
            score_task.cancel()
            raise
        timer.mark("score_finished")
        return output

    async def _speak_opener(self) -> None:
        """Speak the opener block — uses rubric.opener when defined, else the
        legacy _INTRO_TEXT.

        Matches Prakul's real rhythm — greet, pause for the candidate's "good,
        you?" reply, ask the small-talk prompt, pause for the location/weather
        reply, then deliver the longer introduction and pause for the
        "tell me a bit about yourself" answer. The first question's listen
        then captures the answer to its own verbatim. Opener listens are
        tagged with question_id="opener" in the transcript."""
        opener = self._rubric.opener
        if opener is None or not opener.introduction:
            await self._say(_INTRO_TEXT, "INTRO", question_id=None)
            return
        if opener.greeting:
            await self._say(opener.greeting, "INTRO", question_id=None)
            await self._listen("opener")
        if opener.small_talk_prompts:
            await self._say(
                opener.small_talk_prompts[0], "INTRO", question_id=None
            )
            await self._listen("opener")
        await self._say(opener.introduction, "INTRO", question_id=None)
        await self._listen("opener")

    async def _speak_question(self, question: object) -> None:
        """Speak a question's transition_in + verbatim_text as one utterance.
        Includes the pre_question gating ask + branch_no when defined (Q2's
        YC framing trick)."""
        transition_in = getattr(question, "transition_in", "") or ""
        verbatim = question.verbatim_text  # type: ignore[attr-defined]
        question_id = question.question_id  # type: ignore[attr-defined]
        pre = getattr(question, "pre_question", None)
        if pre is not None and pre.ask:
            # Today the controller can't branch on the candidate's yes/no
            # answer here without changing the answer/score loop. Speak the
            # framing inline (the "branch_no" path, which is the common case)
            # so we still get Prakul's verbatim framing.
            text = _join_nonempty(transition_in, pre.ask, pre.branch_no, verbatim)
        else:
            text = _join_nonempty(transition_in, verbatim)
        await self._say(text, "SCRIPTED_QUESTION", question_id)

    async def _speak_closer(self) -> None:
        """Speak the closer block — uses rubric.closer when defined, else the
        legacy _CLOSING_TEXT."""
        closer = self._rubric.closer
        if closer is None or not closer.wrap:
            await self._say(_CLOSING_TEXT, "CLOSING", question_id=None)
            return
        parts: list[str] = []
        if closer.logistics_lead_in:
            parts.append(closer.logistics_lead_in)
        parts.extend(closer.logistics_questions)
        parts.append(closer.wrap)
        await self._say(_join_nonempty(*parts), "CLOSING", question_id=None)

    def _next_acknowledgment(self) -> str:
        """Round-robin through the style.acknowledgments pool. Returns an
        empty string when no style is defined (silently skips ack)."""
        style = self._rubric.style
        if style is None or not style.acknowledgments:
            return ""
        ack = style.acknowledgments[self._ack_index % len(style.acknowledgments)]
        self._ack_index += 1
        return ack

    async def _say(
        self,
        text: str,
        reason_code: str,
        question_id: str | None,
        category: str | None = None,
        missing_element: str | None = None,
    ) -> None:
        """Speak controller-supplied text and log it with its reason code."""
        mode = "closing" if reason_code == "CLOSING" else "scripted"
        if reason_code == "AUDIO_REPAIR":
            mode = "repair"
        logger.info(
            "controller speaking",
            extra={
                "reason_code": reason_code,
                "question_id": question_id,
                "characters": len(text),
            },
        )
        await self._voice.speak(text, mode=mode)  # type: ignore[attr-defined]
        self._event_log.record_utterance(
            utterance=text,
            reason_code=reason_code,
            question_id=question_id,
            category=category,
            missing_element=missing_element,
        )
        self._transcript.append(
            TranscriptTurn(
                turn_index=self._turn_index,
                speaker="agent",
                text=text,
                question_id=question_id,
            )
        )
        self._turn_index += 1
        turn_index = self._turn_index - 1
        transcript_payload = {
            "turnIndex": turn_index,
            "speaker": "agent",
            "text": text,
            "questionId": question_id,
            "source": "agent-controller",
        }
        event_payload = {
            "sequence": self._agent_event_sequence,
            "turnIndex": turn_index,
            "utterance": text,
            "reasonCode": reason_code,
            "questionId": question_id,
            "category": category,
            "missingElement": missing_element,
        }
        self._agent_event_sequence += 1
        await _emit_best_effort(
            "transcript_turn",
            self._emit_transcript_turn,
            transcript_payload,
        )
        await _emit_best_effort(
            "agent_event",
            self._emit_agent_event,
            event_payload,
        )

    def _candidate_is_speaking(self) -> bool:
        """True when the voice layer reports the candidate is mid-utterance
        (VAD). Defensive: any non-VAD voice reports False."""
        probe = getattr(self._voice, "user_is_speaking", None)
        if not callable(probe):
            return False
        try:
            return bool(probe())
        except Exception:
            return False

    async def _listen(self, question_id: str) -> None:
        """Capture one candidate turn into the transcript."""
        repair_attempts = 0
        timeout_seconds = _LISTEN_INITIAL_TIMEOUT_SECONDS
        while True:
            logger.info(
                "controller listening",
                extra={
                    "question_id": question_id,
                    "timeout_seconds": timeout_seconds,
                    "repair_attempts": repair_attempts,
                },
            )
            try:
                result = await asyncio.wait_for(
                    self._voice.listen(),  # type: ignore[attr-defined]
                    timeout=timeout_seconds,
                )
                break
            except TimeoutError as exc:
                if self._candidate_is_speaking():
                    logger.info(
                        "listen timeout while candidate speaking; extending",
                        extra={"question_id": question_id},
                    )
                    timeout_seconds = _LISTEN_REPAIR_TIMEOUT_SECONDS
                    continue
                if repair_attempts >= _LISTEN_MAX_REPAIR_ATTEMPTS:
                    self._mark_incomplete()
                    logger.warning(
                        "candidate silence repair attempts exhausted",
                        extra={
                            "question_id": question_id,
                            "repair_attempts": repair_attempts,
                            "max_repair_attempts": _LISTEN_MAX_REPAIR_ATTEMPTS,
                        },
                    )
                    raise CandidateSilenceTimeoutError(
                        "candidate remained silent after audio repair prompts"
                    ) from exc
                repair_text = _AUDIO_REPAIR_LINES[
                    min(repair_attempts, len(_AUDIO_REPAIR_LINES) - 1)
                ]
                repair_attempts += 1
                logger.info(
                    "candidate silence timeout; speaking audio repair",
                    extra={
                        "question_id": question_id,
                        "repair_attempts": repair_attempts,
                        "timeout_seconds": timeout_seconds,
                    },
                )
                await self._say(repair_text, "AUDIO_REPAIR", question_id)
                timeout_seconds = _LISTEN_REPAIR_TIMEOUT_SECONDS
            except Exception as exc:
                if exc.__class__.__name__ == "ParticipantDisconnectedError":
                    self._mark_incomplete()
                raise

        logger.info(
            "controller received candidate turn",
            extra={"question_id": question_id, "characters": len(result.transcript)},
        )
        self._transcript.append(
            TranscriptTurn(
                turn_index=self._turn_index,
                speaker="candidate",
                text=result.transcript,
                question_id=question_id,
            )
        )
        self._turn_index += 1
        transcript_payload = {
            "turnIndex": self._turn_index - 1,
            "speaker": "candidate",
            "text": result.transcript,
            "questionId": question_id,
            "source": self._candidate_transcript_source_for(result),
        }
        await _emit_best_effort(
            "transcript_turn",
            self._emit_transcript_turn,
            transcript_payload,
        )

    def _candidate_transcript_source_for(self, listen_result: object) -> str:
        result_source = getattr(listen_result, "source", None)
        if isinstance(result_source, str) and result_source.strip():
            return result_source
        return self._candidate_transcript_source

    def _handle_participant_disconnect(self) -> None:
        self._clock.pause_for_disconnect()
        self._schedule_backend_event("candidate_disconnect_started")

    def _handle_participant_reconnect(self) -> None:
        self._clock.resume_after_reconnect()
        self._reconnect_count += 1
        self._schedule_backend_event(
            "candidate_reconnect_within_grace",
            {"reconnect_count": self._reconnect_count},
        )

    def _handle_reconnect_grace_expired(self) -> None:
        self._mark_incomplete()
        self._schedule_backend_event(
            "candidate_reconnect_grace_expired",
            {"reconnect_count": self._reconnect_count},
            status="incomplete",
        )

    def _mark_incomplete(self) -> None:
        if self.state_machine.state == InterviewState.INCOMPLETE:
            return
        with contextlib.suppress(Exception):
            self.state_machine.mark_incomplete()

    def _schedule_backend_event(
        self,
        event_type: str,
        payload: dict[str, object] | None = None,
        *,
        status: str | None = None,
    ) -> None:
        if self._session_id is None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(
            post_session_event(
                self._session_id,
                event_type,
                payload,
                status=status,
            )
        )
