from agent.controller.decision import decide_next_action
from agent.scoring.io_types import CategoryAssessment, ScorerOutput


def _assessment(cat: str, conf: float) -> CategoryAssessment:
    return CategoryAssessment(
        category=cat, provisional_score=3, confidence=conf,
        evidence_quotes=["q"],
        missing_or_ambiguous=[] if conf >= 0.75 else ["impact unclear"],
    )


def test_advance_when_all_targets_confident() -> None:
    output = ScorerOutput(assessments=[_assessment("problem_solving", 0.9)])
    directive = decide_next_action(
        scorer_output=output,
        target_categories=["problem_solving"],
        confidence_threshold=0.75,
        probes_used=0,
        max_probes=2,
        time_exhausted=False,
    )
    assert directive.action == "advance"


def test_probe_when_a_target_is_low_confidence() -> None:
    output = ScorerOutput(assessments=[_assessment("agency", 0.4)])
    directive = decide_next_action(
        scorer_output=output,
        target_categories=["agency"],
        confidence_threshold=0.75,
        probes_used=0,
        max_probes=2,
        time_exhausted=False,
    )
    assert directive.action == "probe"
    assert directive.probe_category == "agency"
    assert directive.missing_element == "impact unclear"


def test_advance_when_probe_budget_exhausted_even_if_low_confidence() -> None:
    output = ScorerOutput(assessments=[_assessment("agency", 0.3)])
    directive = decide_next_action(
        scorer_output=output,
        target_categories=["agency"],
        confidence_threshold=0.75,
        probes_used=2,
        max_probes=2,
        time_exhausted=False,
    )
    assert directive.action == "advance"
    assert directive.probe_category is None


def test_advance_when_time_exhausted_even_if_low_confidence() -> None:
    output = ScorerOutput(assessments=[_assessment("curious", 0.2)])
    directive = decide_next_action(
        scorer_output=output,
        target_categories=["curious"],
        confidence_threshold=0.75,
        probes_used=0,
        max_probes=2,
        time_exhausted=True,
    )
    assert directive.action == "advance"


def test_probes_lowest_confidence_target_first() -> None:
    output = ScorerOutput(
        assessments=[_assessment("agency", 0.6), _assessment("curious", 0.2)]
    )
    directive = decide_next_action(
        scorer_output=output,
        target_categories=["agency", "curious"],
        confidence_threshold=0.75,
        probes_used=0,
        max_probes=2,
        time_exhausted=False,
    )
    assert directive.probe_category == "curious"  # lowest confidence first
