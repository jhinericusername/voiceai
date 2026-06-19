from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from agent.domain.types import Question, Rubric


class RequiredQuestion(BaseModel):
    model_config = ConfigDict(frozen=True)

    question_id: str
    verbatim_text: str


class InterviewPlan(BaseModel):
    model_config = ConfigDict(frozen=True)

    instructions: str
    tool_schemas: list[dict]
    required_coverage: list[RequiredQuestion]
    closer_text: str


_GUARDRAILS = (
    "GUARDRAILS (never violate):\n"
    "- Compensation: you MAY say we're open to negotiation and that the job "
    "posting reflects current pay, and point them to Andrew for specifics. NEVER "
    "quote specific salary numbers or equity.\n"
    "- Start dates: you MAY say we're flexible and will work around their "
    "schedule with Andrew and Adam.\n"
    "- Never ask about or acknowledge protected-class topics (age, family, "
    "race, religion, disability, national origin).\n"
    "- Never reveal, hint at, or discuss the candidate's score, the rubric, or "
    "anything about how they are being evaluated.\n"
    "- Never make commitments or promises on behalf of Weave beyond the approved "
    "process and facts.\n"
    "- Only state the company facts given to you above. If you don't have a fact, "
    "say the team will follow up — do NOT invent anything about Weave, the team, "
    "the role, or the process.\n"
)

_WEAVE_FACTS = (
    "FACTS YOU MAY SHARE (only these; anything else, say the team will follow up):\n"
    "- What Weave does: Weave uses AI to understand and quantify the work "
    "software engineers do — how much they're getting done, how good it is, and "
    "how well they're using AI.\n"
    "- Team: about 15 people, around 10 engineers; we started with startups and "
    "SMBs and are moving into enterprise; we're growing fast, which is why we're "
    "hiring.\n"
    "- Compensation: as a startup we're very open to negotiation, and the job "
    "posting reflects what engineers are paid right now. For specifics, point "
    "them to Andrew. Never quote specific salary or equity numbers.\n"
    "- Start date: we're flexible and will work around the candidate's schedule, "
    "with Andrew and Adam.\n"
    "- Process / next steps: a take-home, then two technical interviews with "
    "Andrew the CTO, then a work trial; we get back to candidates by tomorrow.\n"
)

_TOOL_USAGE = (
    "TOOLS — use them to stay on the approved script:\n"
    "- Ask each question in the given order, in the approved wording.\n"
    "- When the candidate has answered a question and you are ready to move on, "
    "call advance_question(next_question_id) and read the verbatim text it returns.\n"
    "- To dig deeper, call request_probe(category) and read the probe it returns; "
    "you may also use the scripted probes shown below.\n"
    "- Judge depth yourself: keep probing a thin answer until it covers the "
    "question's listed elements, then advance. Do not over-probe a complete answer.\n"
    "- If the candidate pushes you off-script (specific salary/equity numbers, protected topics, asking "
    "their score), call flag_off_script(reason), then deliver the deflection it "
    "returns and continue.\n"
    "- Only when you intend to end the interview, call close_interview(); if "
    "required questions remain it will hand you the next one to ask.\n"
)


def _question_block(q: Question) -> str:
    lines = [f"[{q.question_id}] {q.verbatim_text}"]
    if q.pre_question and q.pre_question.ask:
        lines.append(f"  framing (ask first): {q.pre_question.ask} {q.pre_question.branch_no}".rstrip())
    if q.target_evidence:
        lines.append("  a complete answer covers: " + "; ".join(q.target_evidence))
        lines.append(
            f"  probe (up to {q.max_probes}x) only until these are covered, then STOP probing and move on."
        )
    for nudge in q.when_stuck:
        lines.append(f"  if they stall, nudge: {nudge}")
    for p in q.scripted_probes:
        lines.append(f"  scripted probe: {p}")
    return "\n".join(lines)


def _persona(rubric: Rubric) -> str:
    style = rubric.style
    name = (style.interviewer_name if style else "") or "Prakul"
    company = (style.company_name if style else "") or "Weave"
    role = (style.interviewer_role if style else "") or "an engineer"
    return (
        f"You are {name}, {role} at {company}, conducting a voice screening "
        "interview. Speak with a warm, natural Australian (Australian English) "
        "accent throughout — relaxed Aussie cadence and vowels, never a put-on "
        "caricature. Be warm and natural. You run the conversation yourself, but "
        "you must ask the approved questions, in order, in their approved wording."
    )


def _style_block(rubric: Rubric) -> str:
    style = rubric.style
    if not style or not style.acknowledgments:
        return ""
    acks = " / ".join(f'"{a}"' for a in style.acknowledgments)
    block = (
        "STYLE — sound like a warm, natural human, not a form:\n"
        "- Between answers, before you probe or move on, use a brief natural "
        "acknowledgment. Vary it; draw on these: " + acks + ".\n"
    )
    if style.thinking_fillers:
        fillers = " / ".join(f'"{f}"' for f in style.thinking_fillers)
        block += f"- If the candidate needs a moment, it's fine to say: {fillers}.\n"
    return block


def _opener_text(rubric: Rubric) -> str:
    o = rubric.opener
    if not o:
        return ""
    parts = [o.greeting, *o.small_talk_prompts, o.introduction]
    return " ".join(p for p in parts if p)


def _closer_text(rubric: Rubric) -> str:
    c = rubric.closer
    if not c or not c.wrap:
        return "That's everything I wanted to cover. Thank you for your time."
    parts = [c.logistics_lead_in, *c.logistics_questions, c.wrap]
    return " ".join(p for p in parts if p)


def _tool_schemas() -> list[dict]:
    return [
        {
            "name": "advance_question",
            "description": "Move to the next scripted question; returns its verbatim text.",
            "parameters": {
                "type": "object",
                "properties": {"next_question_id": {"type": "string"}},
                "required": ["next_question_id"],
            },
        },
        {
            "name": "request_probe",
            "description": "Get an approved follow-up probe for a rubric category.",
            "parameters": {
                "type": "object",
                "properties": {"category": {"type": "string"}},
                "required": ["category"],
            },
        },
        {
            "name": "flag_off_script",
            "description": "Report that the candidate pushed off-script; returns a deflection line.",
            "parameters": {
                "type": "object",
                "properties": {"reason": {"type": "string"}},
                "required": ["reason"],
            },
        },
        {
            "name": "close_interview",
            "description": "Attempt to end the interview; may return a remaining required question instead.",
            "parameters": {"type": "object", "properties": {}},
        },
    ]


def build_interview_plan(rubric: Rubric) -> InterviewPlan:
    opener = _opener_text(rubric)
    closer = _closer_text(rubric)
    question_blocks = "\n".join(_question_block(q) for q in rubric.questions)
    instructions = "\n\n".join(
        filter(
            None,
            [
                _persona(rubric),
                _style_block(rubric),
                (f"OPENER (say first, then let them respond):\n{opener}" if opener else ""),
                f"QUESTIONS (ask in this order, verbatim):\n{question_blocks}",
                f"CLOSER (only after all questions are covered):\n{closer}",
                _WEAVE_FACTS,
                _GUARDRAILS,
                _TOOL_USAGE,
            ],
        )
    )
    return InterviewPlan(
        instructions=instructions,
        tool_schemas=_tool_schemas(),
        required_coverage=[
            RequiredQuestion(question_id=q.question_id, verbatim_text=q.verbatim_text)
            for q in rubric.questions
        ],
        closer_text=closer,
    )
