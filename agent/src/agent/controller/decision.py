"""The probe-vs-advance decision — pure logic over a `ScorerOutput`.

This is plain deterministic code: it acts on the Scorer's confidence but does
not itself reason about candidate quality.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from agent.scoring.io_types import ScorerOutput

Action = Literal["probe", "advance"]


class Directive(BaseModel):
    """The controller's next action after a scoring pass."""

    model_config = ConfigDict(frozen=True)

    action: Action
    probe_category: str | None = None
    missing_element: str | None = None


def decide_next_action(
    scorer_output: ScorerOutput,
    target_categories: list[str],
    confidence_threshold: float,
    probes_used: int,
    max_probes: int,
    time_exhausted: bool,
) -> Directive:
    """Decide whether to probe deeper or advance to the next base question.

    Probe when a targeted category is below the confidence threshold AND
    probes remain AND time remains; otherwise advance. When multiple targets
    are low-confidence, probe the lowest-confidence one first.
    """
    if probes_used >= max_probes or time_exhausted:
        return Directive(action="advance")

    by_category = scorer_output.by_category()
    low: list[tuple[float, str, str | None]] = []
    for category in target_categories:
        assessment = by_category.get(category)
        if assessment is None:
            continue
        if assessment.confidence < confidence_threshold:
            missing = (
                assessment.missing_or_ambiguous[0]
                if assessment.missing_or_ambiguous
                else None
            )
            low.append((assessment.confidence, category, missing))

    if not low:
        return Directive(action="advance")

    low.sort(key=lambda item: item[0])
    _confidence, category, missing = low[0]
    return Directive(
        action="probe", probe_category=category, missing_element=missing
    )
