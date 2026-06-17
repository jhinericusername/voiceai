from agent.controller.realtime.plan_builder import build_interview_plan
from agent.rubric_loader import load_rubric
from pathlib import Path

RUBRIC = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")


def test_instructions_contain_persona_and_every_verbatim():
    plan = build_interview_plan(RUBRIC)
    assert "Weave" in plan.instructions
    for q in RUBRIC.questions:
        assert q.verbatim_text in plan.instructions


def test_instructions_contain_guardrails():
    text = build_interview_plan(RUBRIC).instructions.lower()
    for needle in ["compensation", "protected", "do not invent", "score"]:
        assert needle in text


def test_required_coverage_is_every_question():
    plan = build_interview_plan(RUBRIC)
    assert [r.question_id for r in plan.required_coverage] == [q.question_id for q in RUBRIC.questions]


def test_tool_schemas_expose_the_four_tools():
    names = {t["name"] for t in build_interview_plan(RUBRIC).tool_schemas}
    assert names == {"advance_question", "request_probe", "flag_off_script", "close_interview"}
