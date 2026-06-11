"""Per-turn latency instrumentation for the interview controller.

Measures the gaps a candidate actually feels — answer-received → first agent
speech — plus how long scoring and probe generation take. One structured log
line per candidate turn ("turn latency", extra={"turn_latency": {...}}) so the
latency harness can parse worker logs with no new storage dependency.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable

logger = logging.getLogger(__name__)

_GAPS: dict[str, tuple[str, str]] = {
    "ack_latency_seconds": ("answer_received", "ack_started"),
    "score_seconds": ("score_started", "score_finished"),
    "probe_seconds": ("probe_started", "probe_finished"),
    "next_prompt_latency_seconds": ("answer_received", "next_prompt_started"),
}


class TurnTimer:
    """Collects monotonic checkpoints for one candidate turn.

    `answer_received` is marked at construction; the controller marks the rest
    as the turn progresses. Marks may be absent (e.g. no probe) — the summary
    reports None for those gaps.
    """

    def __init__(
        self,
        question_id: str | None,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self._now = now
        self._question_id = question_id
        self._marks: dict[str, float] = {}
        self.mark("answer_received")

    def mark(self, name: str) -> None:
        self._marks[name] = self._now()

    def _gap(self, start: str, end: str) -> float | None:
        if start not in self._marks or end not in self._marks:
            return None
        return self._marks[end] - self._marks[start]

    def summary(self) -> dict[str, float | str | None]:
        result: dict[str, float | str | None] = {"question_id": self._question_id}
        for label, (start, end) in _GAPS.items():
            result[label] = self._gap(start, end)
        return result

    def emit(self) -> dict[str, float | str | None]:
        """Log the turn's latency summary and return it."""
        summary = self.summary()
        logger.info("turn latency", extra={"turn_latency": summary})
        return summary
