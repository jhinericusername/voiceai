from agent.scoring.io_types import CategoryAssessment
from agent.scoring.rollup import meets_bare_minimum, roll_up_assessment


def _ca(cat: str, score: int, conf: float) -> CategoryAssessment:
    return CategoryAssessment(
        category=cat, provisional_score=score, confidence=conf,
        evidence_quotes=["q"], missing_or_ambiguous=[],
    )


def test_meets_bare_minimum_true_when_one_4_and_ps_ge_3() -> None:
    scores = {"problem_solving": 3, "agency": 4, "competitiveness": 2, "curious": 1}
    assert meets_bare_minimum(scores) is True


def test_meets_bare_minimum_false_without_a_4() -> None:
    scores = {"problem_solving": 3, "agency": 3, "competitiveness": 3, "curious": 3}
    assert meets_bare_minimum(scores) is False


def test_meets_bare_minimum_false_when_ps_below_3() -> None:
    scores = {"problem_solving": 2, "agency": 4, "competitiveness": 1, "curious": 1}
    assert meets_bare_minimum(scores) is False


def test_roll_up_builds_assessment_with_low_confidence_flags() -> None:
    final = {
        "problem_solving": _ca("problem_solving", 4, 0.9),
        "agency": _ca("agency", 3, 0.55),
        "competitiveness": _ca("competitiveness", 2, 0.8),
        "curious": _ca("curious", 1, 0.85),
    }
    assessment = roll_up_assessment(
        session_id="s1", script_version="pilot-v1",
        final_assessments=final, integrity_flags=["multiple_faces"],
        confidence_threshold=0.75,
    )
    assert assessment.meets_bare_minimum is True  # PS=4 satisfies both clauses
    by_cat = {cs.category: cs for cs in assessment.category_scores}
    assert by_cat["agency"].low_confidence is True
    assert by_cat["problem_solving"].low_confidence is False
    assert assessment.integrity_flags == ["multiple_faces"]
