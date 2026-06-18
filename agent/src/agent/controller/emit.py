"""Best-effort artifact emission shared by both interview runners.

The cascade `InterviewRunner` and the `RealtimeInterviewRunner` both stream
transcript turns, agent events, and score checkpoints to the backend. Those
emissions must never break the interview loop: a slow or failing backend is
logged and abandoned, not propagated. This module holds that shared
best-effort emit machinery.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Awaitable, Callable
from typing import Any

logger = logging.getLogger(__name__)

ArtifactEmitter = Callable[[dict[str, Any]], Awaitable[None]]


def _positive_float_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        logger.warning("invalid float environment value", extra={"env_var": name})
        return default
    if value <= 0:
        logger.warning("non-positive float environment value", extra={"env_var": name})
        return default
    return value


_ARTIFACT_EMIT_TIMEOUT_SECONDS = _positive_float_env(
    "PUDDLE_ARTIFACT_EMIT_TIMEOUT_SECONDS",
    0.5,
)


def _log_background_emit_result(kind: str, task: asyncio.Task[None]) -> None:
    try:
        task.result()
    except asyncio.CancelledError:
        logger.warning(
            "artifact emission task was cancelled",
            extra={"artifact_kind": kind},
        )
    except Exception:
        logger.warning(
            "artifact emission failed",
            extra={"artifact_kind": kind},
            exc_info=True,
        )


async def _emit_best_effort(
    kind: str,
    emitter: ArtifactEmitter,
    payload: dict[str, Any],
) -> None:
    task = asyncio.create_task(emitter(payload))
    try:
        await asyncio.wait_for(
            asyncio.shield(task),
            timeout=_ARTIFACT_EMIT_TIMEOUT_SECONDS,
        )
    except TimeoutError:
        task.add_done_callback(lambda done: _log_background_emit_result(kind, done))
        logger.warning(
            "artifact emission timed out",
            extra={
                "artifact_kind": kind,
                "timeout_seconds": _ARTIFACT_EMIT_TIMEOUT_SECONDS,
            },
        )
    except Exception:
        logger.warning(
            "artifact emission failed",
            extra={"artifact_kind": kind},
            exc_info=True,
        )
