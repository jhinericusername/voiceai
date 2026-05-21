import json
from pathlib import Path
from unittest.mock import MagicMock

from agent.eval.calibrate import run_calibration
from agent.eval.corpus import CorpusItem
from agent.rubric_loader import load_rubric
from agent.scoring.io_types import CategoryAssessment, ScorerOutput

RUBRIC = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")


def _corpus_item(interview_id: str, scores: dict[str, int]) -> dict:
    return {
        "interview_id": interview_id,
        "script_version": "pilot-v1",
        "transcript": [
            {"turn_index": 0, "speaker": "agent", "text": "q1", "question_id": "q1"},
            {"turn_index": 1, "speaker": "candidate", "text": "answer", "question_id": "q1"},
        ],
        "human_scores": scores,
    }


def _perfect_scorer() -> MagicMock:
    """A Scorer stub that reproduces the human scores exactly."""
    scorer = MagicMock()

    def score(scorer_input):  # noqa: ANN001
        # The stub echoes a fixed score; the corpus below is built to match.
        return ScorerOutput(
            assessments=[
                CategoryAssessment(
                    category=cat, provisional_score=3, confidence=0.9,
                    evidence_quotes=["q"], missing_or_ambiguous=[],
                )
                for cat in scorer_input.target_categories
            ]
        )

    scorer.score.side_effect = score
    return scorer


def test_e2e_calibration_runs_end_to_end_and_writes_report(tmp_path: Path) -> None:
    corpus_dir = tmp_path / "corpus"
    corpus_dir.mkdir()
    for i in range(3):
        (corpus_dir / f"interview_{i}.json").write_text(
            json.dumps(
                _corpus_item(
                    f"interview_{i}",
                    {
                        "problem_solving": 3, "agency": 3,
                        "competitiveness": 3, "curious": 3,
                    },
                )
            )
        )
    report_path = tmp_path / "calibration_report.json"
    report = run_calibration(
        scorer=_perfect_scorer(),
        rubric=RUBRIC,
        corpus_dir=corpus_dir,
        report_path=report_path,
        pass_threshold_within_one=0.85,
    )
    # The stub reproduces every human score exactly -> perfect agreement.
    assert report.exact_match_rate == 1.0
    assert report.within_one_rate == 1.0
    assert report.passes is True
    assert report.n_pairs == 12  # 3 interviews x 4 categories
    written = json.loads(report_path.read_text())
    assert written["passes"] is True
    assert set(written["per_category"].keys()) == {
        "problem_solving", "agency", "competitiveness", "curious",
    }
