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

    repo_root = Path(__file__).parents[4]
    rubric = load_rubric(repo_root / "rubric" / f"{ctx.script_version}.yaml")
    anthropic_client = anthropic.Anthropic()
    runner = InterviewRunner(
        rubric=rubric,
        voice=_build_voice_agent(participant),
        scorer=Scorer(client=anthropic_client, rubric=rubric),
        probe_generator=ProbeGenerator(client=anthropic_client, rubric=rubric),
        event_log=EventLog(
            session_id=ctx.session_id,
            path=repo_root / "artifacts" / ctx.session_id / "agent_events.jsonl",
        ),
        clock_now=time.monotonic,
    )
    await runner.run(session_id=ctx.session_id)


def _build_voice_agent(participant: Any) -> Any:  # pragma: no cover — vendor wiring
    """Construct the cascaded VoiceAgent from LiveKit plugins for `participant`."""
    import os

    from agent.voice.cascaded import CascadedVoiceAgent
    from agent.voice.stt import DeepgramSTT, build_deepgram_stt
    from agent.voice.tts import CartesiaTTS, build_cartesia_tts

    stt = DeepgramSTT(plugin=build_deepgram_stt(os.environ["DEEPGRAM_API_KEY"]))
    tts = CartesiaTTS(plugin=build_cartesia_tts(os.environ["CARTESIA_API_KEY"]))
    return CascadedVoiceAgent(stt=stt, tts=tts, room_output=participant)
