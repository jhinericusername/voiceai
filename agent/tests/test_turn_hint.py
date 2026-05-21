from agent.video.turn_hint import TurnHintTracker


def test_no_hint_before_any_observation() -> None:
    tracker = TurnHintTracker()
    assert tracker.candidate_likely_formulating() is False


def test_hint_active_after_still_formulating_observation() -> None:
    tracker = TurnHintTracker()
    tracker.observe(still_formulating=True, timestamp_seconds=10.0)
    assert tracker.candidate_likely_formulating() is True


def test_hint_clears_after_finished_observation() -> None:
    tracker = TurnHintTracker()
    tracker.observe(still_formulating=True, timestamp_seconds=10.0)
    tracker.observe(still_formulating=False, timestamp_seconds=11.0)
    assert tracker.candidate_likely_formulating() is False


def test_hint_is_stale_after_freshness_window() -> None:
    # A hint older than the freshness window is no longer trusted.
    tracker = TurnHintTracker(freshness_seconds=2.0)
    tracker.observe(still_formulating=True, timestamp_seconds=10.0)
    assert tracker.candidate_likely_formulating(now_seconds=10.5) is True
    assert tracker.candidate_likely_formulating(now_seconds=13.0) is False
