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


_SELF_MANAGEMENT = (
    "RUN THE CONVERSATION YOURSELF — you have NO tools, so manage flow by hand:\n"
    "- Deliver the OPENER first, then STOP and let the candidate respond. Do not "
    "ask an interview question in the same turn as the opener.\n"
    "- Ask the questions in the given order, in their approved wording. Ask ONE "
    "question at a time, then STOP and listen. Never read the whole list at once.\n"
    "- After each answer, give a brief, natural acknowledgment before you move on.\n"
    "- If an answer is thin (it doesn't cover the listed elements), ask a short "
    "follow-up probe. Once it's covered — or after a couple of probes — move on. "
    "Do not over-probe a complete answer.\n"
    "- If the candidate pushes off-script (specific salary/equity numbers, "
    "protected topics, asking their score), briefly deflect and steer back.\n"
    "- When every question has been covered, deliver the CLOSER and end warmly.\n"
    "- Take turns like a real person: speak your turn, then wait for them to "
    "finish before you respond. Never talk over the candidate.\n"
)


_INTELLIGENT_PROBING = (
    "INTELLIGENT PROBING — listen, reflect, then fill ONLY real gaps:\n\n"
    "Each question below carries a SILENT checklist (shown as \"silently track "
    "whether they cover:\"). That is your private memory — NEVER read it aloud, "
    "never name its items as a list, never tell the candidate what you're "
    "listening for.\n\n"
    "After EVERY substantive answer, do this in your head BEFORE you speak:\n"
    "1. TICK OFF coverage. Go item by item down that question's checklist and mark "
    "which the candidate ALREADY covered. One rich answer commonly covers several "
    "— or all — at once, even said out of order or buried in a story. Credit "
    "everything they actually said. The biggest mistake to avoid is re-asking "
    "about something they already told you — it makes you sound like you weren't "
    "listening.\n"
    "2. REFLECT in ONE sentence. Say one short, warm, natural sentence mirroring "
    "back the gist of what you heard, the way an attentive person consolidates "
    "(\"So basically you did X because Y, and it ended up Z — love that\"). This "
    "is the Boardy move: it proves you listened and matters more than any "
    "follow-up. ONE sentence, your own words, never a verbatim echo, never robotic.\n"
    "3. DECIDE what, if anything, is genuinely missing, and act:\n"
    "   - Checklist mentally COMPLETE: do NOT probe. Reflect, briefly acknowledge, "
    "and move straight to the next question — even if it was all covered in their "
    "very first answer.\n"
    "   - Exactly ONE item missing: fold ONE targeted question onto the tail of "
    "your reflection, aimed only at that gap, then STOP and listen and re-tick.\n"
    "   - More than one missing: ask the single most important missing item first; "
    "only pursue the next if their answer still leaves it open.\n\n"
    "Bounds: each question's probe cap is a CEILING, not a quota — never exceed it, "
    "and stop the instant the checklist is complete (usually well under the cap). "
    "Never invent probes to fill time. The 'fallback probe wordings' are spare "
    "phrasings to reach for ONLY when that specific item is still missing — not a "
    "sequence to run through. Stay warm and present, like a curious person catching "
    "up, not a form collecting fields."
)


def _question_block(q: Question) -> str:
    lines = [f"[{q.question_id}]"]
    if q.transition_in:
        lines.append(f'  lead in naturally, e.g.: "{q.transition_in}"')
    pre = q.pre_question
    if pre and pre.ask:
        # Gated question (e.g. Q2's YC framing): ask the gating question FIRST,
        # wait for the answer, THEN — on "no" — say the framing flowing straight
        # into the real question. The framing must come BEFORE the question, not
        # after it.
        lines.append(f'  STEP 1 — ask this, then STOP and wait: "{pre.ask}"')
        if pre.branch_no:
            branch_no = " ".join(pre.branch_no.split())
            lines.append(
                "  STEP 2 — WHATEVER they answer (yes or no), always give the framing "
                "and flow STRAIGHT into the question, as ONE continuous turn: "
                f'"{branch_no} {q.verbatim_text}"'
            )
        else:
            lines.append(f'  STEP 2 — then ask: "{q.verbatim_text}"')
    else:
        lines.append(f'  ask verbatim: "{q.verbatim_text}"')
    if q.target_evidence:
        lines.append(
            "  silently track whether they cover: " + " | ".join(q.target_evidence)
        )
        lines.append(
            "  (tick these off in your head as they talk — one rich answer may cover "
            "several or all at once; NEVER read this list aloud)"
        )
        lines.append(
            "  after their answer: reflect back in ONE warm, natural sentence what you "
            f"heard (show you listened), then ask AT MOST {q.max_probes} follow-up(s), "
            "each aimed ONLY at a piece still genuinely missing. STOP the instant all "
            "are covered — even if that's right after their first answer. If everything's "
            "covered, just reflect, acknowledge, and move on; do NOT re-ask what they "
            "already told you."
        )
    for nudge in q.when_stuck:
        lines.append(f"  if they stall, nudge: {nudge}")
    if q.scripted_probes:
        lines.append(
            "  fallback probe wordings (reach for ONE only if that specific piece is "
            "still missing, in Prakul's voice — never run these in order or as a checklist):"
        )
        for p in q.scripted_probes:
            lines.append(f'    - "{p}"')
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


def _opener_block(rubric: Rubric) -> str:
    """Render the opener as a warm, natural, turn-by-turn small-talk exchange.

    The opener is NOT a monologue — it's a back-and-forth. Each numbered beat is
    its own turn: the agent says it, STOPS, and waits. Between beats the agent
    reacts naturally to whatever the candidate said (including answering if they
    ask a question back), then moves to the next beat.
    """
    o = rubric.opener
    if not o:
        return ""
    prompts = [p for p in o.small_talk_prompts if p]
    location_q = prompts[0] if len(prompts) > 0 else ""
    weather_q = prompts[1] if len(prompts) > 1 else ""
    recip = o.reciprocation.strip().rstrip(".")
    intro = " ".join(o.introduction.split())

    lines = [
        "OPENER — warm small talk. STOP and wait ONLY at the ⏸ marks. Every turn "
        "after the greeting COMBINES your reaction to what they just said WITH your "
        "next question, in ONE breath — NEVER acknowledge and then go silent, and "
        "never split an acknowledgment and its question into two separate turns.",
        f'  1) Greet: "{o.greeting}"  ⏸ wait.',
    ]
    if location_q:
        lines.append(
            '  2) ONE turn: warmly acknowledge their reply with a short filler '
            '(e.g. "Nice, nice —"), and ONLY if they asked how you are add that '
            "you're doing well, then in the SAME breath ask "
            f'"{location_q}"  ⏸ wait.'
        )
    if weather_q:
        recip_clause = f' (feel free to reciprocate, e.g. "{recip}")' if recip else ""
        lines.append(
            "  3) ONE turn: react warmly to where they're calling from"
            f'{recip_clause}, and in the SAME sentence ask "{weather_q}"  ⏸ wait.'
        )
    if o.introduction:
        lines.append(
            "  4) ONE turn: react briefly, then introduce yourself and hand off: "
            f'"{intro}"  ⏸ wait for their answer, then begin the first question.'
        )
    return "\n".join(lines)


def _closer_text(rubric: Rubric) -> str:
    c = rubric.closer
    if not c or not c.wrap:
        return "That's everything I wanted to cover. Thank you for your time."
    parts = [c.logistics_lead_in, *c.logistics_questions, c.wrap]
    return " ".join(p for p in parts if p)


def _closer_block(rubric: Rubric) -> str:
    """Render the closer as a turn-structured script.

    Each logistics question is a SEPARATE turn the agent must wait on, instead
    of firing both questions and the goodbye in one breath (same fix as the
    opener).
    """
    c = rubric.closer
    if not c or not c.wrap:
        return (
            "CLOSER (only after all questions are covered):\n"
            "  That's everything I wanted to cover. Thank you for your time."
        )
    lines = [
        "CLOSER — only after every question is covered. Deliver as SEPARATE turns:"
    ]
    if c.logistics_lead_in:
        lines.append(f'  Lead in: "{c.logistics_lead_in}"')
    for q in c.logistics_questions:
        if q:
            lines.append(f'  Ask this, then STOP and wait for their answer: "{q}"')
    wrap = " ".join(c.wrap.split())
    lines.append(f'  Then wrap up and say goodbye: "{wrap}"')
    return "\n".join(lines)


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


def build_interview_plan(rubric: Rubric, *, include_tools: bool = True) -> InterviewPlan:
    """Assemble the interview system prompt + tool schemas.

    ``include_tools=True`` (default) emits the control-tool protocol and the four
    tool schemas — used by the WS eval transport, which registers them with the
    model. ``include_tools=False`` emits a prose self-management protocol and no
    tool schemas, for the LiveKit room path where the model runs the interview
    purely from the prompt (a structured gpt-realtime session) — no tools are
    registered there, so instructing the model to call them would only confuse it.
    """
    opener = _opener_block(rubric)
    closer = _closer_text(rubric)
    question_blocks = "\n".join(_question_block(q) for q in rubric.questions)
    flow_protocol = _TOOL_USAGE if include_tools else _SELF_MANAGEMENT
    instructions = "\n\n".join(
        filter(
            None,
            [
                _persona(rubric),
                _style_block(rubric),
                _INTELLIGENT_PROBING,
                opener,
                f"QUESTIONS (ask in this order, verbatim):\n{question_blocks}",
                _closer_block(rubric),
                _WEAVE_FACTS,
                _GUARDRAILS,
                flow_protocol,
            ],
        )
    )
    return InterviewPlan(
        instructions=instructions,
        tool_schemas=_tool_schemas() if include_tools else [],
        required_coverage=[
            RequiredQuestion(question_id=q.question_id, verbatim_text=q.verbatim_text)
            for q in rubric.questions
        ],
        closer_text=closer,
    )
