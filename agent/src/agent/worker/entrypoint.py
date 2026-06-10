"""LiveKit agent worker entrypoint — one worker process joins one interview room."""

from __future__ import annotations

import json
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


def prewarm(proc: Any) -> None:  # pragma: no cover - exercised via test_worker_prewarm
    """Load the Silero VAD once per worker process into proc.userdata."""
    from livekit.plugins import silero

    proc.userdata["vad"] = silero.VAD.load()


async def entrypoint(ctx: Any) -> None:  # pragma: no cover - live worker wiring
    """LiveKit Agents entrypoint: one worker process runs one interview.

    Uses the production-shaped `LiveKitSessionVoiceAgent` which handles
    participant linking, audio track subscription, reconnect grace, and
    proper event wiring. The earlier `LiveKitVoiceAgent` spike was missing
    participant linking which caused STT to receive intermittent audio.
    """
    import os
    import time
    from pathlib import Path

    import anthropic

    from agent.controller.event_log import EventLog
    from agent.controller.interview import InterviewRunner
    from agent.rubric_loader import load_rubric
    from agent.scoring.probe import ProbeGenerator
    from agent.scoring.scorer import Scorer
    from agent.voice.livekit_session import (
        LiveKitSessionVoiceAgent,
        ParticipantDisconnectedError,
    )
    from agent.voice.stt import build_deepgram_stt
    from agent.voice.tts import build_cartesia_tts
    from agent.worker.persistence import mark_session_incomplete, persist_assessment

    interview = build_session_context(ctx)
    # DATABASE_URL is optional — when unset, the agent runs the interview but
    # skips assessment persistence (the event log still lands on disk via
    # EventLog). Required only for the full prod persistence path.
    database_url = os.environ.get("DATABASE_URL")
    voice: Any = None
    try:
        await ctx.connect()
        voice = await LiveKitSessionVoiceAgent.start(
            ctx,
            stt=build_deepgram_stt(os.environ["DEEPGRAM_API_KEY"]),
            tts=build_cartesia_tts(os.environ["CARTESIA_API_KEY"]),
            vad=ctx.proc.userdata.get("vad"),
        )

        repo_root = Path(__file__).resolve().parents[4]
        rubric = load_rubric(
            repo_root / "rubric" / f"{interview.script_version}.yaml"
        )
        anthropic_client = anthropic.Anthropic()
        runner = InterviewRunner(
            rubric=rubric,
            voice=voice,
            scorer=Scorer(client=anthropic_client, rubric=rubric),
            probe_generator=ProbeGenerator(client=anthropic_client, rubric=rubric),
            event_log=EventLog(
                session_id=interview.session_id,
                path=repo_root
                / "artifacts"
                / interview.session_id
                / "agent_events.jsonl",
            ),
            clock_now=time.monotonic,
        )
        try:
            assessment = await runner.run(session_id=interview.session_id)
        except ParticipantDisconnectedError:
            # Candidate failed to reconnect within the grace window. Mark
            # incomplete and don't try to persist a partial assessment.
            if database_url:
                await mark_session_incomplete(database_url, interview.session_id)
            return
        if database_url:
            await persist_assessment(database_url, assessment)
    except Exception:
        if database_url:
            await mark_session_incomplete(database_url, interview.session_id)
        raise
    finally:
        if voice is not None:
            try:
                await voice.aclose()
            except Exception:
                pass
