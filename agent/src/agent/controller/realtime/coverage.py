from __future__ import annotations

from agent.controller.realtime.plan_builder import RequiredQuestion


class CoverageTracker:
    def __init__(self, required: list[RequiredQuestion]) -> None:
        self._required = list(required)
        self._covered: set[str] = set()
        self._ids = {r.question_id for r in self._required}

    def mark_covered(self, question_id: str) -> None:
        if question_id in self._ids:
            self._covered.add(question_id)

    def is_covered(self, question_id: str) -> bool:
        return question_id in self._covered

    def first_uncovered(self) -> RequiredQuestion | None:
        for r in self._required:
            if r.question_id not in self._covered:
                return r
        return None

    def all_covered(self) -> bool:
        return self.first_uncovered() is None

    def status(self) -> list[tuple[str, bool]]:
        return [(r.question_id, r.question_id in self._covered) for r in self._required]
