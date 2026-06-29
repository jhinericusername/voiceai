"""Launch the Puddle interviewer worker against LiveKit Cloud.

The worker registers under the agent name ``puddle-interviewer`` — the same
name the backend dispatches to (see ``backend/src/livekit/provision.ts``).
LiveKit credentials are read from the environment by the LiveKit Agents CLI:
``LIVEKIT_URL``, ``LIVEKIT_API_KEY``, ``LIVEKIT_API_SECRET``.

Run (the CLI takes a subcommand — ``dev`` for local development, ``start``
for production):

    uv run --env-file ../.env python -m agent.worker dev
"""

from __future__ import annotations

import json
from typing import Any

from livekit.agents import WorkerOptions, cli

from agent.worker.entrypoint import entrypoint, prewarm

AGENT_NAME = "puddle-interviewer"
_AGENT_DISPLAY_NAME = "agent"
_AGENT_ATTRIBUTES = {"puddle.role": "ai_interviewer"}


async def accept_request(request: Any) -> None:
    """Accept a LiveKit job request with a stable AI participant identity when present."""
    identity = _agent_participant_identity(request)
    if identity:
        await request.accept(
            name=_AGENT_DISPLAY_NAME,
            identity=identity,
            attributes=_AGENT_ATTRIBUTES,
        )
        return

    await request.accept(name=_AGENT_DISPLAY_NAME, attributes=_AGENT_ATTRIBUTES)


def _agent_participant_identity(request: Any) -> str | None:
    try:
        metadata = json.loads(_request_metadata(request))
    except json.JSONDecodeError:
        return None
    if not isinstance(metadata, dict):
        return None

    for field in (
        "agent_participant_identity",
        "agent_identity",
        "ai_participant_identity",
    ):
        identity = _metadata_string(metadata, field)
        if identity is not None:
            return identity

    participant_identity = _metadata_string(metadata, "participant_identity")
    if participant_identity and participant_identity.startswith(f"{AGENT_NAME}-"):
        return participant_identity
    return None


def _request_metadata(request: Any) -> str:
    metadata = getattr(request, "metadata", None)
    if metadata is None:
        metadata = getattr(getattr(request, "job", None), "metadata", None)
    return metadata or "{}"


def _metadata_string(metadata: dict[str, Any], field: str) -> str | None:
    value = metadata.get(field)
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


if __name__ == "__main__":  # pragma: no cover — live LiveKit worker process
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            request_fnc=accept_request,
            agent_name=AGENT_NAME,
        )
    )
