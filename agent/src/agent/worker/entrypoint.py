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


async def entrypoint(ctx: Any) -> None:  # pragma: no cover - live worker wiring
    """LiveKit Agents entrypoint: one worker process runs one interview.

    Connects to the room, starts an `AgentSession` configured for scripted
    speech only, runs the `InterviewRunner` to completion, and persists the
    resulting `Assessment`. On any failure the session is marked incomplete.
    """
    import os
    import time
    from pathlib import Path

    import anthropic
    from livekit.agents import Agent

    from agent.controller.event_log import EventLog
    from agent.controller.interview import InterviewRunner
    from agent.rubric_loader import load_rubric
    from agent.scoring.probe import ProbeGenerator
    from agent.scoring.scorer import Scorer
    from agent.voice.livekit_agent import LiveKitVoiceAgent
    from agent.voice.session import build_agent_session
    from agent.worker.persistence import mark_session_incomplete, persist_assessment

    interview = build_session_context(ctx)
    # DATABASE_URL is optional — when unset, the agent runs the interview but
    # skips assessment persistence (the event log still lands on disk via
    # EventLog). Required only for the full prod persistence path.
    database_url = os.environ.get("DATABASE_URL")
    session: Any = None
    try:
        await ctx.connect()
        session = build_agent_session(
            deepgram_api_key=os.environ["DEEPGRAM_API_KEY"],
            cartesia_api_key=os.environ["CARTESIA_API_KEY"],
        )
        # Per Task 1.1 findings §3: AgentSession.start requires an Agent
        # instance. We never call generate_reply(); the Interview Controller
        # supplies every spoken word verbatim through session.say().
        agent = Agent(
            instructions=(
                "Puddle voice interviewer. All speech is driven by the "
                "Interview Controller via session.say(); do not synthesize "
                "replies."
            )
        )
        await session.start(agent, room=ctx.room)

        repo_root = Path(__file__).resolve().parents[4]
        rubric = load_rubric(
            repo_root / "rubric" / f"{interview.script_version}.yaml"
        )
        anthropic_client = anthropic.Anthropic()
        runner = InterviewRunner(
            rubric=rubric,
            voice=LiveKitVoiceAgent(session),
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
        assessment = await runner.run(session_id=interview.session_id)
        if database_url:
            await persist_assessment(database_url, assessment)
    except Exception:
        if database_url:
            await mark_session_incomplete(database_url, interview.session_id)
        raise
    finally:
        if session is not None:
            try:
                await session.aclose()
            except Exception:
                pass
