import pytest
from pydantic import ValidationError

from agent.domain.types import TranscriptTurn
from agent.scoring.io_types import CategoryAssessment, ScorerInput, ScorerOutput


def test_scorer_input_holds_context() -> None:
    turn = TranscriptTurn(turn_index=0, speaker="candidate", text="hi", question_id="q1")
    si = ScorerInput(
        script_version="pilot-v1",
        question_id="q1",
        target_categories=["problem_solving"],
        transcript=[turn],
    )
    assert si.question_id == "q1"
    assert si.target_categories == ["problem_solving"]


def test_category_assessment_fields_and_ranges() -> None:
    ca = CategoryAssessment(
        category="problem_solving",
        provisional_score=3,
        confidence=0.7,
        evidence_quotes=["I rewrote the scheduler"],
        missing_or_ambiguous=["impact and recognition unclear"],
    )
    assert ca.provisional_score == 3
    with pytest.raises(ValidationError):
        CategoryAssessment(
            category="x", provisional_score=0, confidence=0.5,
            evidence_quotes=[], missing_or_ambiguous=[],
        )
    with pytest.raises(ValidationError):
        CategoryAssessment(
            category="x", provisional_score=2, confidence=1.5,
            evidence_quotes=[], missing_or_ambiguous=[],
        )


def test_scorer_output_keyed_by_category() -> None:
    ca = CategoryAssessment(
        category="agency", provisional_score=2, confidence=0.4,
        evidence_quotes=[], missing_or_ambiguous=["no concrete action described"],
    )
    out = ScorerOutput(assessments=[ca])
    assert out.by_category()["agency"].confidence == 0.4
