"""Turn-hint tracking — a non-binding signal that the candidate is mid-thought.

The Video Perception Pipeline reports `still_formulating`; this tracker holds
the latest such observation so the controller's turn detector can treat a
think-pause more patiently. It is a hint only — never a hard turn decision.
"""

from __future__ import annotations


class TurnHintTracker:
    """Holds the most recent turn hint within a freshness window."""

    def __init__(self, freshness_seconds: float = 2.0) -> None:
        self._freshness = freshness_seconds
        self._formulating = False
        self._observed_at: float | None = None

    def observe(self, still_formulating: bool, timestamp_seconds: float) -> None:
        """Record a fresh turn-hint observation from the VLM."""
        self._formulating = still_formulating
        self._observed_at = timestamp_seconds

    def candidate_likely_formulating(
        self, now_seconds: float | None = None
    ) -> bool:
        """True if a fresh observation says the candidate is still formulating.

        A hint older than `freshness_seconds` (when `now_seconds` is given) is
        treated as stale and ignored.
        """
        if not self._formulating or self._observed_at is None:
            return False
        if now_seconds is not None:
            if now_seconds - self._observed_at > self._freshness:
                return False
        return True
