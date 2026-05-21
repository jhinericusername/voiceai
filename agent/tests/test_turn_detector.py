
from agent.voice.turn_detector import TurnDecision, TurnDetector


def test_turn_decision_fields() -> None:
    d = TurnDecision(end_of_turn=True, probability=0.92, waited_seconds=1.4)
    assert d.end_of_turn is True
    assert d.probability == 0.92


def test_detector_waits_through_think_pause() -> None:
    # Tuned long: a 2.0s pause below the think-pause window is NOT end of turn.
    detector = TurnDetector(end_of_turn_threshold=0.7, min_silence_seconds=3.0)
    decision = detector.evaluate(eot_probability=0.8, silence_seconds=2.0)
    assert decision.end_of_turn is False  # silence too short despite high prob


def test_detector_ends_turn_when_silence_and_probability_clear() -> None:
    detector = TurnDetector(end_of_turn_threshold=0.7, min_silence_seconds=3.0)
    decision = detector.evaluate(eot_probability=0.85, silence_seconds=3.2)
    assert decision.end_of_turn is True
    assert decision.waited_seconds == 3.2


def test_detector_holds_when_probability_low() -> None:
    detector = TurnDetector(end_of_turn_threshold=0.7, min_silence_seconds=3.0)
    decision = detector.evaluate(eot_probability=0.4, silence_seconds=5.0)
    assert decision.end_of_turn is False  # model thinks candidate continues
