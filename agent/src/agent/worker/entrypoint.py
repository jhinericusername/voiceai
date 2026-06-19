"""LiveKit agent worker entrypoint — one worker process joins one interview room."""

from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import anthropic
from pydantic import BaseModel, ConfigDict

from agent.config import REALTIME
from agent.controller.event_log import EventLog
from agent.controller.realtime.guardrail_monitor import GuardrailMonitor
from agent.controller.realtime.runner import RealtimeInterviewRunner
from agent.rubric_loader import load_rubric
from agent.voice.livekit_session import ParticipantDisconnectedError
from agent.worker.backend_client import BackendClient

logger = logging.getLogger(__name__)


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


_BACKEND_FLUSH_TIMEOUT_SECONDS = _positive_float_env(
    "PUDDLE_BACKEND_FLUSH_TIMEOUT_SECONDS",
    2.0,
)


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
    try:
        meta = json.loads(_job_metadata(job))
    except json.JSONDecodeError as exc:
        raise ValueError("job metadata must be valid JSON") from exc
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


def _job_metadata(job: Any) -> str:
    """Read dispatch metadata from supported LiveKit job object shapes."""
    metadata = getattr(job, "metadata", None)
    if metadata is None:
        metadata = getattr(getattr(job, "job", None), "metadata", None)
    return metadata or "{}"


RunInterview = Callable[[InterviewJobContext, Any], Awaitable[None]]


def prewarm(proc: Any) -> None:  # pragma: no cover - exercised via test_worker_prewarm
    """Load the Silero VAD once per worker process into proc.userdata."""
    from livekit.plugins import silero

    proc.userdata["vad"] = silero.VAD.load()


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
        voice = await job.wait_for_participant()
        try:
            await _run_interview(ctx, voice)
        finally:
            await _close_voice_if_present(voice)
        return

    voice = await _build_realtime_session(job)
    try:
        await _realtime_run_interview(ctx, voice)
    finally:
        await _close_voice_if_present(voice)


async def _close_voice_if_present(voice: Any) -> None:
    aclose = getattr(voice, "aclose", None)
    if callable(aclose):
        await aclose()


async def _run_and_finalize(
    runner: Any,
    *,
    ctx: InterviewJobContext,
    backend: BackendClient,
    session_id: str,
    script_version: str,
) -> None:
    """Run the realtime interview runner and post finalization regardless of outcome.

    Completion reasons:
    - "completed"              — runner.run() returned normally
    - "candidate_disconnected" — ParticipantDisconnectedError
    - "agent_error"            — any other Exception (re-raised after finalization)
    """
    try:
        assessment = await runner.run(session_id=session_id)
    except ParticipantDisconnectedError:
        logger.info(
            "ending interview after participant reconnect grace expired",
            extra={"session_id": ctx.session_id, "room": ctx.room_name},
        )
        await _post_finalization_best_effort(
            backend,
            _finalization_payload(
                ctx=ctx,
                runner=runner,
                completion_reason="candidate_disconnected",
                integrity_flags=[],
            ),
        )
    except Exception:
        logger.exception(
            "interview runner failed",
            extra={"session_id": ctx.session_id, "room": ctx.room_name},
        )
        await _post_finalization_best_effort(
            backend,
            _finalization_payload(
                ctx=ctx,
                runner=runner,
                completion_reason="agent_error",
                integrity_flags=["agent_error"],
            ),
        )
        raise
    else:
        await _post_finalization_best_effort(
            backend,
            _finalization_payload(
                ctx=ctx,
                runner=runner,
                completion_reason="completed",
                integrity_flags=assessment.integrity_flags,
                script_version=assessment.script_version,
            ),
        )
        logger.info(
            "interview runner completed",
            extra={"session_id": ctx.session_id, "room": ctx.room_name},
        )


async def _realtime_run_interview(
    ctx: InterviewJobContext, voice: Any
) -> None:
    """Realtime interview runner: build the realtime components and run the interview."""
    repo_root = Path(__file__).parents[4]
    rubric = load_rubric(repo_root / "rubric" / f"{ctx.script_version}.yaml")
    anthropic_client = anthropic.Anthropic()
    event_log = EventLog(
        session_id=ctx.session_id,
        path=repo_root / "artifacts" / ctx.session_id / "agent_events.jsonl",
    )
    backend = BackendClient(session_id=ctx.session_id)
    runner = RealtimeInterviewRunner(
        rubric=rubric,
        session=voice,
        guardrail_monitor=GuardrailMonitor(
            client=anthropic_client,
            model=REALTIME.guardrail_model,
        ),
        event_log=event_log,
        clock_now=time.monotonic,
        emit_transcript_turn=backend.post_transcript_turn,
        emit_agent_event=backend.post_agent_event,
        candidate_transcript_source="realtime",
        # The LiveKit room path runs the interview purely from the prompt — the
        # adapter does not register the control tools with the realtime model, so
        # instructing the model to call them would only derail it into a monologue.
        control_tools_enabled=False,
    )
    logger.info(
        "starting realtime interview runner",
        extra={"session_id": ctx.session_id, "room": ctx.room_name},
    )
    await _run_and_finalize(
        runner,
        ctx=ctx,
        backend=backend,
        session_id=ctx.session_id,
        script_version=ctx.script_version,
    )


async def _build_realtime_session(job: Any) -> Any:  # pragma: no cover — vendor wiring
    """Construct and return a LiveKitRealtimeSession for the room.

    Does NOT call .start() — the runner's run() starts the session.
    """
    from agent.voice.realtime.livekit_adapter import LiveKitRealtimeSession

    return LiveKitRealtimeSession(
        job,
        model=REALTIME.model,
        participant_identity=None,
    )


def _finalization_payload(
    *,
    ctx: InterviewJobContext,
    runner: Any,
    completion_reason: str,
    integrity_flags: list[str],
    script_version: str | None = None,
) -> dict[str, Any]:
    payload = {
        "completionReason": completion_reason,
        "scriptVersion": script_version or ctx.script_version,
        "finalTurnCount": _runner_transcript_count(runner),
        "integrityFlags": integrity_flags,
        "agentEventCount": _runner_agent_event_count(runner),
    }
    if completion_reason == "completed":
        # The realtime interviewer emits no live score checkpoints (scoring is
        # post-hoc in the backend); keep the field for the finalization contract.
        payload["scoreCheckpointCount"] = 0
    return payload


async def _post_finalization_best_effort(
    backend: BackendClient,
    payload: dict[str, Any],
) -> None:
    await _flush_backend_best_effort(backend)
    try:
        await backend.post_finalization(payload)
    except Exception:
        logger.warning("backend finalization post failed", exc_info=True)
    await _flush_backend_best_effort(backend)


async def _flush_backend_best_effort(backend: BackendClient) -> None:
    try:
        await backend.flush(timeout_seconds=_BACKEND_FLUSH_TIMEOUT_SECONDS)
    except Exception:
        logger.warning(
            "backend artifact flush failed",
            extra={"timeout_seconds": _BACKEND_FLUSH_TIMEOUT_SECONDS},
            exc_info=True,
        )


def _runner_transcript_count(runner: Any) -> int:
    transcript = getattr(runner, "transcript", None)
    if transcript is None:
        transcript = getattr(runner, "_transcript", None)
    if transcript is None:
        return 0
    return len(transcript)


def _runner_agent_event_count(runner: Any) -> int:
    event_log = getattr(runner, "event_log", None)
    if event_log is None:
        event_log = getattr(runner, "_event_log", None)
    events = getattr(event_log, "events", None)
    if not callable(events):
        return 0
    return len(events())


