"""Prompt construction for the Live Rubric Scorer."""

from __future__ import annotations

from typing import Any

from agent.domain.types import Rubric
from agent.scoring.io_types import ScorerInput

_SCORER_INSTRUCTIONS = (
    "You are the Live Rubric Scorer for a structured hiring interview. "
    "Assess the candidate ONLY on the content of what they said — never on "
    "voice, video, or delivery. For each target category, place the candidate "
    "by the SPIRIT of the 1-4 anchors (anchors are illustrative levels, not "
    "literal checklists). Score the level actually demonstrated, regardless of "
    "which level the question invited. Return STRICT JSON only, no prose, "
    "matching this schema: "
    '{"assessments": [{"category": str, "provisional_score": 1-4, '
    '"confidence": 0.0-1.0, "evidence_quotes": [str], '
    '"missing_or_ambiguous": [str]}]}. '
    "confidence is how sure you are of the score given the evidence so far; "
    "list every still-missing or ambiguous element in missing_or_ambiguous."
)


def _render_rubric(rubric: Rubric) -> str:
    lines = [f"RUBRIC (script_version={rubric.script_version})", ""]
    for cat in rubric.categories:
        lines.append(f"## {cat.name} (key={cat.key})")
        lines.append(f"Meaning: {cat.meaning}")
        for level in (1, 2, 3, 4):
            lines.append(f"  {level}: {cat.anchors[level]}")
        lines.append("")
    lines.append(f"Bare-minimum rule: {rubric.bare_minimum_rule}")
    return "\n".join(lines)


def _render_transcript(scorer_input: ScorerInput) -> str:
    lines = []
    for turn in scorer_input.transcript:
        marker = "CANDIDATE" if turn.speaker == "candidate" else "AGENT"
        flag = " [unreliable]" if turn.unreliable else ""
        lines.append(f"{marker}{flag}: {turn.text}")
    return "\n".join(lines)


def build_scorer_messages(
    rubric: Rubric, scorer_input: ScorerInput
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return `(system_blocks, messages)` for the Anthropic Messages API.

    The rubric block carries `cache_control` so the static rubric/system
    prompt is served from cache across the many scoring calls per interview.
    """
    system: list[dict[str, Any]] = [
        {"type": "text", "text": _SCORER_INSTRUCTIONS},
        {
            "type": "text",
            "text": _render_rubric(rubric),
            "cache_control": {"type": "ephemeral"},
        },
    ]
    user_text = (
        f"Current question_id: {scorer_input.question_id}\n"
        f"Target categories to score now: "
        f"{', '.join(scorer_input.target_categories)}\n\n"
        f"TRANSCRIPT SO FAR:\n{_render_transcript(scorer_input)}\n\n"
        "Score every target category. Return strict JSON."
    )
    messages = [{"role": "user", "content": user_text}]
    return system, messages
