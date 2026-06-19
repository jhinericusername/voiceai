# Interviewer Persona & Content (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the realtime interviewer's persona/content production-ready — AI disclosure, surfaced acknowledgment phrases, worked examples for every question, a Weave-facts allow-list, and a comp/start-date guardrail relaxation — all on the current realtime path.

**Architecture:** Content + instruction changes only, in `rubric/pilot-v1.yaml`, `agent/src/agent/controller/realtime/plan_builder.py` (builds the model's instructions), and `agent/src/agent/controller/realtime/guardrail_monitor.py` (the Haiku violation classifier). No controller, runner, or `InterviewJobContext` changes. The realtime model already speaks these as part of its turn.

**Tech Stack:** Python 3 (uv, pytest) under `agent/`; YAML rubric.

## Global Constraints

- Branch `prakul-script-extraction`. Python under `agent/` follows `docs/standards/python.md`. Tests: `cd agent && uv run pytest` (eval marker deselected).
- Spec: `docs/superpowers/specs/2026-06-18-interviewer-persona-and-inworld-voice-design.md`.
- The interviewer is "Prakul, an AI modeled after Prakul, an engineer at Weave."
- Weave-facts allow-list (the ONLY company facts the AI may state; everything else → "the team will follow up"), verbatim:
  - Product: "Weave uses AI to understand and quantify the work software engineers do — how much they're getting done, how good it is, and how well they're using AI."
  - Team: ~15 people, ~10 engineers; started with startups/SMBs, transitioning to enterprise; growing fast, which is why they're hiring.
  - Comp: "As a startup we're very open to negotiation; the job posting reflects what engineers are paid right now. For specifics, reach out to Andrew." (NO specific numbers or equity.)
  - Start dates: "We're flexible and will work around your schedule, with Andrew and Adam."
- HARD-BLOCKED (never say): specific salary/equity numbers; anything about scores, rubrics, or how candidates are evaluated; protected-class topics; commitments/promises on Weave's behalf; any company fact not in the allow-list.
- `manual-gate`: no deploy in this plan. Real-candidate run is manual-gate.

---

### Task 1: Rubric content — AI disclosure, Q1/Q3 worked examples, warm closing

**Files:**
- Modify: `rubric/pilot-v1.yaml` (`opener.introduction`; `questions[q1].when_stuck`; `questions[q3].when_stuck`; `closer.wrap`)
- Test: `agent/tests/test_realtime_plan_builder.py`

**Interfaces:**
- Consumes: `build_interview_plan(rubric)` (existing), `load_rubric(path)` (existing).
- Produces: rubric content only; rendered via existing `plan_builder` paths.

- [ ] **Step 1: Write the failing test**

In `agent/tests/test_realtime_plan_builder.py` add:

```python
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && uv run pytest tests/test_realtime_plan_builder.py::test_persona_content_updates_present -q`
Expected: FAIL — none of these strings are in the rubric yet.

- [ ] **Step 3: Edit the rubric**

In `rubric/pilot-v1.yaml`:

Replace `opener.introduction` with the AI-disclosure version:
```yaml
  introduction: >-
    Hi there — I'm Prakul, an AI modeled after Prakul, an engineer here at
    Weave. I'll be running your interview today. The purpose of this is to
    learn more about you, your technical background, and the stuff you do
    outside of work. So with that said, can you tell me a bit about yourself?
```

Add a worked example to `questions[q1].when_stuck` (append as a second list item, matching how Q2/Q4 embed examples):
```yaml
      - >-
        I'll give you a sense of what I mean. Someone I talked to needed to
        match millions of records in real time — the obvious move was a
        bigger, faster database. Instead they noticed almost all the lookups
        hit the same few thousand keys, so they front-ran the whole thing with
        a tiny in-memory cache they rebuilt every few minutes and basically
        sidestepped the hard part entirely. So it's less about the
        textbook-correct answer and more about the clever, roundabout way you
        got there.
```

Add a worked example to `questions[q3].when_stuck` (append as a second list item):
```yaml
      - >-
        To give you a sense — someone told me they were so into competitive
        Smash Bros in college they'd practice six, seven hours a day, skip
        classes for tournaments, and it genuinely tanked their GPA for a couple
        semesters. Another person climbed through finger injuries a doctor
        warned would do permanent damage. That level — where winning mattered
        enough it actually cost you something.
```

Append a warm tail to `closer.wrap` (keep the existing next-steps text; add the bye):
```yaml
  wrap: >-
    Awesome. Okay cool. Well the next steps are a take home followed by two
    technical interviews with Andrew the CTO and then a work trial. I will
    go talk to Andrew right now after this and we'll get back to you by
    tomorrow morning. Thanks so much for your time — bye!
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd agent && uv run pytest tests/test_realtime_plan_builder.py -q`
Expected: PASS. Also confirm existing plan_builder + rubric-loader tests still pass.

- [ ] **Step 5: Commit**

```bash
git add rubric/pilot-v1.yaml agent/tests/test_realtime_plan_builder.py
git commit -m "feat(rubric): AI disclosure, Q1/Q3 worked examples, warm close"
```

---

### Task 2: Surface acknowledgment phrases into the instructions

**Files:**
- Modify: `agent/src/agent/controller/realtime/plan_builder.py` (add `_style_block`, include it in `build_interview_plan`)
- Test: `agent/tests/test_realtime_plan_builder.py`

**Interfaces:**
- Consumes: `rubric.style.acknowledgments: list[str]`, `rubric.style.thinking_fillers: list[str]` (existing fields).
- Produces: a style-guidance block in `build_interview_plan(rubric).instructions`.

- [ ] **Step 1: Write the failing test**

```python
def test_instructions_surface_acknowledgments():
    from pathlib import Path
    from agent.rubric_loader import load_rubric
    from agent.controller.realtime.plan_builder import build_interview_plan
    rubric = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")
    instr = build_interview_plan(rubric).instructions
    assert "Got it. Got it. Got it." in instr            # a real ack phrase surfaced
    assert "acknowledg" in instr.lower()                 # the guidance framing
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && uv run pytest tests/test_realtime_plan_builder.py::test_instructions_surface_acknowledgments -q`
Expected: FAIL — acknowledgments are not currently rendered into instructions.

- [ ] **Step 3: Add `_style_block` and include it**

In `plan_builder.py`, add after `_persona`:
```python
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
```

In `build_interview_plan`, add `_style_block(rubric)` to the `filter(None, [...])` instruction list, right after `_persona(rubric)`:
```python
    instructions = "\n\n".join(
        filter(
            None,
            [
                _persona(rubric),
                _style_block(rubric),
                (f"OPENER (say first, then let them respond):\n{opener}" if opener else ""),
                f"QUESTIONS (ask in this order, verbatim):\n{question_blocks}",
                f"CLOSER (only after all questions are covered):\n{closer}",
                _GUARDRAILS,
                _TOOL_USAGE,
            ],
        )
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd agent && uv run pytest tests/test_realtime_plan_builder.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/controller/realtime/plan_builder.py agent/tests/test_realtime_plan_builder.py
git commit -m "feat(realtime): surface Prakul acknowledgment phrases into instructions"
```

---

### Task 3: Weave-facts allow-list block

**Files:**
- Modify: `agent/src/agent/controller/realtime/plan_builder.py` (add `_WEAVE_FACTS`, include it)
- Test: `agent/tests/test_realtime_plan_builder.py`

**Interfaces:**
- Produces: a `_WEAVE_FACTS` instruction block in `build_interview_plan(...).instructions`.

- [ ] **Step 1: Write the failing test**

```python
def test_instructions_include_weave_facts_allowlist():
    from pathlib import Path
    from agent.rubric_loader import load_rubric
    from agent.controller.realtime.plan_builder import build_interview_plan
    rubric = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")
    instr = build_interview_plan(rubric).instructions
    assert "understand and quantify the work software engineers do" in instr
    assert "open to negotiation" in instr            # relaxed comp line present
    assert "the team will follow up" in instr.lower()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && uv run pytest tests/test_realtime_plan_builder.py::test_instructions_include_weave_facts_allowlist -q`
Expected: FAIL.

- [ ] **Step 3: Add `_WEAVE_FACTS` and include it**

In `plan_builder.py`, add a constant near `_GUARDRAILS`:
```python
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
```

In `build_interview_plan`, add `_WEAVE_FACTS` to the instruction list, right before `_GUARDRAILS`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd agent && uv run pytest tests/test_realtime_plan_builder.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/controller/realtime/plan_builder.py agent/tests/test_realtime_plan_builder.py
git commit -m "feat(realtime): Weave-facts allow-list block in instructions"
```

---

### Task 4: Guardrail rewrite — comp/start-date relaxation

**Files:**
- Modify: `agent/src/agent/controller/realtime/plan_builder.py` (`_GUARDRAILS`)
- Test: `agent/tests/test_realtime_plan_builder.py`

**Interfaces:**
- Produces: updated `_GUARDRAILS` reflecting the relaxed comp/start-date policy + the still-hard-blocked items.

- [ ] **Step 1: Write the failing test**

```python
def test_guardrails_relax_comp_and_startdate_but_block_specifics():
    from agent.controller.realtime.plan_builder import _GUARDRAILS
    g = _GUARDRAILS.lower()
    # No longer a blanket comp ban:
    assert "never discuss compensation" not in g
    # Still hard-blocks specifics + scoring + protected:
    assert "specific salary" in g or "specific numbers" in g
    assert "score" in g
    assert "protected" in g
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && uv run pytest tests/test_realtime_plan_builder.py::test_guardrails_relax_comp_and_startdate_but_block_specifics -q`
Expected: FAIL — current `_GUARDRAILS` says "Never discuss compensation, salary, equity, or start dates."

- [ ] **Step 3: Rewrite `_GUARDRAILS`**

Replace the `_GUARDRAILS` constant with:
```python
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd agent && uv run pytest tests/test_realtime_plan_builder.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/controller/realtime/plan_builder.py agent/tests/test_realtime_plan_builder.py
git commit -m "feat(realtime): relax comp/start-date guardrail, keep specifics/scoring blocked"
```

---

### Task 5: Align the guardrail monitor classifier with the relaxed policy

**Files:**
- Modify: `agent/src/agent/controller/realtime/guardrail_monitor.py` (`_SYSTEM_PROMPT`)
- Test: `agent/tests/test_realtime_guardrail_monitor.py`

**Interfaces:**
- Consumes: the relaxed policy from Task 4.
- Produces: updated classifier `_SYSTEM_PROMPT` that does NOT flag sanctioned comp/start-date language as a violation, while still flagging specific comp numbers, scoring leaks, protected topics, and fabricated facts.

- [ ] **Step 1: Write the failing test**

```python
def test_classifier_prompt_allows_sanctioned_comp_startdate():
    from agent.controller.realtime.guardrail_monitor import _SYSTEM_PROMPT
    p = _SYSTEM_PROMPT.lower()
    # The prompt must tell the classifier the sanctioned comp/start-date talk is allowed:
    assert "open to negotiation" in p
    assert "andrew" in p
    # And still flag the hard stuff:
    assert "specific salary" in p or "specific numbers" in p
    assert "score" in p or "rubric" in p
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && uv run pytest tests/test_realtime_guardrail_monitor.py::test_classifier_prompt_allows_sanctioned_comp_startdate -q`
Expected: FAIL — current prompt treats any comp talk as `fabrication`/`commitment`.

- [ ] **Step 3: Update `_SYSTEM_PROMPT`**

In `guardrail_monitor.py`, update the classifier system prompt so the `fabrication`/`commitment` definitions carve out the sanctioned language. Replace the violation definitions block with one that adds an explicit ALLOWED note:
```python
_SYSTEM_PROMPT = """\
You are a guardrail classifier for an AI interviewer at Weave. After the interviewer speaks a turn, \
classify whether the turn contains any of the following violations:

1. fabrication — the interviewer invented or asserted facts about the company, team, role, process, or \
   any factual detail it was not given. ALLOWED (not a violation): saying compensation is open to \
   negotiation / the posting reflects current pay / pointing to Andrew for specifics; saying start dates \
   are flexible and handled with Andrew and Adam; the approved Weave facts (what Weave does, ~15 people / \
   ~10 engineers, startups→enterprise, hiring, the take-home→interviews→work-trial process).
2. commitment — a promise or guarantee beyond the approved process (e.g. "you will definitely get an \
   offer"). Stating the approved next steps is NOT a violation.
3. protected — asked about or acknowledged a protected-class topic (age, race, gender, religion, \
   nationality, disability, family/pregnancy status, sexual orientation, etc.).
4. comp_specific — quoted a SPECIFIC salary number or equity figure (this IS a violation).
5. scoring_leak — revealed or hinted at the candidate's score, the rubric, or how they are evaluated \
   (this IS a violation).
6. off_script — steered significantly off the interview script without cause.
7. none — no violation detected.

Return STRICT JSON only — no prose, no markdown:
{"violation": <true|false>, "kind": <"fabrication"|"commitment"|"protected"|"comp_specific"|"scoring_leak"|"off_script"|"none">, \
"correction": <"short corrective instruction to the interviewer, or empty string if no violation">}

When violation is false, set kind to "none" and correction to "".
"""
```

Note: the `GuardrailVerdict.kind` field is a free `str`, so adding the new kinds requires no model change. If any existing test asserts on the old kind set, update it to allow the new kinds.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd agent && uv run pytest tests/test_realtime_guardrail_monitor.py -q`
Expected: PASS. Fix any existing test that hard-coded the old `kind` enumeration.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/controller/realtime/guardrail_monitor.py agent/tests/test_realtime_guardrail_monitor.py
git commit -m "feat(realtime): align guardrail classifier with relaxed comp/start-date policy"
```

---

### Task 6: Full-suite verification

- [ ] **Step 1: Run the full suite**

Run: `cd agent && uv run pytest -q`
Expected: PASS, pristine. Confirm the new persona/content renders into instructions and nothing regressed.

- [ ] **Step 2: Eyeball the built instructions** (sanity, not a gate)

Run: `cd agent && uv run python -c "from pathlib import Path; from agent.rubric_loader import load_rubric; from agent.controller.realtime.plan_builder import build_interview_plan; print(build_interview_plan(load_rubric(Path('../rubric/pilot-v1.yaml'))).instructions)"`
Confirm: AI disclosure, acknowledgments style, Q1/Q3 examples, Weave facts, relaxed guardrails all present and coherent.

- [ ] **Step 3: Commit any cleanup** (if needed)

```bash
git add -A agent && git commit -m "chore(realtime): persona/content verification" || echo "nothing to clean"
```

## Manual-gate follow-up (NOT part of the autonomous run)
- A real-candidate run is manual-gate. The live behavior of the relaxed comp/start-date policy + the classifier alignment should be spot-checked at the room smoke test.

## Self-Review (completed)
- **Spec coverage:** A1 intro (Task 1), A2 acknowledgments (Task 2), A3 examples (Task 1), A4 allow-list (Task 3), A5 guardrail + monitor (Tasks 4+5), A6 closing (Task 1). All covered.
- **Placeholder scan:** none — all instruction/rubric text is concrete and quoted.
- **Type consistency:** `_style_block`/`_WEAVE_FACTS`/`_GUARDRAILS` are module-level in `plan_builder.py`; `_SYSTEM_PROMPT` in `guardrail_monitor.py`; all referenced consistently.
