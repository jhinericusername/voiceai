import pytest

from agent.controller.timing import HUMANE_BOUNDARY_LINE, InterviewClock


def test_clock_reports_remaining_against_total_cap() -> None:
    clock = InterviewClock(total_cap_seconds=1800.0, now=lambda: 0.0)
    clock.start()
    clock._now = lambda: 600.0  # 10 minutes elapsed
    assert clock.elapsed_seconds() == 600.0
    assert clock.remaining_seconds() == 1200.0
    assert clock.total_cap_exceeded() is False


def test_total_cap_exceeded_when_clock_runs_out() -> None:
    clock = InterviewClock(total_cap_seconds=1800.0, now=lambda: 0.0)
    clock.start()
    clock._now = lambda: 1900.0
    assert clock.total_cap_exceeded() is True
    assert clock.remaining_seconds() == 0.0


def test_soft_budget_overrun_is_advisory_not_hard() -> None:
    clock = InterviewClock(total_cap_seconds=1800.0, now=lambda: 0.0)
    clock.start()
    clock.begin_question(soft_budget_seconds=180.0)
    clock._now = lambda: 200.0  # 20s over the soft budget
    assert clock.soft_budget_exceeded() is True
    # Soft overrun does not by itself force a stop while total time remains.
    assert clock.must_move_on() is False


def test_must_move_on_when_total_cap_reached() -> None:
    clock = InterviewClock(total_cap_seconds=300.0, now=lambda: 0.0)
    clock.start()
    clock.begin_question(soft_budget_seconds=180.0)
    clock._now = lambda: 305.0
    assert clock.must_move_on() is True


def test_disconnect_pause_excludes_downtime_from_elapsed() -> None:
    times = iter([0.0, 100.0, 250.0, 250.0])
    clock = InterviewClock(total_cap_seconds=1800.0, now=lambda: next(times))
    clock.start()  # t=0
    clock.pause_for_disconnect()  # t=100 -> 100s counted so far
    clock.resume_after_reconnect()  # t=250 -> 150s downtime excluded
    clock._now = lambda: 250.0
    assert clock.elapsed_seconds() == 100.0  # downtime not counted


def test_humane_boundary_line_is_the_scripted_text() -> None:
    assert HUMANE_BOUNDARY_LINE == (
        "Thank you — I'm going to move on so we cover everything."
    )
