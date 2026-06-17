from agent.controller.realtime.control_bus import ControlBus
from agent.controller.realtime.coverage import CoverageTracker
from agent.controller.realtime.plan_builder import InterviewPlan, RequiredQuestion

REQ = [RequiredQuestion(question_id=q, verbatim_text=f"V-{q}") for q in ("a", "b", "c")]


def _bus():
    plan = InterviewPlan(instructions="", tool_schemas=[], required_coverage=REQ, closer_text="BYE")
    return ControlBus(plan, CoverageTracker(REQ), probe_provider=lambda c: f"PROBE-{c}",
                      deflection_line="Let's stay on track.")


def test_advance_marks_prev_covered_and_returns_next_verbatim():
    bus = _bus()
    bus._last_asked = "a"                      # a was being answered
    res = bus.advance_question("b")
    assert res.speak == "V-b" and res.reason_code == "REALTIME_QUESTION"
    assert bus._coverage.is_covered("a")


def test_advance_skipping_uncovered_steers_back():
    bus = _bus()
    bus._last_asked = "a"
    res = bus.advance_question("c")            # tries to skip b
    assert res.speak == "V-b" and res.reason_code == "COVERAGE_BACKSTOP"


def test_request_probe_returns_probe_text():
    res = _bus().request_probe("competitiveness")
    assert res.speak == "PROBE-competitiveness" and res.reason_code == "PROBE_LOW_CONFIDENCE"


def test_flag_off_script_returns_deflection():
    res = _bus().flag_off_script("asked comp")
    assert res.speak == "Let's stay on track." and res.reason_code == "GUARDRAIL_CORRECTION"


def test_close_denied_until_all_covered_then_accepted():
    bus = _bus()
    bus._last_asked = "a"; bus.advance_question("b"); bus.advance_question("c")
    bus._last_asked = "c"
    denied = bus.close_interview()             # a,b covered yes; c not yet
    assert denied.reason_code == "COVERAGE_BACKSTOP" and denied.ended is False
    bus._coverage.mark_covered("c")
    ok = bus.close_interview()
    assert ok.ended is True and ok.speak == "BYE" and ok.reason_code == "CLOSING"


def test_advance_unknown_id_while_questions_remain_steers_to_first_uncovered():
    """Off-plan question id with uncovered questions → COVERAGE_BACKSTOP, no exception."""
    bus = _bus()
    # No questions covered yet; "a" is the first uncovered
    res = bus.advance_question("UNKNOWN_ID")
    assert res.reason_code == "COVERAGE_BACKSTOP"
    assert res.speak == "V-a"
    assert res.ended is False


def test_advance_unknown_id_when_all_covered_returns_safe_result():
    """Off-plan question id when all questions are already covered → no exception, ended=False."""
    bus = _bus()
    bus._coverage.mark_covered("a")
    bus._coverage.mark_covered("b")
    bus._coverage.mark_covered("c")
    res = bus.advance_question("UNKNOWN_ID")
    assert res.ended is False
