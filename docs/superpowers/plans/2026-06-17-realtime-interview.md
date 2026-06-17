# Realtime Interview Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the spoken interview on OpenAI `gpt-realtime` (model owns conversational flow) while the app keeps wording authority, a coverage backstop, an output guardrail monitor, and off-loop deterministic scoring — preserving rubric/scorer/probe/event-log/finalization investment.

**Architecture:** Three planes — a native speech plane (`gpt-realtime` via a `RealtimeSession` adapter), a cheap in-path control plane (tool-call bus: `advance_question` / `request_probe` / `flag_off_script` / `close_interview`, the last carrying the only hard gate), and an async off-path analysis plane (existing `Scorer`+`decide_next_action` for grading + exception-steering, plus a new Haiku guardrail monitor). A new `RealtimeInterviewRunner` orchestrates; the existing cascade `InterviewRunner` stays as a flagged fallback.

**Tech Stack:** Python 3.12 (uv), Pydantic v2, `pytest`, LiveKit Agents + `livekit-plugins-openai` (`RealtimeModel`), the `openai` SDK (raw realtime websocket for eval), Anthropic SDK (scorer/probe/guardrail).

## Global Constraints

- Python under `agent/` follows `docs/standards/python.md`. New deps via `uv add`; run tests with `cd agent && uv run pytest`.
- The realtime path lands **behind a flag** (`PUDDLE_USE_REALTIME`, default off). The cascade pipeline (`InterviewRunner`, `LiveKitSessionVoiceAgent`, Deepgram/Cartesia) is **not deleted** — it remains the default and the fallback.
- Realtime provider is hard-coded `gpt-realtime` (no provider abstraction). The `RealtimeSession` interface is a **transport seam** (LiveKit room vs. raw websocket), both OpenAI.
- Reuse unchanged: `Scorer`, `ProbeGenerator`, `decide_next_action`, `roll_up_assessment`, `EventLog`+emitters+`BackendClient`, `InterviewClock`, `InterviewStateMachine`, participant-lifecycle logic, completion-reasons.
- **manual-gate (HALT for operator approval):** any ECS deploy / task-def roll; any live LiveKit room run with a real candidate; DB schema migration; bulk writes to shared data; reducing human oversight of scoring. **None of these are in this plan** — the plan stops at code + eval runs against the OpenAI realtime API with the dev key (no room, no candidate, no deploy).
- Eval runs (Tasks 15–16) hit the live OpenAI realtime API + Claude with the dev key — allowed and autonomous, but token-billed. Eval code is excluded from default `pytest` via the `eval` marker.
- `OPENAI_API_KEY` is in repo-root `.env`; tests/eval that hit live APIs load it via `uv run --env-file ../.env`.

## File Structure

**Create:**
- `agent/src/agent/controller/realtime/__init__.py`
- `agent/src/agent/controller/realtime/plan_builder.py` — `Rubric` → `InterviewPlan(instructions, tool_schemas, required_coverage)`. Pure.
- `agent/src/agent/controller/realtime/coverage.py` — `CoverageTracker` + close-backstop decision. Pure.
- `agent/src/agent/controller/realtime/control_bus.py` — `ControlBus`: the 4 tool handlers over plan + coverage + `ProbeGenerator`.
- `agent/src/agent/controller/realtime/steering.py` — `decide_steering(...)` wrapping `decide_next_action` into an optional exception nudge.
- `agent/src/agent/controller/realtime/guardrail_monitor.py` — `GuardrailMonitor` (Haiku output-turn watcher).
- `agent/src/agent/controller/realtime/runner.py` — `RealtimeInterviewRunner` (orchestration).
- `agent/src/agent/voice/realtime/__init__.py`
- `agent/src/agent/voice/realtime/interface.py` — `RealtimeSession` protocol + event types + `FakeRealtimeSession`.
- `agent/src/agent/voice/realtime/livekit_adapter.py` — production LiveKit `RealtimeModel` adapter.
- `agent/src/agent/voice/realtime/openai_ws_adapter.py` — raw OpenAI websocket adapter (eval transport).
- `agent/eval/realtime/__init__.py`
- `agent/eval/realtime/adaptive_candidate.py` — Claude-driven candidate.
- `agent/eval/realtime/harness.py` — eval driver + measurement.
- `agent/eval/realtime/run_eval.py` — CLI entry for the eval runs.
- Tests mirror under `agent/tests/controller/realtime/`, `agent/tests/voice/realtime/`, `agent/tests/eval/realtime/`.
- `docs/architecture/2026-06-17-realtime-plugin-capabilities.md` — Task 8 findings.

**Modify:**
- `agent/src/agent/domain/types.py` — add `ReasonCode`s.
- `agent/src/agent/config.py` — add `RealtimeConfig`.
- `agent/src/agent/worker/entrypoint.py` — flag-select runner + build `RealtimeModel`.
- `agent/pyproject.toml` — add `eval` pytest marker; `uv add livekit-plugins-openai` if absent.

---

## Phase 0 — Foundations

### Task 1: ReasonCodes + RealtimeConfig

**Files:**
- Modify: `agent/src/agent/domain/types.py:9-18` (the `ReasonCode` Literal)
- Modify: `agent/src/agent/config.py`
- Test: `agent/tests/test_config.py` (create or extend), `agent/tests/domain/test_types.py` (extend if exists, else create)

**Interfaces:**
- Produces: `ReasonCode` gains `"REALTIME_QUESTION"`, `"STEER"`, `"GUARDRAIL_CORRECTION"`, `"COVERAGE_BACKSTOP"`. `config.REALTIME: RealtimeConfig` with `.enabled: bool`, `.model: str`, `.guardrail_model: str`, `.max_session_seconds: float`.

- [ ] **Step 1: Write the failing test**

```python
# agent/tests/test_config.py
from agent.config import RealtimeConfig
from agent.domain.types import AgentEvent

def test_realtime_config_defaults(monkeypatch):
    monkeypatch.delenv("PUDDLE_USE_REALTIME", raising=False)
    cfg = RealtimeConfig()
    assert cfg.enabled is False
    assert cfg.model == "gpt-realtime"
    assert cfg.guardrail_model.startswith("claude-haiku")
    assert cfg.max_session_seconds > 0

def test_new_reason_codes_validate():
    for code in ("REALTIME_QUESTION", "STEER", "GUARDRAIL_CORRECTION", "COVERAGE_BACKSTOP"):
        ev = AgentEvent(session_id="s", utterance="x", reason_code=code,
                        question_id=None, category=None, missing_element=None)
        assert ev.reason_code == code
```

- [ ] **Step 2: Run, expect FAIL** — `cd agent && uv run pytest tests/test_config.py -q` → ImportError / ValidationError.

- [ ] **Step 3: Implement**

```python
# domain/types.py — extend the Literal
ReasonCode = Literal[
    "CONSENT", "INTRO", "ACK", "SCRIPTED_QUESTION", "PROBE_LOW_CONFIDENCE",
    "AUDIO_REPAIR", "TIMEBOX_MOVE_ON", "CLOSING",
    "REALTIME_QUESTION", "STEER", "GUARDRAIL_CORRECTION", "COVERAGE_BACKSTOP",
]
```

```python
# config.py — add and instantiate
def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}

@dataclass(frozen=True)
class RealtimeConfig:
    enabled: bool = _bool_env("PUDDLE_USE_REALTIME", False)
    model: str = os.getenv("PUDDLE_REALTIME_MODEL", "gpt-realtime")
    guardrail_model: str = os.getenv("PUDDLE_GUARDRAIL_MODEL", "claude-haiku-4-5")
    max_session_seconds: float = float(os.getenv("PUDDLE_REALTIME_MAX_SESSION_SECONDS", "1800"))

REALTIME = RealtimeConfig()
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(realtime): reason codes + RealtimeConfig flag"`

---

### Task 2: Plan-builder

**Files:**
- Create: `agent/src/agent/controller/realtime/__init__.py` (empty), `agent/src/agent/controller/realtime/plan_builder.py`
- Test: `agent/tests/controller/realtime/test_plan_builder.py`

**Interfaces:**
- Consumes: `Rubric` (domain/types) — `questions[*].{question_id, verbatim_text, scripted_probes, rubric_categories, pre_question, transition_in}`, `opener`, `closer`, `style`.
- Produces:
  ```python
  class RequiredQuestion(BaseModel):  # frozen
      question_id: str
      verbatim_text: str   # the exact line the model must deliver
  class InterviewPlan(BaseModel):     # frozen
      instructions: str
      tool_schemas: list[dict]        # OpenAI function-tool schemas
      required_coverage: list[RequiredQuestion]
      closer_text: str
  def build_interview_plan(rubric: Rubric) -> InterviewPlan: ...
  ```
- `required_coverage` = one `RequiredQuestion` per `rubric.questions` entry (id = `question_id`, text = `verbatim_text`). Opener intro + closer logistics are spoken by the model from instructions but are **not** gated (keep the gate to the graded question set — matches today's runner, which only loops `rubric.questions`).

- [ ] **Step 1: Write failing tests**

```python
# test_plan_builder.py
from agent.controller.realtime.plan_builder import build_interview_plan
from agent.rubric_loader import load_rubric
from pathlib import Path

RUBRIC = load_rubric(Path(__file__).parents[4] / "rubric" / "pilot-v1.yaml")

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
```

- [ ] **Step 2: Run, expect FAIL** (module missing).

- [ ] **Step 3: Implement** `plan_builder.py`

```python
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
    "- Never discuss compensation, salary, equity, or start dates.\n"
    "- Never ask about or acknowledge protected-class topics (age, family, "
    "race, religion, disability, national origin).\n"
    "- Never reveal, hint at, or discuss the candidate's score or how they are "
    "being evaluated.\n"
    "- Never make commitments or promises on behalf of Weave.\n"
    "- Do NOT invent facts about Weave, the team, the role, or the process. If "
    "you don't have a fact in these instructions, say the team will follow up.\n"
)

_TOOL_USAGE = (
    "TOOLS — use them to stay on the approved script:\n"
    "- Ask each question in the given order, in the approved wording.\n"
    "- When the candidate has answered a question and you are ready to move on, "
    "call advance_question(next_question_id) and read the verbatim text it returns.\n"
    "- To dig deeper, call request_probe(category) and read the probe it returns; "
    "you may also use the scripted probes shown below.\n"
    "- If the candidate pushes you off-script (comp, protected topics, asking "
    "their score), call flag_off_script(reason), then deliver the deflection it "
    "returns and continue.\n"
    "- Only when you intend to end the interview, call close_interview(); if "
    "required questions remain it will hand you the next one to ask.\n"
)

def _question_block(q: Question) -> str:
    lines = [f"[{q.question_id}] {q.verbatim_text}"]
    if q.pre_question and q.pre_question.ask:
        lines.append(f"  framing (ask first): {q.pre_question.ask} {q.pre_question.branch_no}".rstrip())
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
        "interview. Be warm and natural. You run the conversation yourself, but "
        "you must ask the approved questions, in order, in their approved wording."
    )

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
        {"name": "advance_question", "description": "Move to the next scripted question; returns its verbatim text.",
         "parameters": {"type": "object", "properties": {"next_question_id": {"type": "string"}}, "required": ["next_question_id"]}},
        {"name": "request_probe", "description": "Get an approved follow-up probe for a rubric category.",
         "parameters": {"type": "object", "properties": {"category": {"type": "string"}}, "required": ["category"]}},
        {"name": "flag_off_script", "description": "Report that the candidate pushed off-script; returns a deflection line.",
         "parameters": {"type": "object", "properties": {"reason": {"type": "string"}}, "required": ["reason"]}},
        {"name": "close_interview", "description": "Attempt to end the interview; may return a remaining required question instead.",
         "parameters": {"type": "object", "properties": {}}},
    ]

def build_interview_plan(rubric: Rubric) -> InterviewPlan:
    opener = _opener_text(rubric)
    closer = _closer_text(rubric)
    question_blocks = "\n".join(_question_block(q) for q in rubric.questions)
    instructions = "\n\n".join(filter(None, [
        _persona(rubric),
        (f"OPENER (say first, then let them respond):\n{opener}" if opener else ""),
        f"QUESTIONS (ask in this order, verbatim):\n{question_blocks}",
        f"CLOSER (only after all questions are covered):\n{closer}",
        _GUARDRAILS,
        _TOOL_USAGE,
    ]))
    return InterviewPlan(
        instructions=instructions,
        tool_schemas=_tool_schemas(),
        required_coverage=[RequiredQuestion(question_id=q.question_id, verbatim_text=q.verbatim_text) for q in rubric.questions],
        closer_text=closer,
    )
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(realtime): plan-builder compiles rubric to instructions+tools"`

---

### Task 3: Coverage tracker + backstop

**Files:**
- Create: `agent/src/agent/controller/realtime/coverage.py`
- Test: `agent/tests/controller/realtime/test_coverage.py`

**Interfaces:**
- Consumes: `RequiredQuestion` (Task 2).
- Produces:
  ```python
  class CoverageTracker:
      def __init__(self, required: list[RequiredQuestion]) -> None: ...
      def mark_covered(self, question_id: str) -> None: ...
      def is_covered(self, question_id: str) -> bool: ...
      def first_uncovered(self) -> RequiredQuestion | None: ...   # in script order
      def all_covered(self) -> bool: ...
      def status(self) -> list[tuple[str, bool]]: ...             # (question_id, covered) in order
  ```

- [ ] **Step 1: Write failing tests**

```python
# test_coverage.py
from agent.controller.realtime.coverage import CoverageTracker
from agent.controller.realtime.plan_builder import RequiredQuestion

REQ = [RequiredQuestion(question_id=q, verbatim_text=f"V {q}") for q in ("a", "b", "c")]

def test_starts_all_uncovered():
    t = CoverageTracker(REQ)
    assert t.all_covered() is False
    assert t.first_uncovered().question_id == "a"

def test_mark_and_first_uncovered_in_order():
    t = CoverageTracker(REQ)
    t.mark_covered("a"); t.mark_covered("c")
    assert t.first_uncovered().question_id == "b"
    assert t.is_covered("a") and not t.is_covered("b")

def test_all_covered_and_status():
    t = CoverageTracker(REQ)
    for q in ("a", "b", "c"):
        t.mark_covered(q)
    assert t.all_covered() and t.first_uncovered() is None
    assert t.status() == [("a", True), ("b", True), ("c", True)]

def test_unknown_id_is_ignored():
    t = CoverageTracker(REQ)
    t.mark_covered("zzz")     # no crash
    assert not t.all_covered()
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**

```python
from __future__ import annotations
from agent.controller.realtime.plan_builder import RequiredQuestion

class CoverageTracker:
    def __init__(self, required: list[RequiredQuestion]) -> None:
        self._required = list(required)
        self._covered: set[str] = set()
        self._ids = {r.question_id for r in self._required}

    def mark_covered(self, question_id: str) -> None:
        if question_id in self._ids:
            self._covered.add(question_id)

    def is_covered(self, question_id: str) -> bool:
        return question_id in self._covered

    def first_uncovered(self) -> RequiredQuestion | None:
        for r in self._required:
            if r.question_id not in self._covered:
                return r
        return None

    def all_covered(self) -> bool:
        return self.first_uncovered() is None

    def status(self) -> list[tuple[str, bool]]:
        return [(r.question_id, r.question_id in self._covered) for r in self._required]
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(realtime): coverage tracker + backstop primitive"`

---

## Phase 1 — Control bus & analysis

### Task 4: Control bus

**Files:**
- Create: `agent/src/agent/controller/realtime/control_bus.py`
- Test: `agent/tests/controller/realtime/test_control_bus.py`

**Interfaces:**
- Consumes: `InterviewPlan`, `RequiredQuestion` (Task 2); `CoverageTracker` (Task 3); `ProbeGenerator` + `ProbeRequest` (scoring/probe.py); `CategoryAssessment` (scoring/io_types).
- Produces:
  ```python
  class ToolResult(BaseModel):           # frozen
      speak: str                          # text the model should deliver (may be "")
      reason_code: str                    # one of the new ReasonCodes
      ended: bool = False                 # close_interview accepted
      question_id: str | None = None
      category: str | None = None
  class ControlBus:
      def __init__(self, plan: InterviewPlan, coverage: CoverageTracker,
                   probe_provider: Callable[[str], str],
                   deflection_line: str = "...") -> None: ...
      def advance_question(self, next_question_id: str) -> ToolResult: ...
      def request_probe(self, category: str) -> ToolResult: ...
      def flag_off_script(self, reason: str) -> ToolResult: ...
      def close_interview(self) -> ToolResult: ...
  ```
- `probe_provider(category) -> str`: a callback the runner wires to `ProbeGenerator` (Task 11); the bus stays free of Anthropic so it is unit-testable with a stub.
- `advance_question`: mark the **current** question covered (the one just answered), then return the requested next question's verbatim. If `next_question_id` would skip an earlier uncovered required question, return that earlier question's verbatim instead (steer-back) with `reason_code="COVERAGE_BACKSTOP"`. The "current" question = the last one whose verbatim was handed out (track `_last_asked`).

- [ ] **Step 1: Write failing tests**

```python
# test_control_bus.py
from agent.controller.realtime.control_bus import ControlBus
from agent.controller.realtime.coverage import CoverageTracker
from agent.controller.realtime.plan_builder import InterviewPlan, RequiredQuestion

REQ = [RequiredQuestion(question_id=q, verbatim_text=f"V-{q}") for q in ("a", "b", "c")]
def _bus():
    plan = InterviewPlan(instructions="", tool_schemas=[], required_coverage=REQ, closer_text="BYE")
    return ControlBus(plan, CoverageTracker(REQ), probe_provider=lambda c: f"PROBE-{c}",
                      deflection_line="Let's stay on track.")

def test_advance_marks_prev_covered_and_returns_next_verbatim():
    bus = _bus()
    bus._last_asked = "a"                      # a was being answered
    res = bus.advance_question("b")
    assert res.speak == "V-b" and res.reason_code == "REALTIME_QUESTION"
    assert bus._coverage.is_covered("a")

def test_advance_skipping_uncovered_steers_back():
    bus = _bus()
    bus._last_asked = "a"
    res = bus.advance_question("c")            # tries to skip b
    assert res.speak == "V-b" and res.reason_code == "COVERAGE_BACKSTOP"

def test_request_probe_returns_probe_text():
    res = _bus().request_probe("competitiveness")
    assert res.speak == "PROBE-competitiveness" and res.reason_code == "PROBE_LOW_CONFIDENCE"

def test_flag_off_script_returns_deflection():
    res = _bus().flag_off_script("asked comp")
    assert res.speak == "Let's stay on track." and res.reason_code == "GUARDRAIL_CORRECTION"

def test_close_denied_until_all_covered_then_accepted():
    bus = _bus()
    bus._last_asked = "a"; bus.advance_question("b"); bus.advance_question("c")
    bus._last_asked = "c"
    denied = bus.close_interview()             # b,c covered? a,b yes; c not yet
    assert denied.reason_code == "COVERAGE_BACKSTOP" and denied.ended is False
    bus._coverage.mark_covered("c")
    ok = bus.close_interview()
    assert ok.ended is True and ok.speak == "BYE" and ok.reason_code == "CLOSING"
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** — full handler logic per the Interfaces block (track `_last_asked`; `advance` covers `_last_asked`, computes `first_uncovered`, steers back if the requested id is past it; `close_interview` covers `_last_asked` then checks `all_covered`). Use `_verbatim(question_id)` lookup over `plan.required_coverage`.

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(realtime): control bus tool handlers + close backstop"`

---

### Task 5: Steering-by-exception

**Files:**
- Create: `agent/src/agent/controller/realtime/steering.py`
- Test: `agent/tests/controller/realtime/test_steering.py`

**Interfaces:**
- Consumes: `ScorerOutput`, `decide_next_action` (controller/decision.py), `SCORING.confidence_threshold`.
- Produces:
  ```python
  class SteerMessage(BaseModel):   # frozen
      text: str
      category: str
  def decide_steering(scorer_output: ScorerOutput, target_categories: list[str],
                      probes_used: int, max_probes: int,
                      already_advanced: bool) -> SteerMessage | None: ...
  ```
- Returns a `SteerMessage` only when `decide_next_action(...)` says `probe` **and** `already_advanced` is True (the model moved on without probing a low-confidence category). Otherwise `None`. Text: `f"Before you wrap up, dig a little deeper on {category} — the answer so far is thin."`

- [ ] **Step 1: Write failing tests** — (a) advance directive → None; (b) probe directive + already_advanced=False → None (model is still on it, let it probe itself); (c) probe directive + already_advanced=True → SteerMessage naming the category. Build `ScorerOutput` with one low-confidence `CategoryAssessment`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — call `decide_next_action`, branch as above.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(realtime): steering-by-exception over decide_next_action"`

---

### Task 6: Guardrail monitor

**Files:**
- Create: `agent/src/agent/controller/realtime/guardrail_monitor.py`
- Test: `agent/tests/controller/realtime/test_guardrail_monitor.py`

**Interfaces:**
- Consumes: an Anthropic-shaped client (injected); `REALTIME.guardrail_model`.
- Produces:
  ```python
  class GuardrailVerdict(BaseModel):   # frozen
      violation: bool
      kind: str        # "fabrication" | "off_script" | "commitment" | "protected" | "none"
      correction: str  # injected steering text when violation else ""
  class GuardrailMonitor:
      def __init__(self, client: Any, model: str) -> None: ...
      def check_turn(self, agent_text: str) -> GuardrailVerdict: ...   # sync; runner calls via to_thread
  ```
- The check prompt: classify whether `agent_text` invents company/team/role facts, makes commitments, leaks scoring, or touches protected topics; return strict JSON. Parse defensively → on any parse error return `GuardrailVerdict(violation=False, kind="none", correction="")` (fail-open, best-effort).

- [ ] **Step 1: Write failing tests** with a fake client returning canned JSON:

```python
class _FakeClient:
    def __init__(self, payload): self._payload = payload
    class _Msgs:
        ...
    # mimic client.messages.create(...).content[0].text == self._payload
```
Tests: (a) fabrication payload → `violation True, kind "fabrication", correction != ""`; (b) clean payload → `violation False`; (c) malformed JSON → fail-open `violation False`.

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — system prompt + `client.messages.create`; `json.loads` the text; map to `GuardrailVerdict`; wrap parse in try/except → fail-open.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(realtime): Haiku output-turn guardrail monitor"`

---

## Phase 2 — Realtime session interface + adapters

### Task 7: RealtimeSession interface + events + fake

**Files:**
- Create: `agent/src/agent/voice/realtime/__init__.py`, `agent/src/agent/voice/realtime/interface.py`
- Test: `agent/tests/voice/realtime/test_fake_session.py`

**Interfaces:**
- Produces (the contract every adapter + the runner share):
  ```python
  class InputTranscript(BaseModel):    # candidate turn; frozen
      text: str
  class OutputTranscript(BaseModel):   # agent turn (final); frozen
      text: str
  class ToolCall(BaseModel):           # frozen
      call_id: str
      name: str
      arguments: dict
  RealtimeEvent = InputTranscript | OutputTranscript | ToolCall

  class RealtimeSession(Protocol):
      async def start(self, *, instructions: str, tools: list[dict]) -> None: ...
      def events(self) -> AsyncIterator[RealtimeEvent]: ...     # yields until session end
      async def respond_to_tool(self, call_id: str, output: str) -> None: ...
      async def inject_message(self, text: str) -> None: ...    # out-of-band steering
      async def aclose(self) -> None: ...

  class FakeRealtimeSession:   # test double: pushes a scripted event list, records responses/injections
      def __init__(self, scripted: list[RealtimeEvent]) -> None: ...
      # records: .tool_responses: list[tuple[str,str]], .injections: list[str]
  ```

- [ ] **Step 1: Write failing test** — drive `FakeRealtimeSession` through a scripted `[OutputTranscript, ToolCall, InputTranscript]`, assert `events()` yields them in order; assert `respond_to_tool`/`inject_message` are recorded.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the Pydantic event types, the `Protocol`, and `FakeRealtimeSession` (an `asyncio.Queue` or list-backed async generator).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(realtime): RealtimeSession protocol + event types + fake"`

---

### Task 8: Verify LiveKit RealtimeModel plugin capabilities (research)

**Files:**
- Create: `docs/architecture/2026-06-17-realtime-plugin-capabilities.md`
- (No production code; this de-risks Tasks 9 & 12.)

**This is a research task, not TDD.** Deliverable = the findings doc answering, with citations to the installed `livekit-plugins-openai` source (`uv run python -c "import livekit.plugins.openai.realtime as r; print(r.__file__)"`) and LiveKit docs:

- [ ] Does `RealtimeModel` / its `AgentSession` surface **candidate input transcription** events? (event name, payload shape)
- [ ] Does it surface **agent output transcription** with clean per-turn boundaries?
- [ ] How are **model tool/function calls** surfaced and answered (the LiveKit `function_tool` path vs. raw response items)?
- [ ] Can the app **inject an out-of-band message** mid-session (e.g. `session.generate_reply(instructions=...)` / `session.say()` / a `RealtimeModel` push)? If not, record the fallback (`session.update` instructions / queued user message).
- [ ] Confirm session config schema for GA realtime (`{"type":"realtime","output_modalities":[...]}` per the spike).

- [ ] **Commit** the findings doc — `git commit -am "docs: realtime plugin capability findings (de-risk adapter)"`. **If a required primitive is missing, STOP and surface it** — it changes Task 9/11 (the run's "failed gate stops the run" rule).

---

### Task 9: LiveKit RealtimeModel adapter

**Files:**
- Create: `agent/src/agent/voice/realtime/livekit_adapter.py`
- Test: `agent/tests/voice/realtime/test_livekit_adapter.py`

**Interfaces:**
- Consumes: Task 7 protocol + Task 8 findings; participant-lifecycle logic ported from `LiveKitSessionVoiceAgent` (reconnect grace, candidate-ready gate, disconnect callbacks).
- Produces: `class LiveKitRealtimeSession(RealtimeSession)` with `@classmethod async def start(cls, job, *, instructions, tools, model, participant_identity=None)`.

- [ ] **Step 1: Write failing tests** for the **pure** parts only (vendor I/O is `# pragma: no cover`): event-translation helpers that map LiveKit events → `InputTranscript`/`OutputTranscript`/`ToolCall` (feed fake LiveKit event objects, assert the mapped Pydantic events); participant-lifecycle callbacks (reuse the patterns from `test_livekit_session_voice.py`).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — build `RealtimeModel(model=model)` + `AgentSession`, register handlers that translate to the protocol events onto an `asyncio.Queue` consumed by `events()`; map `respond_to_tool`/`inject_message` to the primitives Task 8 confirmed; port reconnect-grace + ready-gate. Vendor wiring marked `# pragma: no cover`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(realtime): LiveKit RealtimeModel adapter"`

---

### Task 10: Raw OpenAI websocket adapter (eval transport)

**Files:**
- Create: `agent/src/agent/voice/realtime/openai_ws_adapter.py`
- Test: `agent/tests/voice/realtime/test_openai_ws_adapter.py`

**Interfaces:**
- Produces: `class OpenAIWebsocketRealtimeSession(RealtimeSession)` driving the GA realtime websocket via the `openai` SDK (text+audio modality, session config `{"type":"realtime","output_modalities":[...]}` per the spike). `start()` opens the socket + sends `session.update` with instructions+tools; `events()` translates server events (`response.output_text.delta`/`done`, `response.function_call_arguments.done`, `conversation.item.input_audio_transcription.completed`) into the protocol events; `respond_to_tool` sends a `function_call_output` item + `response.create`; `inject_message` sends a system/user item + `response.create`.

- [ ] **Step 1: Write failing tests** for the **event-translation** functions in isolation (feed canned server-event dicts → assert protocol events). Network is `# pragma: no cover`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** translation + socket lifecycle (reuse the spike's proven event names from `tmp/realtime-spike/`; the GOTCHA from memory: GA schema uses `output_modalities`, not `modalities`).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(realtime): raw OpenAI websocket adapter for eval"`

---

## Phase 3 — Realtime runner

### Task 11: RealtimeInterviewRunner

**Files:**
- Create: `agent/src/agent/controller/realtime/runner.py`
- Test: `agent/tests/controller/realtime/test_runner.py`

**Interfaces:**
- Consumes: everything above — `build_interview_plan`, `CoverageTracker`, `ControlBus`, `decide_steering`, `GuardrailMonitor`, `RealtimeSession`; reused `Scorer`, `ProbeGenerator`+`ProbeRequest`, `EventLog`, the three emitters, `InterviewClock`, `InterviewStateMachine`, `roll_up_assessment`, `SCORING`.
- Produces:
  ```python
  class RealtimeInterviewRunner:
      def __init__(self, rubric, session: RealtimeSession, scorer, probe_generator,
                   guardrail_monitor, event_log, clock_now, *, emit_transcript_turn=None,
                   emit_agent_event=None, emit_score_checkpoint=None,
                   candidate_transcript_source="realtime") -> None: ...
      async def run(self, session_id: str) -> Assessment: ...
      @property
      def transcript(self) -> list[TranscriptTurn]: ...
      @property
      def event_log(self) -> EventLog: ...
      @property
      def score_checkpoint_count(self) -> int: ...
  ```
- `run()`: build plan → `session.start(instructions, tools)` → `async for ev in session.events()`:
  - `OutputTranscript` → append agent `TranscriptTurn`, `event_log.record_utterance(..., "REALTIME_QUESTION"...)`, emit transcript+agent_event, **spawn** `guardrail_monitor.check_turn` in `to_thread`; on violation → `inject_message(correction)` + record `GUARDRAIL_CORRECTION`.
  - `InputTranscript` → append candidate `TranscriptTurn` (tagged with the current question_id from the bus), emit transcript; close the **Q&A block** for the question last advanced → **spawn** off-loop scoring (`to_thread(scorer.score, ScorerInput(...))`) → score checkpoint emit → `decide_steering(...)`; on `SteerMessage` → `inject_message(text)` + record `STEER`.
  - `ToolCall` → dispatch to `ControlBus`; `await session.respond_to_tool(call_id, result.speak)`; record the result's `reason_code`; if `result.ended` → break.
  - Guard: if `clock_now()-start > REALTIME.max_session_seconds` → `inject_message("We need to wrap up now.")` and force a `close_interview` path.
- Keep emitters **best-effort** (reuse `_emit_best_effort` — extract it to a shared `controller/emit.py` so both runners use it; or import from `interview.py`). Map state-machine transitions to the new flow (INTRO → QUESTION_ASKING on first question; CLOSING at end).

- [ ] **Step 1: Write failing integration test** against `FakeRealtimeSession`:

```python
# scripted: opener output, advance to q1, candidate answer, ... close_interview
# Use a stub scorer (returns high-confidence so no steering), a stub guardrail
# (returns no violation), and assert:
#  - every required question marked covered before close
#  - close_interview accepted only after coverage complete
#  - score checkpoint emitted per answered question
#  - returns a rolled-up Assessment
```
Also a test where the guardrail stub flags one turn → assert `inject_message` called + a `GUARDRAIL_CORRECTION` event recorded. And a test where the model tries `close_interview` early → assert it's denied and the missing verbatim is handed back.

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the runner per Interfaces.
- [ ] **Step 4: Run, expect PASS** — `cd agent && uv run pytest tests/controller/realtime/test_runner.py -v`.
- [ ] **Step 5: Commit** — `git commit -am "feat(realtime): RealtimeInterviewRunner orchestration"`

---

## Phase 4 — Worker wiring (flagged)

### Task 12: Entrypoint flag-select

**Files:**
- Modify: `agent/src/agent/worker/entrypoint.py` (`_default_run_interview`, `_build_livekit_voice_agent`)
- Test: `agent/tests/test_worker_entrypoint.py` (extend)

**Interfaces:**
- Consumes: `REALTIME.enabled`, `RealtimeInterviewRunner`, `LiveKitRealtimeSession`, `GuardrailMonitor`.
- Produces: when `REALTIME.enabled`, build the realtime path (LiveKit `RealtimeModel` session + `RealtimeInterviewRunner`); else the existing cascade path. Finalization/completion-reason handling unchanged (works off the runner's `transcript`/`event_log`/`score_checkpoint_count` properties, which both runners expose).

- [ ] **Step 1: Write failing test** — with `REALTIME.enabled` monkeypatched True and an injected fake builder, assert the entrypoint selects `RealtimeInterviewRunner`; with it False, selects `InterviewRunner`. (Keep using the existing `_run_interview` injection seam.)
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the branch; extract shared finalization so both paths reuse it.
- [ ] **Step 4: Run, expect PASS** — `cd agent && uv run pytest tests/test_worker_entrypoint.py -v`.
- [ ] **Step 5: Commit** — `git commit -am "feat(realtime): flag-select realtime vs cascade runner in worker"`

---

## Phase 5 — Eval harness (live API, on-demand)

### Task 13: Adaptive LLM candidate

**Files:**
- Create: `agent/eval/realtime/__init__.py`, `agent/eval/realtime/adaptive_candidate.py`
- Test: `agent/tests/eval/realtime/test_adaptive_candidate.py`

**Interfaces:**
- Produces:
  ```python
  class AdaptiveCandidate:
      def __init__(self, client: Any, persona: str, model: str) -> None: ...
      def reply(self, agent_utterance: str) -> str: ...   # answers the CURRENT question
  ```
- System prompt: "You are a job candidate in a screening interview. Answer the interviewer's **current** question concretely and briefly. Do NOT volunteer answers to questions you weren't asked." Keeps a rolling message history.

- [ ] **Step 1: Write failing test** with a fake client (canned reply) → asserts `reply()` returns the text and appends to history. (No live call in the unit test.)
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(eval): adaptive LLM candidate"`

---

### Task 14: Eval harness + measurement

**Files:**
- Create: `agent/eval/realtime/harness.py`, `agent/eval/realtime/run_eval.py`
- Modify: `agent/pyproject.toml` (register `eval` marker: `markers = ["eval: live-API eval, deselected by default"]`; default `addopts = "-m 'not eval'"`)
- Test: `agent/tests/eval/realtime/test_harness_measurement.py`

**Interfaces:**
- Produces:
  ```python
  class EvalMeasurement(BaseModel):     # frozen
      coverage_count: int
      total_required: int
      in_order: bool
      per_question_similarity: dict[str, float]    # difflib ratio vs verbatim
      guardrail_violations: list[str]
      duration_seconds: float
  def measure(transcript: list[TranscriptTurn], plan: InterviewPlan,
              guardrail_events: list[str], duration_seconds: float) -> EvalMeasurement: ...
  async def run_session(candidate: AdaptiveCandidate, session: RealtimeSession,
                        rubric: Rubric, *, scorer, guardrail_monitor, max_turns: int) -> EvalMeasurement: ...
  ```
- `measure` reuses the spike's difflib approach (per-question best-match ratio of an agent turn vs `verbatim_text`; in-order = covered ids appear in script order). `run_session` wires `AdaptiveCandidate` ↔ `OpenAIWebsocketRealtimeSession` ↔ `RealtimeInterviewRunner` (or a thin driver reusing the runner) and returns the measurement.

- [ ] **Step 1: Write failing tests for `measure` only** (pure): synthetic transcript with 2/3 questions asked verbatim out of order → assert `coverage_count==2`, `in_order==False`, similarity ~1.0 for the matched ones.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `measure` + `run_session` + a `run_eval.py` CLI (`--mode adaptive|long`, writes JSON to `agent/eval/realtime/runs/`).
- [ ] **Step 4: Run, expect PASS** (`measure` unit test; `run_session` is `eval`-marked, not run here).
- [ ] **Step 5: Commit** — `git commit -am "feat(eval): realtime eval harness + measurement"`

---

### Task 15: Run adaptive-candidate eval + record

**Files:**
- Create: `agent/eval/realtime/runs/adaptive_<date>.json` (output), append to `docs/architecture/2026-06-16-realtime-spike-findings.md`

**Live API (OpenAI realtime + Claude), dev key, no room, no candidate — allowed per the stop-line. Token-billed.**

- [ ] **Step 1: Run** — `cd agent && uv run --env-file ../.env python -m agent.eval.realtime.run_eval --mode adaptive`
- [ ] **Step 2: Record** the measurement (coverage/order/fidelity vs the spike's fixed-mock numbers; did the coverage backstop force any skipped question? did the guardrail monitor catch fabrication?) into the findings doc under a new "Adaptive-candidate eval (2026-06-17)" section.
- [ ] **Step 3: Commit** — `git commit -am "eval: adaptive-candidate coverage/fidelity results"`
- [ ] **Gate:** if coverage < 100% **after** the backstop, or the guardrail monitor misses seeded fabrication, surface it before proceeding (it indicates a runner/backstop bug, not a model limitation).

---

### Task 16: Run long-session drift eval + record

**Files:** `agent/eval/realtime/runs/long_<date>.json`, append findings doc.

**Live API, dev key — allowed. Token-billed.**

- [ ] **Step 1: Run** — `cd agent && uv run --env-file ../.env python -m agent.eval.realtime.run_eval --mode long` (drives a ~15-min equivalent: extended candidate verbosity + the full question set + extra tangents).
- [ ] **Step 2: Record** mid-call drift / instruction decay / wording fidelity at the tail vs the head into the findings doc ("Long-session drift (2026-06-17)").
- [ ] **Step 3: Commit** — `git commit -am "eval: long-session drift results"`

---

## Finish

- [ ] Run the full suite: `cd agent && uv run pytest` (default excludes `eval`) → all green; `pnpm -r test` unaffected.
- [ ] `superpowers:finishing-a-development-branch` → open PR (`/ecc:pr`) + final `/ecc:code-review`.
- [ ] Update the `voice-latency-cloning-handoff` memory: realtime build landed behind `PUDDLE_USE_REALTIME` flag; eval results recorded; cascade remains default.

### manual-gate (NOT in this plan — separate, operator-approved session)

- [ ] **manual-gate:** flip `PUDDLE_USE_REALTIME` on in a deploy / ECS task-def roll.
- [ ] **manual-gate:** live LiveKit room smoke test (operator talking to the agent, no real candidate).
- [ ] **manual-gate:** any run with a real candidate.

---

## Self-review notes

- **Spec coverage:** plan-builder (A→T2), RealtimeVoiceSession (B→T7/9/10), control bus (C→T4), off-loop scorer+steering (D→T5/T11), guardrail monitor (E→T6), runner re-cast (T11), auditability/ReasonCodes (T1 + recorded across T11), safe cutover flag (T1/T12), error handling (T11 guard + reused lifecycle), unit/integration/eval testing (throughout + T13–16), open plugin risk (T8 first, gating). All spec sections map to a task.
- **Decisions honored:** model-drives/app-backstops (T4/T11), v1 = core + guardrail monitor only (no provider seam/TTS fork/2nd provider), production deliverable (T9/T11/T12), eval against real code (T13–16), halt before deploy/live-room (explicit manual-gate section).
- **Type consistency:** `RequiredQuestion`/`InterviewPlan` (T2) consumed by T3/T4; `ToolResult` (T4) consumed by T11; `RealtimeSession`+events (T7) consumed by T9/T10/T11; `SteerMessage` (T5) and `GuardrailVerdict` (T6) consumed by T11. Names checked across tasks.
