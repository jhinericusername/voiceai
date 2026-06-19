"""Runtime configuration — model ids and tunables, swappable via env."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field

_log = logging.getLogger(__name__)


def _bool_env(name: str, default: bool) -> bool:
    """Parse a boolean from an environment variable.

    Recognizes: "1", "true", "yes", "y", "on" (case-insensitive) as True.
    All other values (including unset) are treated as False or the default.
    """
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _positive_float_env(name: str, default: float) -> float:
    """Read *name* from the environment, parse as float, and return it if > 0.

    Falls back to *default* (with a warning) if the variable is absent, cannot
    be parsed as a float, or is non-positive.  Never raises.
    """
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        _log.warning(
            "Config: %s=%r is not a valid float; using default %.1f", name, raw, default
        )
        return default
    if value <= 0:
        _log.warning(
            "Config: %s=%r is non-positive; using default %.1f", name, raw, default
        )
        return default
    return value


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


@dataclass(frozen=True)
class RealtimeConfig:
    """Configuration for OpenAI realtime mode."""

    model: str = field(default_factory=lambda: os.getenv("PUDDLE_REALTIME_MODEL", "gpt-realtime"))
    guardrail_model: str = field(
        default_factory=lambda: os.getenv("PUDDLE_GUARDRAIL_MODEL", "claude-haiku-4-5")
    )
    max_session_seconds: float = field(
        default_factory=lambda: _positive_float_env("PUDDLE_REALTIME_MAX_SESSION_SECONDS", 1800.0)
    )


MODELS = ModelConfig()
SCORING = ScoringConfig()
REALTIME = RealtimeConfig()
