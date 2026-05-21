import json
from pathlib import Path

import pytest

from agent.eval.corpus import CorpusItem, load_corpus


def _write_item(directory: Path, name: str, payload: dict) -> None:
    (directory / name).write_text(json.dumps(payload))


def test_loads_corpus_items(tmp_path: Path) -> None:
    _write_item(
        tmp_path,
        "interview_001.json",
        {
            "interview_id": "interview_001",
            "script_version": "pilot-v1",
            "transcript": [
                {"turn_index": 0, "speaker": "agent", "text": "q1", "question_id": "q1"},
                {"turn_index": 1, "speaker": "candidate", "text": "answer", "question_id": "q1"},
            ],
            "human_scores": {
                "problem_solving": 3, "agency": 2,
                "competitiveness": 1, "curious": 4,
            },
        },
    )
    items = load_corpus(tmp_path)
    assert len(items) == 1
    item = items[0]
    assert isinstance(item, CorpusItem)
    assert item.interview_id == "interview_001"
    assert item.human_scores["curious"] == 4
    assert item.transcript[1].speaker == "candidate"


def test_load_corpus_ignores_non_json(tmp_path: Path) -> None:
    (tmp_path / "notes.txt").write_text("ignore me")
    _write_item(
        tmp_path,
        "a.json",
        {
            "interview_id": "a", "script_version": "pilot-v1",
            "transcript": [
                {"turn_index": 0, "speaker": "candidate", "text": "x", "question_id": "q1"}
            ],
            "human_scores": {
                "problem_solving": 1, "agency": 1,
                "competitiveness": 1, "curious": 1,
            },
        },
    )
    assert len(load_corpus(tmp_path)) == 1


def test_load_corpus_rejects_missing_human_scores(tmp_path: Path) -> None:
    _write_item(
        tmp_path,
        "bad.json",
        {
            "interview_id": "bad", "script_version": "pilot-v1",
            "transcript": [
                {"turn_index": 0, "speaker": "candidate", "text": "x", "question_id": "q1"}
            ],
        },
    )
    with pytest.raises(ValueError, match="human_scores"):
        load_corpus(tmp_path)
