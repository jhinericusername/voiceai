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
    assert "silently track whether they cover" in plan.instructions.lower()
    assert "fallback probe wordings" in plan.instructions.lower()


def test_intelligent_probing_block_present_once_in_both_paths():
    for include_tools in (True, False):
        instr = build_interview_plan(RUBRIC, include_tools=include_tools).instructions
        assert instr.count("INTELLIGENT PROBING") == 1


def test_question_without_scripted_probes_renders_no_fallback_section():
    from agent.controller.realtime.plan_builder import _question_block

    q2 = next(q for q in RUBRIC.questions if q.question_id == "q2")
    assert q2.scripted_probes == []
    assert "fallback probe wordings" not in _question_block(q2)


def test_persona_demands_accent_persistence_throughout():
    instr = build_interview_plan(RUBRIC).instructions.lower()
    # The accent must be instructed to hold for the whole interview, not just
    # the opening, and to re-anchor rather than drift.
    assert "australian" in instr
    assert "entire interview" in instr
    assert "drift" in instr


def test_persona_content_updates_present():
    from pathlib import Path
    from agent.rubric_loader import load_rubric
    from agent.controller.realtime.plan_builder import build_interview_plan
    rubric = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")
    instr = build_interview_plan(rubric).instructions
    # AI disclosure in the opener — self-identifies as Puddle, an agent modeled
    # after Prakul.
    assert "Puddle" in instr
    assert "an agent modeled after Prakul" in instr
    # Q1 worked example (cache story) + Q3 worked example (competitiveness)
    assert "in-memory cache" in instr
    assert "Smash Bros" in instr
    # Warm close
    assert "thanks so much for your time" in instr.lower()


def test_instructions_surface_acknowledgments():
    from pathlib import Path
    from agent.rubric_loader import load_rubric
    from agent.controller.realtime.plan_builder import build_interview_plan
    rubric = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")
    instr = build_interview_plan(rubric).instructions
    assert "Got it." in instr                            # a single, de-chained ack surfaced
    assert "never chain" in instr.lower()                # no-chaining rule present
    assert "acknowledg" in instr.lower()                 # the guidance framing
    assert "STYLE — sound like a warm, natural human, not a form" in instr  # _style_block contribution


def test_instructions_include_weave_facts_allowlist():
    from pathlib import Path
    from agent.rubric_loader import load_rubric
    from agent.controller.realtime.plan_builder import build_interview_plan
    rubric = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")
    instr = build_interview_plan(rubric).instructions
    assert "understand and quantify the work software engineers do" in instr
    assert "open to negotiation" in instr            # relaxed comp line present
    assert "FACTS YOU MAY SHARE" in instr


def test_guardrails_relax_comp_and_startdate_but_block_specifics():
    from agent.controller.realtime.plan_builder import _GUARDRAILS
    g = _GUARDRAILS.lower()
    # No longer a blanket comp ban:
    assert "never discuss compensation" not in g
    # Still hard-blocks specifics + scoring + protected:
    assert "specific salary" in g or "specific numbers" in g
    assert "score" in g
    assert "protected" in g


def test_tool_usage_offscript_does_not_treat_general_comp_as_violation():
    from agent.controller.realtime.plan_builder import _TOOL_USAGE
    # comp is now allowed via sanctioned language; only specific numbers stay off-script
    assert "off-script (comp," not in _TOOL_USAGE
    assert "specific salary/equity numbers" in _TOOL_USAGE
