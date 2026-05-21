"""Roll provisional per-category assessments into a final `Assessment`."""

from __future__ import annotations

from agent.domain.types import Assessment, CategoryScore
from agent.scoring.io_types import CategoryAssessment


def meets_bare_minimum(scores: dict[str, int]) -> bool:
    """Apply the pilot bare-minimum rule.

    Rule: at least one dimension scored 4, AND problem_solving >= 3.
    """
    has_a_four = any(score == 4 for score in scores.values())
    ps_ok = scores.get("problem_solving", 0) >= 3
    return has_a_four and ps_ok


def roll_up_assessment(
    session_id: str,
    script_version: str,
    final_assessments: dict[str, CategoryAssessment],
    integrity_flags: list[str],
    confidence_threshold: float,
) -> Assessment:
    """Convert the final per-category assessments into an `Assessment`.

    A category whose confidence is below `confidence_threshold` is recorded
    with `low_confidence=True` and flagged for the reviewer.
    """
    category_scores: list[CategoryScore] = []
    plain_scores: dict[str, int] = {}
    for category, ca in final_assessments.items():
        plain_scores[category] = ca.provisional_score
        category_scores.append(
            CategoryScore(
                category=category,
                score=ca.provisional_score,
                confidence=ca.confidence,
                evidence_quotes=ca.evidence_quotes,
                rationale="; ".join(ca.missing_or_ambiguous) or "evidence sufficient",
                low_confidence=ca.confidence < confidence_threshold,
            )
        )
    return Assessment(
        session_id=session_id,
        script_version=script_version,
        category_scores=category_scores,
        meets_bare_minimum=meets_bare_minimum(plain_scores),
        integrity_flags=integrity_flags,
    )
