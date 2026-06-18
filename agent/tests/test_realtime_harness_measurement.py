"""Unit tests for agent.eval.realtime.harness.measure().

Pure / deterministic — no network, no live API.  All cases use synthetic
``InterviewPlan`` and ``TranscriptTurn`` objects constructed directly.

TDD: these tests were written BEFORE the implementation (RED phase).
"""

from __future__ import annotations

from agent.controller.realtime.plan_builder import InterviewPlan, RequiredQuestion
from agent.domain.types import TranscriptTurn
from agent.eval.realtime.harness import measure


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _plan(*question_pairs: tuple[str, str]) -> InterviewPlan:
    """Build a minimal InterviewPlan with the given (question_id, verbatim_text) pairs."""
    return InterviewPlan(
        instructions="test",
        tool_schemas=[],
        required_coverage=[
            RequiredQuestion(question_id=qid, verbatim_text=text)
            for qid, text in question_pairs
        ],
        closer_text="thanks",
    )


def _agent(turn_index: int, text: str, question_id: str | None = None) -> TranscriptTurn:
    return TranscriptTurn(
        turn_index=turn_index,
        speaker="agent",
        text=text,
        question_id=question_id,
    )


def _candidate(turn_index: int, text: str) -> TranscriptTurn:
    return TranscriptTurn(
        turn_index=turn_index,
        speaker="candidate",
        text=text,
        question_id=None,
    )


# ---------------------------------------------------------------------------
# Test: 2-of-3 questions asked verbatim, out of script order
# ---------------------------------------------------------------------------


def test_two_of_three_out_of_order() -> None:
    """2/3 questions present verbatim but in reverse order → coverage=2, in_order=False."""
    q1_text = "Can you walk me through your background in software engineering?"
    q2_text = "Tell me about a time you resolved a difficult technical disagreement."
    q3_text = "What does clean code mean to you?"

    plan = _plan(("q1", q1_text), ("q2", q2_text), ("q3", q3_text))

    # Agent asks q3 first (index 0), then q1 (index 4) — out of script order.
    transcript = [
        _agent(0, q3_text, "q3"),
        _candidate(1, "Clean code means readable and maintainable code."),
        _agent(2, "Thanks! Let's move on."),
        _candidate(3, "Sure."),
        _agent(4, q1_text, "q1"),
        _candidate(5, "I've been a software engineer for five years."),
    ]

    result = measure(transcript, plan, guardrail_events=[], duration_seconds=120.0)

    assert result.coverage_count == 2
    assert result.total_required == 3
    assert result.in_order is False

    # Verbatim matches should be ~1.0 for asked questions.
    assert result.per_question_similarity["q1"] >= 0.99
    assert result.per_question_similarity["q3"] >= 0.99

    # q2 was never asked — similarity should be low.
    assert result.per_question_similarity["q2"] < 0.5

    # Pass-throughs.
    assert result.guardrail_violations == []
    assert result.duration_seconds == 120.0


# ---------------------------------------------------------------------------
# Test: full coverage in order
# ---------------------------------------------------------------------------


def test_full_coverage_in_order() -> None:
    """All 3 questions asked in script order → coverage=3, in_order=True."""
    q1_text = "Can you walk me through your background in software engineering?"
    q2_text = "Tell me about a time you resolved a difficult technical disagreement."
    q3_text = "What does clean code mean to you?"

    plan = _plan(("q1", q1_text), ("q2", q2_text), ("q3", q3_text))

    transcript = [
        _agent(0, q1_text, "q1"),
        _candidate(1, "I've been a software engineer for five years."),
        _agent(2, q2_text, "q2"),
        _candidate(3, "I once had a disagreement about the ORM layer."),
        _agent(4, q3_text, "q3"),
        _candidate(5, "Clean code is readable and well-tested."),
    ]

    result = measure(transcript, plan, guardrail_events=[], duration_seconds=300.0)

    assert result.coverage_count == 3
    assert result.total_required == 3
    assert result.in_order is True
    assert result.per_question_similarity["q1"] >= 0.99
    assert result.per_question_similarity["q2"] >= 0.99
    assert result.per_question_similarity["q3"] >= 0.99
    assert result.guardrail_violations == []
    assert result.duration_seconds == 300.0


# ---------------------------------------------------------------------------
# Test: guardrail_violations + duration_seconds pass-through
# ---------------------------------------------------------------------------


def test_guardrail_and_duration_passthrough() -> None:
    """guardrail_violations and duration_seconds are forwarded verbatim."""
    plan = _plan(("q1", "Tell me about yourself."))
    transcript = [_agent(0, "Tell me about yourself.")]

    violations = ["discussed compensation", "revealed score"]
    result = measure(
        transcript,
        plan,
        guardrail_events=violations,
        duration_seconds=42.5,
    )

    assert result.guardrail_violations == violations
    assert result.duration_seconds == 42.5


# ---------------------------------------------------------------------------
# Test: empty transcript → zero coverage, in_order vacuously True
# ---------------------------------------------------------------------------


def test_empty_transcript_zero_coverage() -> None:
    """No agent turns → coverage_count=0, all similarities are low."""
    plan = _plan(("q1", "Tell me about yourself."), ("q2", "What are your strengths?"))
    result = measure([], plan, guardrail_events=[], duration_seconds=0.0)

    assert result.coverage_count == 0
    assert result.total_required == 2
    # in_order is vacuously True (no covered questions to be out of order).
    assert result.in_order is True
    for sim in result.per_question_similarity.values():
        assert sim < 0.5


# ---------------------------------------------------------------------------
# Test: single question, asked exactly once → coverage=1, in_order=True
# ---------------------------------------------------------------------------


def test_single_question_exact_match() -> None:
    verbatim = "Walk me through the last production incident you owned end to end."
    plan = _plan(("q1", verbatim))
    transcript = [_agent(0, verbatim)]

    result = measure(transcript, plan, guardrail_events=[], duration_seconds=60.0)

    assert result.coverage_count == 1
    assert result.total_required == 1
    assert result.in_order is True
    assert result.per_question_similarity["q1"] >= 0.99
