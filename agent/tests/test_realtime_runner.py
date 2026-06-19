"""Integration tests for the RealtimeInterviewRunner orchestration core.

Drives a scripted event list through the runner over a FakeRealtimeSession,
with stubbed Scorer / GuardrailMonitor / ProbeGenerator, and asserts the
coverage, scoring-checkpoint, guardrail-correction, and early-close-denial
behaviours the runner is responsible for.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path
from unittest.mock import MagicMock

from agent.config import REALTIME
from agent.controller.event_log import EventLog
from agent.controller.realtime import runner as runner_module
from agent.controller.realtime.guardrail_monitor import GuardrailVerdict
from agent.controller.realtime.runner import RealtimeInterviewRunner
from agent.domain.types import Assessment
from agent.rubric_loader import load_rubric
from agent.scoring.io_types import CategoryAssessment, ScorerOutput
from agent.voice.realtime.interface import (
    FakeRealtimeSession,
    InputTranscript,
    OutputTranscript,
    ToolCall,
)

RUBRIC = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")


def _confident_scorer() -> MagicMock:
    """Scorer stub: every category comes back high-confidence (no steering)."""

    def _score(scorer_input):  # noqa: ANN001, ANN202
        return ScorerOutput(
            assessments=[
                CategoryAssessment(
                    category=cat,
                    provisional_score=3,
                    confidence=0.95,
                    evidence_quotes=["q"],
                    missing_or_ambiguous=[],
                )
                for cat in scorer_input.target_categories
            ]
        )

    scorer = MagicMock()
    scorer.score.side_effect = _score
    return scorer


def _no_violation_guardrail() -> MagicMock:
    monitor = MagicMock()
    monitor.check_turn.return_value = GuardrailVerdict(
        violation=False, kind="none", correction=""
    )
    return monitor


def _stub_probe_generator() -> MagicMock:
    probe = MagicMock()
    probe.generate.return_value = "Tell me a bit more about that."
    return probe


def _clock() -> object:
    """A deterministic, ever-advancing monotonic clock substitute."""
    return iter(float(i) for i in range(0, 100_000, 5)).__next__


def _runner(session: FakeRealtimeSession, event_log: EventLog) -> RealtimeInterviewRunner:
    return RealtimeInterviewRunner(
        rubric=RUBRIC,
        session=session,
        probe_generator=_stub_probe_generator(),
        guardrail_monitor=_no_violation_guardrail(),
        event_log=event_log,
        clock_now=_clock(),
    )


def _happy_script() -> list:
    """Open, then for each of the 4 questions: advance, agent asks, candidate
    answers. End with close_interview."""
    events: list = [OutputTranscript(text="Hello, let's begin.")]
    for i, q in enumerate(RUBRIC.questions):
        events.append(
            ToolCall(
                call_id=f"c{i}",
                name="advance_question",
                arguments={"next_question_id": q.question_id},
            )
        )
        events.append(OutputTranscript(text=q.verbatim_text))
        events.append(InputTranscript(text=f"My answer to {q.question_id}."))
    events.append(ToolCall(call_id="close", name="close_interview", arguments={}))
    return events


async def test_happy_path_covers_all_questions_and_returns_assessment(
    tmp_path: Path,
) -> None:
    session = FakeRealtimeSession(_happy_script())
    event_log = EventLog(session_id="s-happy", path=tmp_path / "events.jsonl")
    runner = _runner(session, event_log)

    assessment = await runner.run(session_id="s-happy")

    # Returns a transcript-only Assessment (no live scoring; backend grades post-hoc).
    assert isinstance(assessment, Assessment)
    assert assessment.session_id == "s-happy"
    # category_scores are empty — scoring happens post-hoc in the backend.
    assert assessment.category_scores == []

    # close_interview was accepted (session was closed) only after coverage.
    assert session.closed is True
    closing = [
        ev for ev in event_log.events() if ev.reason_code == "CLOSING"
    ]
    assert closing, "expected a CLOSING event once all questions were covered"

    # The close tool response was the closer, not a coverage backstop verbatim.
    backstops = [
        ev for ev in event_log.events() if ev.reason_code == "COVERAGE_BACKSTOP"
    ]
    assert backstops == []


async def test_guardrail_violation_injects_correction_and_records_event(
    tmp_path: Path,
) -> None:
    session = FakeRealtimeSession(
        [
            OutputTranscript(text="We guarantee you'll hear back in 24 hours."),
            ToolCall(
                call_id="c0",
                name="advance_question",
                arguments={"next_question_id": RUBRIC.questions[0].question_id},
            ),
            OutputTranscript(text=RUBRIC.questions[0].verbatim_text),
            InputTranscript(text="An answer."),
            *[
                ev
                for i, q in enumerate(RUBRIC.questions[1:], start=1)
                for ev in (
                    ToolCall(
                        call_id=f"c{i}",
                        name="advance_question",
                        arguments={"next_question_id": q.question_id},
                    ),
                    OutputTranscript(text=q.verbatim_text),
                    InputTranscript(text="An answer."),
                )
            ],
            ToolCall(call_id="close", name="close_interview", arguments={}),
        ]
    )
    event_log = EventLog(session_id="s-guard", path=tmp_path / "events.jsonl")

    guardrail = MagicMock()
    correction = "Do not make commitments on behalf of the company."

    def _check(text: str) -> GuardrailVerdict:
        if "guarantee" in text:
            return GuardrailVerdict(
                violation=True, kind="commitment", correction=correction
            )
        return GuardrailVerdict(violation=False, kind="none", correction="")

    guardrail.check_turn.side_effect = _check

    runner = RealtimeInterviewRunner(
        rubric=RUBRIC,
        session=session,
        probe_generator=_stub_probe_generator(),
        guardrail_monitor=guardrail,
        event_log=event_log,
        clock_now=_clock(),
    )

    await runner.run(session_id="s-guard")

    assert correction in session.injections
    guardrail_events = [
        ev for ev in event_log.events() if ev.reason_code == "GUARDRAIL_CORRECTION"
    ]
    assert len(guardrail_events) == 1
    assert guardrail_events[0].utterance == correction


async def test_early_close_is_denied_and_hands_back_missing_question(
    tmp_path: Path,
) -> None:
    # Model answers only q1, then tries to close before covering q2-q4.
    q1 = RUBRIC.questions[0]
    session = FakeRealtimeSession(
        [
            OutputTranscript(text="Hello, let's begin."),
            ToolCall(
                call_id="c0",
                name="advance_question",
                arguments={"next_question_id": q1.question_id},
            ),
            OutputTranscript(text=q1.verbatim_text),
            InputTranscript(text="My only answer."),
            ToolCall(call_id="close", name="close_interview", arguments={}),
        ]
    )
    event_log = EventLog(session_id="s-early", path=tmp_path / "events.jsonl")
    runner = _runner(session, event_log)

    await runner.run(session_id="s-early")

    # The close was denied: a COVERAGE_BACKSTOP was recorded and the missing
    # verbatim handed back via respond_to_tool.
    backstops = [
        ev for ev in event_log.events() if ev.reason_code == "COVERAGE_BACKSTOP"
    ]
    assert len(backstops) == 1
    missing = RUBRIC.questions[1]
    assert backstops[0].utterance == missing.verbatim_text
    assert backstops[0].question_id == missing.question_id

    # The interview did NOT end on the early close: the next-question verbatim
    # was returned to the model as the close tool's result.
    close_response = [
        out for (call_id, out) in session.tool_responses if call_id == "close"
    ]
    assert close_response == [missing.verbatim_text]
    # No CLOSING event since coverage was never completed.
    assert all(ev.reason_code != "CLOSING" for ev in event_log.events())


async def test_session_cap_forces_wrap_up_and_ends_run(
    tmp_path: Path, monkeypatch
) -> None:  # noqa: ANN001
    # An endless stream of agent turns; the time guard must force the run to
    # end once the session cap is exceeded.
    monkeypatch.setattr(
        runner_module,
        "REALTIME",
        dataclasses.replace(REALTIME, max_session_seconds=5.0),
    )

    def _endless() -> object:
        while True:
            yield OutputTranscript(text="Still talking.")

    session = FakeRealtimeSession(list(_iter_take(_endless(), 50)))
    event_log = EventLog(session_id="s-cap", path=tmp_path / "events.jsonl")
    # Clock advances by 5s per call, so the second guard check (t=10) trips the
    # 5s cap.
    runner = RealtimeInterviewRunner(
        rubric=RUBRIC,
        session=session,
        probe_generator=_stub_probe_generator(),
        guardrail_monitor=_no_violation_guardrail(),
        event_log=event_log,
        clock_now=_clock(),
    )

    await runner.run(session_id="s-cap")

    assert "We need to wrap up now." in session.injections
    assert session.closed is True
    # The run ended early — far fewer than 50 turns were logged.
    agent_turns = [t for t in runner.transcript if t.speaker == "agent"]
    assert len(agent_turns) < 50


def _iter_take(it: object, n: int) -> list:  # noqa: ANN001
    out: list = []
    for _ in range(n):
        out.append(next(it))  # type: ignore[call-overload]
    return out


import asyncio  # noqa: E402


def test_candidate_turn_does_not_score_or_steer(tmp_path: Path) -> None:
    """A candidate answer is logged + marks coverage, with NO Anthropic scorer
    call and NO steering injection."""
    session = FakeRealtimeSession(_happy_script())
    event_log = EventLog(session_id="s1", path=tmp_path / "e.jsonl")
    runner = _runner(session, event_log)  # _runner no longer wires a scorer

    assessment = asyncio.run(runner.run("s1"))

    # Every candidate answer appears in the transcript.
    candidate_turns = [t for t in runner.transcript if t.speaker == "candidate"]
    expected_answers = [f"My answer to {q.question_id}." for q in RUBRIC.questions]
    actual_texts = [t.text for t in candidate_turns]
    assert actual_texts == expected_answers

    # Coverage completed: interview reached a normal close (session closed, CLOSING logged).
    assert session.closed is True
    closing_events = [ev for ev in event_log.events() if ev.reason_code == "CLOSING"]
    assert closing_events, "expected a CLOSING event once all questions were covered"

    # No steering injections were made as a result of candidate turns.
    # The no-violation guardrail injects nothing, so session.injections must be empty.
    assert session.injections == [], (
        f"Expected no injections from candidate-turn processing, got: {session.injections}"
    )

    # Assessment is a valid Assessment object.
    assert isinstance(assessment, Assessment)

    # After Task 1 the runner has no scorer — score_checkpoint_count is gone.
    assert not hasattr(runner, "score_checkpoint_count"), (
        "score_checkpoint_count property must be removed after Task 1"
    )
