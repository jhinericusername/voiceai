import json
from pathlib import Path

import pytest

from agent.controller.event_log import EventLog


def test_logs_scripted_question_with_reason_code(tmp_path: Path) -> None:
    log = EventLog(session_id="s1", path=tmp_path / "agent_events.jsonl")
    log.record_utterance(
        utterance="Can you tell me about a hard problem?",
        reason_code="SCRIPTED_QUESTION",
        question_id="q1",
    )
    lines = (tmp_path / "agent_events.jsonl").read_text().strip().splitlines()
    entry = json.loads(lines[0])
    assert entry["reason_code"] == "SCRIPTED_QUESTION"
    assert entry["question_id"] == "q1"
    assert entry["utterance"].startswith("Can you tell me")


def test_probe_event_records_category_and_missing_element(tmp_path: Path) -> None:
    log = EventLog(session_id="s1", path=tmp_path / "agent_events.jsonl")
    log.record_utterance(
        utterance="What was the measurable impact?",
        reason_code="PROBE_LOW_CONFIDENCE",
        question_id="q1",
        category="problem_solving",
        missing_element="impact and recognition unclear",
    )
    entry = json.loads(
        (tmp_path / "agent_events.jsonl").read_text().strip().splitlines()[0]
    )
    assert entry["category"] == "problem_solving"
    assert entry["missing_element"] == "impact and recognition unclear"


def test_all_reason_codes_accepted(tmp_path: Path) -> None:
    log = EventLog(session_id="s1", path=tmp_path / "agent_events.jsonl")
    for code in (
        "CONSENT", "INTRO", "SCRIPTED_QUESTION", "PROBE_LOW_CONFIDENCE",
        "AUDIO_REPAIR", "TIMEBOX_MOVE_ON", "CLOSING",
    ):
        log.record_utterance(utterance="x", reason_code=code, question_id=None)
    lines = (tmp_path / "agent_events.jsonl").read_text().strip().splitlines()
    assert len(lines) == 7


def test_rejects_unknown_reason_code(tmp_path: Path) -> None:
    log = EventLog(session_id="s1", path=tmp_path / "agent_events.jsonl")
    with pytest.raises(ValueError, match="reason_code"):
        log.record_utterance(utterance="x", reason_code="BOGUS", question_id=None)


def test_events_returns_recorded_agent_events(tmp_path: Path) -> None:
    log = EventLog(session_id="s1", path=tmp_path / "agent_events.jsonl")
    log.record_utterance(utterance="Welcome.", reason_code="INTRO", question_id=None)
    events = log.events()
    assert len(events) == 1
    assert events[0].reason_code == "INTRO"
    assert events[0].session_id == "s1"
