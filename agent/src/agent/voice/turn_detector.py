"""Semantic end-of-turn detection, tuned long to respect think-pauses.

Wraps the LiveKit turn-detector plugin's end-of-turn probability and adds a
deterministic minimum-silence gate so the agent never interrupts a candidate
who is still formulating an answer.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class TurnDecision(BaseModel):
    """The detector's decision for the current pause."""

    model_config = ConfigDict(frozen=True)

    end_of_turn: bool
    probability: float
    waited_seconds: float


def build_turn_detector_plugin() -> Any:  # pragma: no cover — vendor wiring
    """Construct the LiveKit turn-detector plugin (English, multilingual model)."""
    from livekit.plugins import turn_detector

    return turn_detector.EOUModel()


class TurnDetector:
    """End-of-turn gate: requires BOTH high EOT probability AND enough silence.

    `min_silence_seconds` is tuned long (default 3.0s) so a think-pause is not
    mistaken for the end of an answer.
    """

    def __init__(
        self, end_of_turn_threshold: float = 0.7, min_silence_seconds: float = 3.0
    ) -> None:
        self._threshold = end_of_turn_threshold
        self._min_silence = min_silence_seconds

    def evaluate(
        self, eot_probability: float, silence_seconds: float
    ) -> TurnDecision:
        """Decide whether the candidate's turn has ended.

        Ends the turn only when the EOT probability clears the threshold AND
        the trailing silence is at least `min_silence_seconds`.
        """
        end_of_turn = (
            eot_probability >= self._threshold
            and silence_seconds >= self._min_silence
        )
        return TurnDecision(
            end_of_turn=end_of_turn,
            probability=eot_probability,
            waited_seconds=silence_seconds,
        )
