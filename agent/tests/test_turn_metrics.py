import logging

import pytest

from agent.controller.turn_metrics import TurnTimer


def _fake_clock(values: list[float]):
    it = iter(values)
    return lambda: next(it)


def test_turn_timer_records_gaps_relative_to_answer() -> None:
    timer = TurnTimer("q1", now=_fake_clock([10.0, 10.1, 10.2, 13.2, 14.0, 14.5]))
    timer.mark("score_started")  # 10.1
    timer.mark("ack_started")  # 10.2
    timer.mark("score_finished")  # 13.2
    timer.mark("probe_started")  # 14.0
    timer.mark("probe_finished")  # 14.5

    summary = timer.summary()

    assert summary["question_id"] == "q1"
    assert summary["ack_latency_seconds"] == pytest.approx(0.2, abs=1e-6)
    assert summary["score_seconds"] == pytest.approx(3.1, abs=1e-6)
    assert summary["probe_seconds"] == pytest.approx(0.5, abs=1e-6)


def test_turn_timer_missing_marks_are_none() -> None:
    timer = TurnTimer(None, now=_fake_clock([0.0]))

    summary = timer.summary()

    assert summary["question_id"] is None
    assert summary["ack_latency_seconds"] is None
    assert summary["score_seconds"] is None
    assert summary["probe_seconds"] is None
    assert summary["next_prompt_latency_seconds"] is None


def test_turn_timer_emit_logs_one_structured_line(
    caplog: pytest.LogCaptureFixture,
) -> None:
    timer = TurnTimer("q2", now=_fake_clock([0.0, 0.3]))
    timer.mark("ack_started")

    with caplog.at_level(logging.INFO, logger="agent.controller.turn_metrics"):
        summary = timer.emit()

    records = [r for r in caplog.records if r.message == "turn latency"]
    assert len(records) == 1
    assert records[0].turn_latency["question_id"] == "q2"
    assert summary["ack_latency_seconds"] == pytest.approx(0.3, abs=1e-6)
