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

from agent.controller.event_log import EventLog
from agent.controller.interview import CandidateSilenceTimeoutError, InterviewRunner
from agent.rubric_loader import load_rubric
from agent.scoring.probe import ProbeGenerator
from agent.scoring.scorer import Scorer
from agent.voice.livekit_session import ParticipantDisconnectedError
from agent.voice.stt import deepgram_transcript_source
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

    voice = await _build_livekit_voice_agent(job)
    try:
        await _default_run_interview(ctx, voice)
    finally:
        await _close_voice_if_present(voice)


async def _close_voice_if_present(voice: Any) -> None:
    aclose = getattr(voice, "aclose", None)
    if callable(aclose):
        await aclose()


async def _default_run_interview(
    ctx: InterviewJobContext, voice: Any
) -> None:  # pragma: no cover — exercised by the live integration env
    """Production interview runner: build the components and run the interview."""
    repo_root = Path(__file__).parents[4]
    rubric = load_rubric(repo_root / "rubric" / f"{ctx.script_version}.yaml")
    anthropic_client = anthropic.Anthropic()
    event_log = EventLog(
        session_id=ctx.session_id,
        path=repo_root / "artifacts" / ctx.session_id / "agent_events.jsonl",
    )
    backend = BackendClient(session_id=ctx.session_id)
    runner = InterviewRunner(
        rubric=rubric,
        voice=voice,
        scorer=Scorer(client=anthropic_client, rubric=rubric),
        probe_generator=ProbeGenerator(client=anthropic_client, rubric=rubric),
        event_log=event_log,
        clock_now=time.monotonic,
        emit_transcript_turn=backend.post_transcript_turn,
        emit_agent_event=backend.post_agent_event,
        emit_score_checkpoint=backend.post_score_checkpoint,
        candidate_transcript_source=deepgram_transcript_source(),
    )
    logger.info(
        "starting interview runner",
        extra={"session_id": ctx.session_id, "room": ctx.room_name},
    )
    try:
        assessment = await runner.run(session_id=ctx.session_id)
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
    except CandidateSilenceTimeoutError:
        logger.info(
            "ending interview after candidate silence timeout",
            extra={"session_id": ctx.session_id, "room": ctx.room_name},
        )
        await _post_finalization_best_effort(
            backend,
            _finalization_payload(
                ctx=ctx,
                runner=runner,
                completion_reason="timeout",
                integrity_flags=["timeout"],
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
        payload["scoreCheckpointCount"] = _runner_score_checkpoint_count(runner)
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


def _runner_score_checkpoint_count(runner: Any) -> int:
    count = getattr(runner, "score_checkpoint_count", None)
    if isinstance(count, int) and count >= 0:
        return count
    sequence = getattr(runner, "_score_checkpoint_sequence", None)
    if isinstance(sequence, int) and sequence >= 0:
        return sequence
    return 0


async def _build_livekit_voice_agent(job: Any) -> Any:  # pragma: no cover — vendor wiring
    """Construct and start the LiveKit-backed VoiceAgent for the room.

    Uses the production-shaped `LiveKitSessionVoiceAgent` which handles
    participant linking, audio track subscription, reconnect grace, and
    proper event wiring. The Silero VAD comes prewarmed from `prewarm()`.
    """
    import os

    from agent.voice.livekit_session import LiveKitSessionVoiceAgent
    from agent.voice.stt import build_deepgram_stt
    from agent.voice.tts import build_cartesia_tts

    return await LiveKitSessionVoiceAgent.start(
        job,
        stt=build_deepgram_stt(os.environ["DEEPGRAM_API_KEY"]),
        tts=build_cartesia_tts(os.environ["CARTESIA_API_KEY"]),
        vad=job.proc.userdata.get("vad"),
    )
