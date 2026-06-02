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
