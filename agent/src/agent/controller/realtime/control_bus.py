from __future__ import annotations

from collections.abc import Callable

from pydantic import BaseModel, ConfigDict

from agent.controller.realtime.coverage import CoverageTracker
from agent.controller.realtime.plan_builder import InterviewPlan


class ToolResult(BaseModel):
    """Frozen result returned by every ControlBus tool handler."""

    model_config = ConfigDict(frozen=True)

    speak: str
    reason_code: str
    ended: bool = False
    question_id: str | None = None
    category: str | None = None


class ControlBus:
    """In-path control plane that handles the four realtime tool calls.

    The bus is intentionally free of network or Anthropic imports so it is
    fully unit-testable.  Probe text is obtained via the injected
    ``probe_provider`` callback; the runner (Task 11) wires that to the real
    ProbeGenerator.
    """

    def __init__(
        self,
        plan: InterviewPlan,
        coverage: CoverageTracker,
        probe_provider: Callable[[str], str],
        deflection_line: str = "...",
    ) -> None:
        self._plan = plan
        self._coverage = coverage
        self._probe_provider = probe_provider
        self._deflection_line = deflection_line
        self._last_asked: str | None = None

        # Build a stable index map for script-order comparison.
        self._order: dict[str, int] = {
            rq.question_id: idx
            for idx, rq in enumerate(plan.required_coverage)
        }

    # ------------------------------------------------------------------
    # Tool handlers
    # ------------------------------------------------------------------

    def advance_question(self, next_question_id: str) -> ToolResult:
        """Mark the last-asked question covered, then return the next verbatim.

        If the requested ``next_question_id`` would skip an earlier uncovered
        required question, steer back to that earlier question instead
        (COVERAGE_BACKSTOP).
        """
        if self._last_asked is not None:
            self._coverage.mark_covered(self._last_asked)

        fu = self._coverage.first_uncovered()

        if (
            fu is not None
            and fu.question_id != next_question_id
            and self._order.get(fu.question_id, -1) < self._order.get(next_question_id, -1)
        ):
            # Steer back: an earlier uncovered question precedes the requested one.
            self._last_asked = fu.question_id
            return ToolResult(
                speak=fu.verbatim_text,
                reason_code="COVERAGE_BACKSTOP",
                question_id=fu.question_id,
            )

        # Normal path.
        self._last_asked = next_question_id
        return ToolResult(
            speak=self._verbatim(next_question_id),
            reason_code="REALTIME_QUESTION",
            question_id=next_question_id,
        )

    def request_probe(self, category: str) -> ToolResult:
        """Return a probe for the given rubric category."""
        return ToolResult(
            speak=self._probe_provider(category),
            reason_code="PROBE_LOW_CONFIDENCE",
            category=category,
        )

    def flag_off_script(self, reason: str) -> ToolResult:  # noqa: ARG002
        """Return the configured deflection line."""
        return ToolResult(
            speak=self._deflection_line,
            reason_code="GUARDRAIL_CORRECTION",
        )

    def close_interview(self) -> ToolResult:
        """Attempt to close the interview.

        If all required questions are covered, return the closer with
        ``ended=True``.  Otherwise steer back to the first uncovered question
        (COVERAGE_BACKSTOP, ended=False).

        Note: ``_last_asked`` is NOT marked covered here — the caller is
        responsible for covering it via ``advance_question`` before closing.
        """
        if self._coverage.all_covered():
            return ToolResult(
                speak=self._plan.closer_text,
                reason_code="CLOSING",
                ended=True,
            )

        fu = self._coverage.first_uncovered()
        assert fu is not None  # guaranteed by not all_covered()
        self._last_asked = fu.question_id
        return ToolResult(
            speak=fu.verbatim_text,
            reason_code="COVERAGE_BACKSTOP",
            ended=False,
            question_id=fu.question_id,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _verbatim(self, question_id: str) -> str:
        """Look up the verbatim text for a question_id in plan.required_coverage."""
        for rq in self._plan.required_coverage:
            if rq.question_id == question_id:
                return rq.verbatim_text
        raise KeyError(f"Unknown question_id: {question_id!r}")
