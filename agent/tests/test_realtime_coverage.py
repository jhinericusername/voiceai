from agent.controller.realtime.coverage import CoverageTracker
from agent.controller.realtime.plan_builder import RequiredQuestion

REQ = [RequiredQuestion(question_id=q, verbatim_text=f"V {q}") for q in ("a", "b", "c")]


def test_starts_all_uncovered():
    t = CoverageTracker(REQ)
    assert t.all_covered() is False
    assert t.first_uncovered().question_id == "a"


def test_mark_and_first_uncovered_in_order():
    t = CoverageTracker(REQ)
    t.mark_covered("a"); t.mark_covered("c")
    assert t.first_uncovered().question_id == "b"
    assert t.is_covered("a") and not t.is_covered("b")


def test_all_covered_and_status():
    t = CoverageTracker(REQ)
    for q in ("a", "b", "c"):
        t.mark_covered(q)
    assert t.all_covered() and t.first_uncovered() is None
    assert t.status() == [("a", True), ("b", True), ("c", True)]


def test_unknown_id_is_ignored():
    t = CoverageTracker(REQ)
    t.mark_covered("zzz")     # no crash
    assert not t.all_covered()
