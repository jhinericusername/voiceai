from unittest.mock import AsyncMock, MagicMock

from agent.worker.recording import (
    EgressRecorder,
    RecordingStatus,
    build_egress_request,
)


def test_build_egress_request_targets_spec_storage_paths() -> None:
    request = build_egress_request(
        room_name="interview-sess1", org_id="org1", session_id="sess1"
    )
    assert request["room_name"] == "interview-sess1"
    assert request["composite"] == "/org1/interviews/sess1/media/composite.mp4"
    assert request["candidate_video"] == (
        "/org1/interviews/sess1/media/candidate_video.mp4"
    )
    assert request["candidate_audio"] == (
        "/org1/interviews/sess1/media/candidate_audio.m4a"
    )
    assert request["agent_audio"] == "/org1/interviews/sess1/media/agent_audio.m4a"


async def test_recorder_start_returns_egress_id() -> None:
    client = MagicMock()
    client.start_egress = AsyncMock(return_value={"egress_id": "eg_123"})
    recorder = EgressRecorder(
        client=client, room_name="interview-sess1", org_id="org1", session_id="sess1"
    )
    egress_id = await recorder.start()
    assert egress_id == "eg_123"
    assert recorder.egress_id == "eg_123"


async def test_recorder_finalize_succeeds_on_complete_status() -> None:
    client = MagicMock()
    client.start_egress = AsyncMock(return_value={"egress_id": "eg_123"})
    client.get_egress = AsyncMock(return_value={"status": "EGRESS_COMPLETE"})
    recorder = EgressRecorder(
        client=client, room_name="r", org_id="org1", session_id="sess1"
    )
    await recorder.start()
    status = await recorder.finalize(max_attempts=1, delay_seconds=0.0)
    assert status == RecordingStatus.COMPLETE


async def test_recorder_finalize_retries_then_reports_failed() -> None:
    client = MagicMock()
    client.start_egress = AsyncMock(return_value={"egress_id": "eg_123"})
    client.get_egress = AsyncMock(return_value={"status": "EGRESS_FAILED"})
    recorder = EgressRecorder(
        client=client, room_name="r", org_id="org1", session_id="sess1"
    )
    await recorder.start()
    status = await recorder.finalize(max_attempts=3, delay_seconds=0.0)
    assert status == RecordingStatus.FAILED
    assert client.get_egress.await_count == 3
