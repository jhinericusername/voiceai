"""The Live Rubric Scorer — Anthropic-backed, prompt-cached, structured output."""

from __future__ import annotations

import json
from typing import Any

from agent.config import MODELS, SCORING
from agent.domain.types import Rubric
from agent.scoring.io_types import ScorerInput, ScorerOutput
from agent.scoring.prompt import build_scorer_messages


class ScorerParseError(Exception):
    """Raised when the Scorer LLM output is not valid structured JSON."""


def _extract_json(text: str) -> dict[str, Any]:
    """Extract the first JSON object from an LLM text response."""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ScorerParseError(f"no JSON object in scorer output: {text!r}")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ScorerParseError(f"invalid scorer JSON: {exc}") from exc


class Scorer:
    """Scores a transcript against the rubric via the Anthropic Messages API.

    The same component runs live (per turn) and in the eval harness
    (standalone over corpus transcripts).
    """

    def __init__(self, client: Any, rubric: Rubric) -> None:
        self._client = client
        self._rubric = rubric

    def score(self, scorer_input: ScorerInput) -> ScorerOutput:
        """Run one scoring pass; return the structured `ScorerOutput`."""
        system, messages = build_scorer_messages(self._rubric, scorer_input)
        response = self._client.messages.create(
            model=MODELS.scorer_model,
            max_tokens=SCORING.scorer_max_tokens,
            system=system,
            messages=messages,
        )
        text = "".join(block.text for block in response.content)
        payload = _extract_json(text)
        try:
            return ScorerOutput.model_validate(payload)
        except Exception as exc:  # noqa: BLE001 — surface as a parse error
            raise ScorerParseError(f"scorer output failed schema: {exc}") from exc
