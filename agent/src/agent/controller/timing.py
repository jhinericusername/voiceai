"""Server-enforced interview timing: total cap, soft per-question budgets.

The total cap is hard and server-enforced; per-question budgets are soft and
advisory. Disconnection time is excluded from the elapsed clock up to the
caller's reconnect cap. Near a hard stop the controller speaks a scripted
humane boundary line.
"""

from __future__ import annotations

from collections.abc import Callable

# The single scripted boundary line — spoken verbatim, logged TIMEBOX_MOVE_ON.
HUMANE_BOUNDARY_LINE = "Thank you — I'm going to move on so we cover everything."


class InterviewClock:
    """Tracks elapsed interview time against a hard total cap and soft budgets.

    `now` is injectable so tests are deterministic; production passes
    `time.monotonic`.
    """

    def __init__(
        self, total_cap_seconds: float, now: Callable[[], float]
    ) -> None:
        self._total_cap = total_cap_seconds
        self._now = now
        self._start: float | None = None
        self._downtime = 0.0
        self._paused_at: float | None = None
        self._question_start: float | None = None
        self._question_downtime_at_start = 0.0
        self._question_budget = 0.0

    def start(self) -> None:
        """Start the interview clock."""
        self._start = self._now()

    def begin_question(self, soft_budget_seconds: float) -> None:
        """Mark the start of a question and record its soft budget."""
        self._question_start = self._now()
        self._question_downtime_at_start = self._downtime
        self._question_budget = soft_budget_seconds

    def pause_for_disconnect(self) -> None:
        """Pause the clock at the moment the candidate disconnects."""
        if self._paused_at is None:
            self._paused_at = self._now()

    def resume_after_reconnect(self) -> None:
        """Resume the clock, excluding the disconnection downtime."""
        if self._paused_at is not None:
            self._downtime += self._now() - self._paused_at
            self._paused_at = None

    def elapsed_seconds(self) -> float:
        """Interview time elapsed, excluding disconnection downtime."""
        if self._start is None:
            return 0.0
        now = self._now()
        current_pause = now - self._paused_at if self._paused_at is not None else 0.0
        return now - self._start - self._downtime - current_pause

    def remaining_seconds(self) -> float:
        """Time left under the total cap, never negative."""
        return max(0.0, self._total_cap - self.elapsed_seconds())

    def total_cap_exceeded(self) -> bool:
        """True once the hard total cap is reached."""
        return self.elapsed_seconds() >= self._total_cap

    def question_elapsed_seconds(self) -> float:
        """Time spent on the current question."""
        if self._question_start is None:
            return 0.0
        now = self._now()
        current_pause = now - self._paused_at if self._paused_at is not None else 0.0
        question_downtime = self._downtime - self._question_downtime_at_start
        return now - self._question_start - question_downtime - current_pause

    def soft_budget_exceeded(self) -> bool:
        """True if the current question is over its soft budget (advisory)."""
        return self.question_elapsed_seconds() >= self._question_budget

    def must_move_on(self) -> bool:
        """True only when the hard total cap forces ending the question.

        Soft-budget overruns alone never force a move-on while total time
        remains — probing depth is adaptive within the cap.
        """
        return self.total_cap_exceeded()
