from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.worker.entrypoint import InterviewJobContext, build_session_context

_META = (
    '{"session_id": "sess1", "org_id": "org1", '
    '"script_version": "pilot-v1", "candidate_email": "c@example.com"}'
)


def _fake_ctx(metadata: str | None, room_name: str = "interview-sess1") -> MagicMock:
    ctx = MagicMock()
    ctx.job.metadata = metadata
    ctx.room.name = room_name
    return ctx


def test_build_session_context_reads_job_metadata() -> None:
    ctx = build_session_context(_fake_ctx(_META))
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
    ctx = _fake_ctx('{"org_id": "org1", "script_version": "pilot-v1"}')
    with pytest.raises(ValueError, match="session_id"):
        build_session_context(ctx)


def test_build_session_context_rejects_empty_metadata() -> None:
    with pytest.raises(ValueError):
        build_session_context(_fake_ctx(None))
