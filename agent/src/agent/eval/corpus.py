"""Load the human-scored interview corpus for offline Scorer evaluation."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, ConfigDict, ValidationError

from agent.domain.types import TranscriptTurn


class CorpusItem(BaseModel):
    """One human-scored interview: transcript plus ground-truth scores."""

    model_config = ConfigDict(frozen=True)

    interview_id: str
    script_version: str
    transcript: list[TranscriptTurn]
    human_scores: dict[str, int]


def load_corpus(directory: Path) -> list[CorpusItem]:
    """Load every `*.json` corpus item from `directory`, sorted by filename.

    Raises `ValueError` if an item is missing required fields.
    """
    items: list[CorpusItem] = []
    for path in sorted(directory.glob("*.json")):
        raw = json.loads(path.read_text())
        try:
            items.append(CorpusItem.model_validate(raw))
        except ValidationError as exc:
            raise ValueError(f"corpus item {path.name} invalid: {exc}") from exc
    return items
