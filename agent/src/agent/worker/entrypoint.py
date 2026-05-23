"""LiveKit agent worker entrypoint — one worker process joins one interview room."""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel, ConfigDict

logger = logging.getLogger(__name__)


class InterviewJobContext(BaseModel):
    """The interview identity parsed from a LiveKit job's room + metadata."""

    model_config = ConfigDict(frozen=True)

    session_id: str
    org_id: str
    script_version: str
    candidate_email: str
    room_name: str


def build_session_context(ctx: Any) -> InterviewJobContext:
    """Parse the dispatch metadata on a LiveKit JobContext.

    Raises `ValueError` if required fields are absent — the worker must never
    join a room it cannot identify.
    """
    raw = ctx.job.metadata if ctx.job is not None else None
    meta = json.loads(raw) if raw else {}
    for field in ("session_id", "org_id", "script_version", "candidate_email"):
        if not meta.get(field):
            raise ValueError(f"job metadata missing required field: {field}")
    return InterviewJobContext(
        session_id=meta["session_id"],
        org_id=meta["org_id"],
        script_version=meta["script_version"],
        candidate_email=meta["candidate_email"],
        room_name=ctx.room.name,
    )


def _job_metadata(job: Any) -> str:
    """Read dispatch metadata from supported LiveKit job object shapes."""
    metadata = getattr(job, "metadata", None)
    if metadata is None:
        metadata = getattr(getattr(job, "job", None), "metadata", None)
    return metadata or "{}"


RunInterview = Callable[[InterviewJobContext, Any], Awaitable[None]]


async def entrypoint(
    job: Any, _run_interview: RunInterview | None = None
) -> None:
    """LiveKit Agents entrypoint: connect to the room, await the candidate, run.

    `_run_interview` is injectable for tests; in production it is the real
    interview runner wired in Task 3.12.
    """
    ctx = build_session_context(job)
    if _run_interview is not None:
        await job.connect()
        participant = await job.wait_for_participant()
        await _run_interview(ctx, participant)
        return

    voice = await _build_livekit_voice_agent(job)
    try:
        await _default_run_interview(ctx, voice)
    finally:
        await voice.aclose()


async def _default_run_interview(
    ctx: InterviewJobContext, voice: Any
) -> None:  # pragma: no cover — exercised by the live integration env
    """Production interview runner: build the components and run the interview."""
    import time
    from pathlib import Path

    import anthropic

    from agent.controller.event_log import EventLog
    from agent.controller.interview import InterviewRunner
    from agent.rubric_loader import load_rubric
    from agent.scoring.probe import ProbeGenerator
    from agent.scoring.scorer import Scorer
    from agent.voice.livekit_session import ParticipantDisconnectedError

    repo_root = Path(__file__).parents[4]
    rubric = load_rubric(repo_root / "rubric" / f"{ctx.script_version}.yaml")
    anthropic_client = anthropic.Anthropic()
    runner = InterviewRunner(
        rubric=rubric,
        voice=voice,
        scorer=Scorer(client=anthropic_client, rubric=rubric),
        probe_generator=ProbeGenerator(client=anthropic_client, rubric=rubric),
        event_log=EventLog(
            session_id=ctx.session_id,
            path=repo_root / "artifacts" / ctx.session_id / "agent_events.jsonl",
        ),
        clock_now=time.monotonic,
    )
    logger.info(
        "starting interview runner",
        extra={"session_id": ctx.session_id, "room": ctx.room_name},
    )
    try:
        await runner.run(session_id=ctx.session_id)
    except ParticipantDisconnectedError:
        logger.info(
            "ending interview after participant reconnect grace expired",
            extra={"session_id": ctx.session_id, "room": ctx.room_name},
        )
    else:
        logger.info(
            "interview runner completed",
            extra={"session_id": ctx.session_id, "room": ctx.room_name},
        )


async def _build_livekit_voice_agent(job: Any) -> Any:  # pragma: no cover — vendor wiring
    """Construct and start the LiveKit-backed VoiceAgent for the room."""
    import os

    from agent.voice.livekit_session import LiveKitSessionVoiceAgent
    from agent.voice.stt import build_deepgram_stt
    from agent.voice.tts import build_cartesia_tts

    return await LiveKitSessionVoiceAgent.start(
        job,
        stt=build_deepgram_stt(os.environ["DEEPGRAM_API_KEY"]),
        tts=build_cartesia_tts(os.environ["CARTESIA_API_KEY"]),
    )
