"""Tests for decide_steering — steering-by-exception over decide_next_action."""

from __future__ import annotations

import pytest

from agent.scoring.io_types import CategoryAssessment, ScorerOutput


def _assessment(cat: str, conf: float) -> CategoryAssessment:
    return CategoryAssessment(
        category=cat,
        provisional_score=3,
        confidence=conf,
        evidence_quotes=["q"],
        missing_or_ambiguous=[] if conf >= 0.75 else ["impact unclear"],
    )


def test_advance_directive_returns_none() -> None:
    """When all targets are high-confidence, decide_steering returns None."""
    from agent.controller.realtime.steering import decide_steering

    output = ScorerOutput(assessments=[_assessment("problem_solving", 0.9)])
    result = decide_steering(
        scorer_output=output,
        target_categories=["problem_solving"],
        probes_used=0,
        max_probes=2,
        already_advanced=True,
    )
    assert result is None


def test_probe_directive_not_advanced_returns_none() -> None:
    """When probe is warranted but model hasn't advanced yet, return None."""
    from agent.controller.realtime.steering import decide_steering

    output = ScorerOutput(assessments=[_assessment("agency", 0.4)])
    result = decide_steering(
        scorer_output=output,
        target_categories=["agency"],
        probes_used=0,
        max_probes=2,
        already_advanced=False,
    )
    assert result is None


def test_probe_directive_already_advanced_returns_steer_message() -> None:
    """When probe is warranted and model already advanced, return SteerMessage."""
    from agent.controller.realtime.steering import SteerMessage, decide_steering

    output = ScorerOutput(assessments=[_assessment("agency", 0.4)])
    result = decide_steering(
        scorer_output=output,
        target_categories=["agency"],
        probes_used=0,
        max_probes=2,
        already_advanced=True,
    )
    assert isinstance(result, SteerMessage)
    assert result.category == "agency"
    assert "agency" in result.text


def test_steer_message_is_immutable() -> None:
    """SteerMessage is frozen — attribute assignment raises."""
    from agent.controller.realtime.steering import SteerMessage

    msg = SteerMessage(text="dig deeper on foo", category="foo")
    with pytest.raises(Exception):
        msg.text = "mutated"  # type: ignore[misc]
