from pathlib import Path
from unittest.mock import MagicMock

from agent.domain.types import TranscriptTurn
from agent.eval.corpus import CorpusItem
from agent.eval.replay import ReplayResult, replay_corpus
from agent.rubric_loader import load_rubric

RUBRIC = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")


def _scorer_stub(per_category: dict[str, int]) -> MagicMock:
    """A Scorer stub: returns the given provisional score per category."""
    from agent.scoring.io_types import CategoryAssessment, ScorerOutput

    def score(scorer_input):  # noqa: ANN001
        return ScorerOutput(
            assessments=[
                CategoryAssessment(
                    category=cat, provisional_score=per_category[cat],
                    confidence=0.9, evidence_quotes=["q"], missing_or_ambiguous=[],
                )
                for cat in scorer_input.target_categories
            ]
        )

    stub = MagicMock()
    stub.score.side_effect = score
    return stub


def _item(interview_id: str, human: dict[str, int]) -> CorpusItem:
    return CorpusItem(
        interview_id=interview_id,
        script_version="pilot-v1",
        transcript=[
            TranscriptTurn(turn_index=0, speaker="candidate", text="x", question_id="q1"),
        ],
        human_scores=human,
    )


def test_replay_scores_each_item_for_all_categories() -> None:
    corpus = [
        _item("a", {"problem_solving": 3, "agency": 2, "competitiveness": 1, "curious": 4}),
    ]
    scorer = _scorer_stub(
        {"problem_solving": 3, "agency": 2, "competitiveness": 2, "curious": 4}
    )
    results = replay_corpus(scorer, RUBRIC, corpus)
    assert len(results) == 1
    result = results[0]
    assert isinstance(result, ReplayResult)
    assert result.interview_id == "a"
    assert result.machine_scores["problem_solving"] == 3
    assert result.human_scores["agency"] == 2
    # competitiveness: machine 2 vs human 1 — recorded as-is.
    assert result.machine_scores["competitiveness"] == 2
