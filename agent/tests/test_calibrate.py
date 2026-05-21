import json
from pathlib import Path
from unittest.mock import MagicMock

from agent.eval.calibrate import run_calibration
from agent.eval.replay import ReplayResult


def test_run_calibration_writes_report(tmp_path: Path, monkeypatch) -> None:
    fake_results = [
        ReplayResult(
            interview_id="a",
            machine_scores={"problem_solving": 3, "agency": 2,
                            "competitiveness": 1, "curious": 4},
            human_scores={"problem_solving": 3, "agency": 2,
                          "competitiveness": 1, "curious": 4},
        )
    ]
    monkeypatch.setattr("agent.eval.calibrate.load_corpus", lambda _d: ["item"])
    monkeypatch.setattr(
        "agent.eval.calibrate.replay_corpus", lambda *_a: fake_results
    )

    report_path = tmp_path / "calibration_report.json"
    report = run_calibration(
        scorer=MagicMock(),
        rubric=MagicMock(),
        corpus_dir=tmp_path,
        report_path=report_path,
        pass_threshold_within_one=0.8,
    )
    assert report.passes is True
    written = json.loads(report_path.read_text())
    assert written["exact_match_rate"] == 1.0
    assert written["within_one_rate"] == 1.0
    assert written["passes"] is True
