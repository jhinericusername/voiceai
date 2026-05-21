import json
from pathlib import Path

from agent.audit_log import AuditLogWriter


def test_appends_entries_as_jsonl(tmp_path: Path) -> None:
    log = tmp_path / "audit.jsonl"
    writer = AuditLogWriter(log)
    writer.write("score_recorded", {"category": "agency", "score": 3})
    writer.write("signoff", {"reviewer": "r@example.com"})

    lines = log.read_text().strip().splitlines()
    assert len(lines) == 2
    first = json.loads(lines[0])
    assert first["event_type"] == "score_recorded"
    assert first["payload"]["category"] == "agency"
    assert "timestamp" in first
    assert "entry_hash" in first


def test_entries_are_hash_chained(tmp_path: Path) -> None:
    log = tmp_path / "audit.jsonl"
    writer = AuditLogWriter(log)
    writer.write("a", {})
    writer.write("b", {})

    lines = [json.loads(line) for line in log.read_text().strip().splitlines()]
    assert lines[0]["prev_hash"] is None
    assert lines[1]["prev_hash"] == lines[0]["entry_hash"]


def test_verify_detects_tampering(tmp_path: Path) -> None:
    log = tmp_path / "audit.jsonl"
    writer = AuditLogWriter(log)
    writer.write("a", {"v": 1})
    writer.write("b", {"v": 2})
    assert AuditLogWriter.verify(log) is True

    lines = log.read_text().strip().splitlines()
    tampered = json.loads(lines[0])
    tampered["payload"] = {"v": 999}
    log.write_text(json.dumps(tampered) + "\n" + lines[1] + "\n")
    assert AuditLogWriter.verify(log) is False


def test_writer_does_not_overwrite_existing_entries(tmp_path: Path) -> None:
    log = tmp_path / "audit.jsonl"
    AuditLogWriter(log).write("first", {})
    # A fresh writer on the same file continues the chain.
    AuditLogWriter(log).write("second", {})
    lines = [json.loads(line) for line in log.read_text().strip().splitlines()]
    assert [entry["event_type"] for entry in lines] == ["first", "second"]
    assert lines[1]["prev_hash"] == lines[0]["entry_hash"]
    assert AuditLogWriter.verify(log) is True
