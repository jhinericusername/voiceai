import json
from pathlib import Path
from unittest.mock import MagicMock

from agent.audit_log import AuditLogWriter
from agent.domain.types import IntegrityEvent
from agent.video.perception import VideoPerceptionPipeline
from agent.video.sampler import SampledFrame
from agent.video.vlm import VlmObservation


def _observation(signals: list[str], turn_hint: bool) -> VlmObservation:
    return VlmObservation(
        integrity_events=[
            IntegrityEvent(
                session_id="sess1", signal=s, confidence=1.0,  # type: ignore[arg-type]
                frame_timestamp_seconds=12.0,
            )
            for s in signals
        ],
        turn_hint=turn_hint,
    )


def test_pipeline_writes_integrity_events_jsonl(tmp_path: Path) -> None:
    vlm = MagicMock()
    vlm.analyze.return_value = _observation(["reading_off_screen"], turn_hint=False)
    integrity_path = tmp_path / "integrity_events.jsonl"
    pipeline = VideoPerceptionPipeline(
        vlm=vlm, session_id="sess1",
        integrity_events_path=integrity_path,
        audit_log=AuditLogWriter(tmp_path / "audit.jsonl"),
    )
    pipeline.process_frame(SampledFrame(image_bytes=b"j", timestamp_seconds=12.0))
    lines = integrity_path.read_text().strip().splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["signal"] == "reading_off_screen"


def test_pipeline_records_integrity_signal_in_audit_log(tmp_path: Path) -> None:
    vlm = MagicMock()
    vlm.analyze.return_value = _observation(["multiple_faces"], turn_hint=False)
    audit_path = tmp_path / "audit.jsonl"
    pipeline = VideoPerceptionPipeline(
        vlm=vlm, session_id="sess1",
        integrity_events_path=tmp_path / "integrity_events.jsonl",
        audit_log=AuditLogWriter(audit_path),
    )
    pipeline.process_frame(SampledFrame(image_bytes=b"j", timestamp_seconds=12.0))
    entries = [json.loads(line) for line in audit_path.read_text().splitlines()]
    assert any(e["event_type"] == "integrity_signal" for e in entries)
    assert AuditLogWriter.verify(audit_path) is True


def test_pipeline_updates_turn_hint_tracker(tmp_path: Path) -> None:
    vlm = MagicMock()
    vlm.analyze.return_value = _observation([], turn_hint=True)
    pipeline = VideoPerceptionPipeline(
        vlm=vlm, session_id="sess1",
        integrity_events_path=tmp_path / "integrity_events.jsonl",
        audit_log=AuditLogWriter(tmp_path / "audit.jsonl"),
    )
    pipeline.process_frame(SampledFrame(image_bytes=b"j", timestamp_seconds=9.0))
    assert pipeline.turn_hint.candidate_likely_formulating() is True


def test_pipeline_failure_marks_signals_unavailable(tmp_path: Path) -> None:
    vlm = MagicMock()
    vlm.analyze.side_effect = RuntimeError("VLM down")
    pipeline = VideoPerceptionPipeline(
        vlm=vlm, session_id="sess1",
        integrity_events_path=tmp_path / "integrity_events.jsonl",
        audit_log=AuditLogWriter(tmp_path / "audit.jsonl"),
    )
    # A VLM failure does not raise — video is non-critical; the interview goes on.
    pipeline.process_frame(SampledFrame(image_bytes=b"j", timestamp_seconds=9.0))
    assert pipeline.signals_available is False


def test_pipeline_collects_all_integrity_flags(tmp_path: Path) -> None:
    vlm = MagicMock()
    vlm.analyze.side_effect = [
        _observation(["reading_off_screen"], turn_hint=False),
        _observation(["multiple_faces"], turn_hint=False),
    ]
    pipeline = VideoPerceptionPipeline(
        vlm=vlm, session_id="sess1",
        integrity_events_path=tmp_path / "integrity_events.jsonl",
        audit_log=AuditLogWriter(tmp_path / "audit.jsonl"),
    )
    pipeline.process_frame(SampledFrame(image_bytes=b"j", timestamp_seconds=9.0))
    pipeline.process_frame(SampledFrame(image_bytes=b"j", timestamp_seconds=10.0))
    assert sorted(pipeline.integrity_flags()) == ["multiple_faces", "reading_off_screen"]
