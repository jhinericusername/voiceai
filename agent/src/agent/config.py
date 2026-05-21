"""Runtime configuration — model ids and tunables, swappable via env."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelConfig:
    """Model ids for each LLM/VLM role. Swappable without code changes."""

    scorer_model: str = os.getenv("PUDDLE_SCORER_MODEL", "claude-opus-4-7")
    probe_model: str = os.getenv("PUDDLE_PROBE_MODEL", "claude-opus-4-7")
    vlm_model: str = os.getenv("PUDDLE_VLM_MODEL", "gemini-2.5-flash")


@dataclass(frozen=True)
class ScoringConfig:
    """Tunables for the score-driven loop."""

    confidence_threshold: float = float(os.getenv("PUDDLE_CONFIDENCE_THRESHOLD", "0.75"))
    scorer_max_tokens: int = 2048
    scorer_timeout_seconds: float = 12.0


MODELS = ModelConfig()
SCORING = ScoringConfig()
