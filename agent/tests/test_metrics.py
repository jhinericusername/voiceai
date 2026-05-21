from agent.eval.metrics import compute_agreement
from agent.eval.replay import ReplayResult


def _result(interview_id: str, machine: dict[str, int], human: dict[str, int]) -> ReplayResult:
    return ReplayResult(
        interview_id=interview_id, machine_scores=machine, human_scores=human
    )


def test_exact_match_and_within_one() -> None:
    results = [
        _result("a", {"problem_solving": 3}, {"problem_solving": 3}),  # exact
        _result("b", {"problem_solving": 2}, {"problem_solving": 3}),  # within 1
        _result("c", {"problem_solving": 1}, {"problem_solving": 4}),  # off by 3
    ]
    report = compute_agreement(results, pass_threshold_within_one=0.6)
    assert report.exact_match_rate == 1 / 3
    assert report.within_one_rate == 2 / 3


def test_per_category_breakdown_present() -> None:
    results = [
        _result("a", {"agency": 4, "curious": 2}, {"agency": 4, "curious": 2}),
        _result("b", {"agency": 2, "curious": 3}, {"agency": 3, "curious": 1}),
    ]
    report = compute_agreement(results, pass_threshold_within_one=0.6)
    assert "agency" in report.per_category
    assert report.per_category["agency"].exact_match_rate == 0.5
    assert report.per_category["curious"].within_one_rate == 0.5


def test_passes_flag_reflects_threshold() -> None:
    good = [_result("a", {"agency": 3}, {"agency": 3})]
    report = compute_agreement(good, pass_threshold_within_one=0.9)
    assert report.passes is True

    bad = [_result("a", {"agency": 1}, {"agency": 4})]
    report = compute_agreement(bad, pass_threshold_within_one=0.9)
    assert report.passes is False
