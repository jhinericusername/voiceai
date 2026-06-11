"""Best-effort reporting of agent lifecycle events to the backend."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)
FINALIZATION_MAX_ATTEMPTS = 3
FINALIZATION_RETRY_DELAYS_SECONDS = (1.0, 3.0)


def _backend_base_url() -> str:
    return os.environ.get("PUDDLE_BACKEND_BASE_URL", "http://localhost:8080").rstrip("/")


def _backend_headers() -> dict[str, str]:
    headers = {"content-type": "application/json"}
    token = os.environ.get("PUDDLE_BACKEND_INTERNAL_TOKEN", "").strip()
    if token:
        headers["authorization"] = f"Bearer {token}"
    return headers


def _post_session_event_sync(
    session_id: str,
    event_type: str,
    payload: dict[str, Any] | None,
    status: str | None,
) -> None:
    body = {
        "eventType": event_type,
        "payload": payload or {},
        **({"status": status} if status else {}),
    }
    request = urllib.request.Request(
        f"{_backend_base_url()}/internal/sessions/{session_id}/events",
        data=json.dumps(body).encode("utf-8"),
        headers=_backend_headers(),
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        if response.status >= 400:
            raise RuntimeError(f"backend returned status {response.status}")


def _post_interview_finalization_sync(
    session_id: str,
    payload: dict[str, Any],
) -> None:
    request = urllib.request.Request(
        f"{_backend_base_url()}/internal/sessions/{session_id}/finalize",
        data=json.dumps(payload).encode("utf-8"),
        headers=_backend_headers(),
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status >= 400:
            raise RuntimeError(f"backend returned status {response.status}")


async def post_session_event(
    session_id: str,
    event_type: str,
    payload: dict[str, Any] | None = None,
    *,
    status: str | None = None,
) -> None:
    """Report one lifecycle event without blocking the LiveKit media callbacks."""
    try:
        await asyncio.to_thread(
            _post_session_event_sync,
            session_id,
            event_type,
            payload,
            status,
        )
    except (OSError, urllib.error.URLError, RuntimeError) as exc:
        logger.warning(
            "backend lifecycle event report failed",
            extra={"session_id": session_id, "event_type": event_type, "error": str(exc)},
        )


async def post_interview_finalization(
    session_id: str,
    payload: dict[str, Any],
    *,
    attempts: int = FINALIZATION_MAX_ATTEMPTS,
    retry_delays_seconds: tuple[float, ...] = FINALIZATION_RETRY_DELAYS_SECONDS,
) -> None:
    """Persist the completed interview packet after the controller finishes."""
    if attempts < 1:
        raise ValueError("attempts must be at least 1")

    for attempt in range(1, attempts + 1):
        try:
            await asyncio.to_thread(_post_interview_finalization_sync, session_id, payload)
            return
        except (OSError, urllib.error.URLError, RuntimeError) as exc:
            if attempt >= attempts:
                logger.error(
                    "backend interview finalization report failed",
                    extra={
                        "session_id": session_id,
                        "attempt": attempt,
                        "attempts": attempts,
                        "error": str(exc),
                    },
                )
                raise

            logger.warning(
                "backend interview finalization report failed; retrying",
                extra={
                    "session_id": session_id,
                    "attempt": attempt,
                    "attempts": attempts,
                    "error": str(exc),
                },
            )
            delay = (
                retry_delays_seconds[min(attempt - 1, len(retry_delays_seconds) - 1)]
                if retry_delays_seconds
                else 0
            )
            if delay > 0:
                await asyncio.sleep(delay)
