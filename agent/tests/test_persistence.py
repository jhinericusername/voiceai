import json

from agent.domain.types import Assessment, CategoryScore
from agent.worker.persistence import build_assessment_insert


def _assessment() -> Assessment:
    return Assessment(
        session_id="sess1",
        script_version="pilot-v1",
        category_scores=[
            CategoryScore(
                category="problem_solving", score=4, confidence=0.9,
                evidence_quotes=["q"], rationale="r", low_confidence=False,
            )
        ],
        meets_bare_minimum=True,
        integrity_flags=[],
    )


def test_build_assessment_insert_targets_assessments_table() -> None:
    stmt = build_assessment_insert(_assessment())
    assert "INSERT INTO assessments" in stmt.sql
    assert stmt.params[0] == "sess1"
    assert stmt.params[1] == "pilot-v1"
    decoded = json.loads(stmt.params[2])
    assert decoded[0]["category"] == "problem_solving"
    assert decoded[0]["score"] == 4
    assert stmt.params[3] is True
    assert json.loads(stmt.params[4]) == []
