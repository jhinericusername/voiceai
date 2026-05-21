"""LiveKit agent worker entrypoint — one worker process joins one interview room."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel, ConfigDict


class InterviewJobContext(BaseModel):
    """The interview identity parsed from a LiveKit job's room + metadata."""

    model_config = ConfigDict(frozen=True)

    session_id: str
    org_id: str
    script_version: str
    candidate_email: str
    room_name: str


def build_session_context(job: Any) -> InterviewJobContext:
    """Parse the dispatch metadata on a LiveKit job into an `InterviewJobContext`.

    Raises `ValueError` if required fields are absent — the worker must never
    join a room it cannot identify.
    """
    meta = json.loads(job.metadata) if job.metadata else {}
    for field in ("session_id", "org_id", "script_version", "candidate_email"):
        if not meta.get(field):
            raise ValueError(f"job metadata missing required field: {field}")
    return InterviewJobContext(
        session_id=meta["session_id"],
        org_id=meta["org_id"],
        script_version=meta["script_version"],
        candidate_email=meta["candidate_email"],
        room_name=job.room.name,
    )


RunInterview = Callable[[InterviewJobContext, Any], Awaitable[None]]


async def entrypoint(
    job: Any, _run_interview: RunInterview | None = None
) -> None:
    """LiveKit Agents entrypoint: connect to the room, await the candidate, run.

    `_run_interview` is injectable for tests; in production it is the real
    interview runner wired in Task 3.12.
    """
    ctx = build_session_context(job)
    await job.connect()
    participant = await job.wait_for_participant()
    runner = _run_interview or _default_run_interview
    await runner(ctx, participant)


async def _default_run_interview(
    ctx: InterviewJobContext, participant: Any
) -> None:  # pragma: no cover — wired in Task 3.12
    """Placeholder runner; replaced by the real wiring in Task 3.12."""
    raise NotImplementedError("interview runner is wired in Task 3.12")
