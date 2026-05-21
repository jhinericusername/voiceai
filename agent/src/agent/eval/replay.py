"""Replay the corpus through the Scorer in standalone mode."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from agent.domain.types import Rubric
from agent.eval.corpus import CorpusItem
from agent.scoring.io_types import ScorerInput
from agent.scoring.scorer import Scorer


class ReplayResult(BaseModel):
    """Machine vs. human scores for one replayed corpus interview."""

    model_config = ConfigDict(frozen=True)

    interview_id: str
    machine_scores: dict[str, int]
    human_scores: dict[str, int]


def replay_corpus(
    scorer: Scorer, rubric: Rubric, corpus: list[CorpusItem]
) -> list[ReplayResult]:
    """Score every corpus interview for every rubric category.

    The Scorer is run standalone over the full transcript with all
    categories in play — the same component used live, run one way.
    """
    all_categories = [c.key for c in rubric.categories]
    results: list[ReplayResult] = []
    for item in corpus:
        scorer_input = ScorerInput(
            script_version=item.script_version,
            question_id="full_interview",
            target_categories=all_categories,
            transcript=item.transcript,
        )
        output = scorer.score(scorer_input)
        by_cat = output.by_category()
        machine_scores = {
            cat: by_cat[cat].provisional_score
            for cat in all_categories
            if cat in by_cat
        }
        results.append(
            ReplayResult(
                interview_id=item.interview_id,
                machine_scores=machine_scores,
                human_scores=item.human_scores,
            )
        )
    return results
