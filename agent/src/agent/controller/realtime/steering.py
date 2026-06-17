"""Steering-by-exception: inject a nudge when the realtime model skips a low-confidence category."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from agent.config import SCORING
from agent.controller.decision import decide_next_action
from agent.scoring.io_types import ScorerOutput


class SteerMessage(BaseModel):
    """A one-shot nudge injected into the realtime session to probe a skipped category."""

    model_config = ConfigDict(frozen=True)

    text: str
    category: str


def decide_steering(
    scorer_output: ScorerOutput,
    target_categories: list[str],
    probes_used: int,
    max_probes: int,
    already_advanced: bool,
) -> SteerMessage | None:
    """Return a SteerMessage when the model advanced past a low-confidence category.

    Returns None when:
    - already_advanced is False (model is still on the question; let it probe itself), or
    - decide_next_action says "advance" (all categories are sufficiently confident).

    Returns a SteerMessage when already_advanced is True AND decide_next_action
    says "probe" — meaning the realtime model moved on without probing a
    low-confidence category.
    """
    if not already_advanced:
        return None
    directive = decide_next_action(
        scorer_output=scorer_output,
        target_categories=target_categories,
        confidence_threshold=SCORING.confidence_threshold,
        probes_used=probes_used,
        max_probes=max_probes,
        time_exhausted=False,
    )
    if directive.action != "probe" or directive.probe_category is None:
        return None
    category = directive.probe_category
    return SteerMessage(
        text=f"Before you wrap up, dig a little deeper on {category} — the answer so far is thin.",
        category=category,
    )
