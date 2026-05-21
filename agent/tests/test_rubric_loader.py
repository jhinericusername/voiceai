from pathlib import Path

import pytest

from agent.rubric_loader import RubricValidationError, load_rubric

RUBRIC_PATH = Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml"


def test_loads_pilot_rubric() -> None:
    rubric = load_rubric(RUBRIC_PATH)
    assert rubric.script_version == "pilot-v1"
    assert {c.key for c in rubric.categories} == {
        "problem_solving", "agency", "competitiveness", "curious",
    }


def test_every_category_has_four_anchors() -> None:
    rubric = load_rubric(RUBRIC_PATH)
    for cat in rubric.categories:
        assert set(cat.anchors.keys()) == {1, 2, 3, 4}


def test_four_verbatim_questions_in_order() -> None:
    rubric = load_rubric(RUBRIC_PATH)
    assert [q.question_id for q in rubric.questions] == ["q1", "q2", "q3", "q4"]
    assert rubric.questions[0].verbatim_text == (
        "Can you tell me about a technically complex problem you solved "
        "with a clever or hacky solution?"
    )
    assert rubric.questions[0].rubric_categories == ["problem_solving"]


def test_bare_minimum_rule_present() -> None:
    rubric = load_rubric(RUBRIC_PATH)
    assert rubric.bare_minimum_rule == "at_least_one_4_and_problem_solving_ge_3"


def test_question_references_unknown_category_rejected(tmp_path: Path) -> None:
    bad = tmp_path / "bad.yaml"
    bad.write_text(
        "script_version: bad\n"
        "total_cap_seconds: 1800\n"
        "bare_minimum_rule: at_least_one_4_and_problem_solving_ge_3\n"
        "categories:\n"
        "  - key: problem_solving\n"
        "    name: PS\n"
        "    meaning: m\n"
        "    anchors: {1: a, 2: b, 3: c, 4: d}\n"
        "questions:\n"
        "  - question_id: q1\n"
        "    verbatim_text: t\n"
        "    rubric_categories: [nonexistent]\n"
        "    target_evidence: [e]\n"
    )
    with pytest.raises(RubricValidationError, match="nonexistent"):
        load_rubric(bad)
