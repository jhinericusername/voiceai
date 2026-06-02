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
from collections.abc import Callable

from agent.config import SCORING
from agent.controller.decision import decide_next_action
from agent.controller.event_log import EventLog
from agent.controller.machine import InterviewStateMachine
from agent.controller.states import InterviewState
from agent.controller.timing import HUMANE_BOUNDARY_LINE, InterviewClock
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

logger = logging.getLogger(__name__)


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


_LISTEN_INITIAL_TIMEOUT_SECONDS = _positive_float_env(
    "PUDDLE_LISTEN_INITIAL_TIMEOUT_SECONDS",
    8.0,
)
_LISTEN_REPAIR_TIMEOUT_SECONDS = _positive_float_env(
    "PUDDLE_LISTEN_REPAIR_TIMEOUT_SECONDS",
    12.0,
)
_AUDIO_REPAIR_LINES = (
    "I'm listening. Please answer out loud when you're ready.",
    (
        "I still can't hear a response. Please check that your microphone is "
        "unmuted, then continue."
    ),
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
        self._session_id: str | None = None
        self._reconnect_count = 0
        participant_handlers = getattr(voice, "set_participant_state_handlers", None)
        if callable(participant_handlers):
            participant_handlers(
                on_disconnect=self._handle_participant_disconnect,
                on_reconnect=self._handle_participant_reconnect,
                on_reconnect_grace_expired=self._handle_reconnect_grace_expired,
            )

    async def run(self, session_id: str) -> Assessment:
        """Conduct the interview and return the rolled-up `Assessment`."""
        self._session_id = session_id
        logger.info("interview run started", extra={"session_id": session_id})
        self._clock.start()
        self.state_machine.transition(InterviewState.CANDIDATE_JOINED)
        self.state_machine.transition(InterviewState.PREFLIGHT_COMPLETE)
        self.state_machine.transition(InterviewState.CONSENT_CAPTURED)
        self.state_machine.transition(InterviewState.INTRO)
        await self._say(_INTRO_TEXT, "INTRO", question_id=None)

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
            await self._say(
                question.verbatim_text, "SCRIPTED_QUESTION", question.question_id
            )
            assessments = await self._run_question(question)
            for category, assessment in assessments.items():
                final[category] = assessment
            self.state_machine.transition(InterviewState.QUESTION_CLOSED)
            self.state_machine.advance_question()

        await self._say(_CLOSING_TEXT, "CLOSING", question_id=None)
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

    async def _run_question(self, question: object) -> dict[str, CategoryAssessment]:
        """Run the answer/score/probe loop for one base question."""
        targets = list(question.rubric_categories)  # type: ignore[attr-defined]
        probes_used = 0
        latest: dict[str, CategoryAssessment] = {}
        while True:
            self.state_machine.transition(InterviewState.QUESTION_ANSWERING)
            await self._listen(question.question_id)  # type: ignore[attr-defined]
            self.state_machine.transition(InterviewState.QUESTION_SCORING)
            logger.info(
                "scoring candidate answer",
                extra={"question_id": question.question_id},  # type: ignore[attr-defined]
            )
            output = self._scorer.score(
                ScorerInput(
                    script_version=self._rubric.script_version,
                    question_id=question.question_id,  # type: ignore[attr-defined]
                    target_categories=targets,
                    transcript=list(self._transcript),
                )
            )
            for assessment in output.assessments:
                latest[assessment.category] = assessment

            directive = decide_next_action(
                scorer_output=output,
                target_categories=targets,
                confidence_threshold=SCORING.confidence_threshold,
                probes_used=probes_used,
                max_probes=question.max_probes,  # type: ignore[attr-defined]
                time_exhausted=self._clock.must_move_on(),
            )
            if directive.action == "advance":
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
            probe_text = self._probe_generator.generate(
                ProbeRequest(
                    category_assessment=latest[directive.probe_category],  # type: ignore[index]
                    transcript=list(self._transcript),
                    probes_used=probes_used,
                    max_probes=question.max_probes,  # type: ignore[attr-defined]
                )
            )
            probes_used += 1
            await self._say(
                probe_text,
                "PROBE_LOW_CONFIDENCE",
                question.question_id,  # type: ignore[attr-defined]
                category=directive.probe_category,
                missing_element=directive.missing_element,
            )

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
            except TimeoutError:
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
