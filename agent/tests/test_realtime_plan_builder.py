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


def test_instructions_include_completeness_exemplars():
    plan = build_interview_plan(RUBRIC)
    q = next(q for q in RUBRIC.questions if q.target_evidence)
    # Each evidence element appears in the instructions as completeness guidance.
    for element in q.target_evidence:
        assert element in plan.instructions
    assert "complete answer covers" in plan.instructions.lower()
    assert "stop probing" in plan.instructions.lower()


def test_persona_content_updates_present():
    from pathlib import Path
    from agent.rubric_loader import load_rubric
    from agent.controller.realtime.plan_builder import build_interview_plan
    rubric = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")
    instr = build_interview_plan(rubric).instructions
    # AI disclosure in the opener
    assert "an AI modeled after Prakul" in instr
    # Q1 worked example (cache story) + Q3 worked example (competitiveness)
    assert "in-memory cache" in instr
    assert "competitive" in instr.lower()
    # Warm close
    assert "thanks so much for your time" in instr.lower()


def test_instructions_surface_acknowledgments():
    from pathlib import Path
    from agent.rubric_loader import load_rubric
    from agent.controller.realtime.plan_builder import build_interview_plan
    rubric = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")
    instr = build_interview_plan(rubric).instructions
    assert "Got it. Got it. Got it." in instr            # a real ack phrase surfaced
    assert "acknowledg" in instr.lower()                 # the guidance framing
