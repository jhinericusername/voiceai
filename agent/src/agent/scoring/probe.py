"""The Probe Generator — drafts targeted follow-ups for low-confidence categories."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

from agent.config import MODELS
from agent.domain.types import Rubric, TranscriptTurn
from agent.scoring.io_types import CategoryAssessment

_PROBE_INSTRUCTIONS = (
    "You draft ONE short follow-up interview question. It must elicit the "
    "specific missing evidence named below — nothing more. Rules: never coach, "
    "never hint at a desired answer, never add new criteria, never reveal the "
    "rubric. Return ONLY the question text, a single sentence, no preamble."
)


class ProbeRequest(BaseModel):
    """Inputs needed to draft one probe."""

    model_config = ConfigDict(frozen=True)

    category_assessment: CategoryAssessment
    transcript: list[TranscriptTurn]
    probes_used: int
    max_probes: int


def _render_transcript(turns: list[TranscriptTurn]) -> str:
    out = []
    for turn in turns:
        marker = "CANDIDATE" if turn.speaker == "candidate" else "AGENT"
        out.append(f"{marker}: {turn.text}")
    return "\n".join(out)


class ProbeGenerator:
    """Generates elicitation-focused follow-up questions via Anthropic."""

    def __init__(self, client: Any, rubric: Rubric) -> None:
        self._client = client
        self._rubric = rubric

    def generate(self, request: ProbeRequest) -> str:
        """Draft a follow-up targeting the assessment's missing elements.

        Scripted-first: when the question being probed has a `scripted_probes`
        pool, return the next one in order (probes_used picks the index). Only
        falls back to the LLM when the pool is exhausted but probes_used is
        still under max_probes. This is Prakul's pattern — used 99% of the
        time. The LLM tail-fallback handles cases where the pool is shorter
        than max_probes but the candidate still needs targeted elicitation.

        Raises `ValueError` if the per-question probe budget is exhausted.
        """
        if request.probes_used >= request.max_probes:
            raise ValueError("probe budget exhausted for this question")

        scripted = self._scripted_probes_for(request.category_assessment.category)
        if request.probes_used < len(scripted):
            return scripted[request.probes_used]

        ca = request.category_assessment
        missing = "; ".join(ca.missing_or_ambiguous) or "unclear evidence"
        user_text = (
            f"Category being assessed: {ca.category}\n"
            f"Missing or ambiguous evidence to target: {missing}\n\n"
            f"TRANSCRIPT SO FAR:\n{_render_transcript(request.transcript)}\n\n"
            "Write one follow-up question."
        )
        response = self._client.messages.create(
            model=MODELS.probe_model,
            max_tokens=256,
            system=[
                {
                    "type": "text",
                    "text": _PROBE_INSTRUCTIONS,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_text}],
        )
        return "".join(block.text for block in response.content).strip()

    def _scripted_probes_for(self, category_key: str) -> list[str]:
        """Return the scripted probe pool from the first question that targets
        this category. Empty list when none defined (LLM fallback kicks in)."""
        for q in self._rubric.questions:
            if category_key in q.rubric_categories and q.scripted_probes:
                return list(q.scripted_probes)
        return []
