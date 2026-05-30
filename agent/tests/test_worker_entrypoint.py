from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.worker.entrypoint import InterviewJobContext, build_session_context


def test_build_session_context_extracts_metadata() -> None:
    job = MagicMock()
    job.room.name = "interview-sess1"
    job.metadata = (
        '{"session_id": "sess1", "org_id": "org1", '
        '"script_version": "pilot-v1", "candidate_email": "c@example.com"}'
    )
    ctx = build_session_context(job)
    assert isinstance(ctx, InterviewJobContext)
    assert ctx.session_id == "sess1"
    assert ctx.org_id == "org1"
    assert ctx.script_version == "pilot-v1"
    assert ctx.room_name == "interview-sess1"


def test_build_session_context_extracts_livekit_job_metadata() -> None:
    job = SimpleNamespace(
        job=SimpleNamespace(
            metadata=(
                '{"session_id": "sess1", "org_id": "org1", '
                '"script_version": "pilot-v1", "candidate_email": "c@example.com"}'
            )
        ),
        room=SimpleNamespace(name="interview-sess1"),
    )
    ctx = build_session_context(job)
    assert isinstance(ctx, InterviewJobContext)
    assert ctx.session_id == "sess1"
    assert ctx.org_id == "org1"
    assert ctx.script_version == "pilot-v1"
    assert ctx.room_name == "interview-sess1"


def test_build_session_context_rejects_missing_session_id() -> None:
    job = MagicMock()
    job.room.name = "interview-x"
    job.metadata = '{"org_id": "org1", "script_version": "pilot-v1"}'
    with pytest.raises(ValueError, match="session_id"):
        build_session_context(job)


async def test_entrypoint_connects_and_waits_for_participant() -> None:
    job = MagicMock()
    job.room.name = "interview-sess1"
    job.metadata = (
        '{"session_id": "sess1", "org_id": "org1", '
        '"script_version": "pilot-v1", "candidate_email": "c@example.com"}'
    )
    job.connect = AsyncMock()
    job.wait_for_participant = AsyncMock(return_value=MagicMock())
    ran: dict[str, object] = {}

    async def fake_run(ctx, participant):  # noqa: ANN001
        ran["session_id"] = ctx.session_id
        ran["participant"] = participant

    from agent.worker import entrypoint as ep

    await ep.entrypoint(job, _run_interview=fake_run)
    job.connect.assert_awaited_once()
    job.wait_for_participant.assert_awaited_once()
    assert ran["session_id"] == "sess1"
