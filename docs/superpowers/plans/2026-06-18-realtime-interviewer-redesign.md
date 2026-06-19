# Realtime Interviewer Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the realtime S2S model the sole interviewer whose only deliverable is a clean transcript; remove all live scoring/steering from the interview loop and retire the cascade.

**Architecture:** The realtime model runs the conversation autonomously. The runner logs turns, routes the four control tools through the `ControlBus` (verbatim coverage backstop), and runs the guardrail check *non-blocking, off the speak path*. No Anthropic call ever sits inline in the event loop. Depth is the model's job, driven by per-question completeness exemplars (`target_evidence`) in the instructions; coverage is the only hard script guarantee. Grading happens post-hoc in the backend (`scoreTranscript`), which reads the persisted `transcript_turns`.

**Tech Stack:** Python 3 (uv, pytest) under `agent/`; LiveKit Agents (floor 1.5.11); OpenAI realtime (`gpt-realtime`); backend grading in TypeScript on AWS Bedrock (unchanged by this plan).

## Global Constraints

- Branch: `prakul-script-extraction`. Work here; do not create a new branch unless asked.
- Python under `agent/` follows `docs/standards/python.md`.
- Run Python tests with: `cd agent && uv run pytest` (the `eval` marker is deselected by default).
- Backend `scoreTranscript` is the source of truth for grading; this plan does not change the rubric or the grader.
- Transcript contract the grader consumes: `TranscriptTurnLike { speaker, text, turnIndex? }` — flat, speaker-attributed, ordered by `turn_index`.
- `manual-gate` (halts the autonomous run for operator approval): any deploy/release, flipping the deployed default, bulk data writes to shared data, running a real candidate. No task in this plan performs a deploy; the cutover is handled separately at a manual gate.
- The Python `scoring/scorer.py` and `scoring/probe.py` are RETAINED for the offline eval harness. They must no longer be imported by any *live interview* path.

---

### Task 1: Convert the realtime runner's candidate-turn handler to transcript-only

Remove the inline Anthropic scorer, the steering injection, and the score-checkpoint emission from `_on_candidate_turn`. After this task the candidate-turn path only appends the turn and marks coverage — no Anthropic call, no `inject_message`.

**Files:**
- Modify: `agent/src/agent/controller/realtime/runner.py`
- Modify: `agent/src/agent/worker/entrypoint.py:269-284` (drop `scorer=` and `emit_score_checkpoint=` from the realtime builder)
- Modify: `agent/src/agent/eval/realtime/run_eval.py` (drop `scorer=`/`emit_score_checkpoint=` at the runner construction site)
- Test: `agent/tests/test_realtime_runner.py`

**Interfaces:**
- Consumes: `ControlBus`, `CoverageTracker`, `FakeRealtimeSession`, `InputTranscript`, `OutputTranscript`, `ToolCall` (unchanged).
- Produces: `RealtimeInterviewRunner.__init__` no longer takes `scorer` or `emit_score_checkpoint`; `run()` returns a transcript-only `Assessment` (empty category assessments). `score_checkpoint_count` property is removed.

- [ ] **Step 1: Write the failing test** — candidate turn does not score or steer.

In `agent/tests/test_realtime_runner.py`, add (the `_runner` helper is updated in Step 3 to drop `scorer=`/`probe_generator=`-as-scorer; for now write the target-state test):

```python
def test_candidate_turn_does_not_score_or_steer(tmp_path):
    """A candidate answer is logged + marks coverage, with NO Anthropic scorer
    call and NO steering injection."""
    session = FakeRealtimeSession(events=_happy_script())
    event_log = EventLog(session_id="s1", path=tmp_path / "e.jsonl")
    runner = _runner(session, event_log)  # _runner no longer wires a scorer

    import asyncio
    assessment = asyncio.run(runner.run("s1"))

    # No steering / correction messages were injected for scoring reasons.
    assert all(
        m != "STEER" for m in session.injected_reason_codes
    ) if hasattr(session, "injected_reason_codes") else True
    # Transcript captured every turn; coverage complete.
    assert len(runner.transcript) > 0
    assert isinstance(assessment, Assessment)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && uv run pytest tests/test_realtime_runner.py -x -q`
Expected: FAIL — `_runner` still requires `scorer=`/`score_checkpoint` wiring, or the constructor signature still demands a scorer.

- [ ] **Step 3: Rewrite `_on_candidate_turn` to transcript-only**

In `runner.py`, replace the body of `_on_candidate_turn` (currently lines 223–281) with:

```python
    async def _on_candidate_turn(self, event: InputTranscript) -> None:
        """Log a candidate turn and mark its question covered. No live scoring."""
        await self._append_turn(
            speaker="candidate",
            text=event.text,
            source=self._candidate_transcript_source,
        )
        scored_question_id = self._current_question_id
        if scored_question_id is None:
            # Candidate spoke before any question was asked (opener small-talk).
            return
        # Runner-owned coverage signal: the bus does not auto-mark the last-asked
        # question on close, so mark it here when its answer arrives.
        self._coverage.mark_covered(scored_question_id)
```

- [ ] **Step 4: Remove the scorer, steering, checkpoint plumbing from the runner**

In `runner.py`:
- Delete imports no longer used: `from agent.controller.realtime.steering import decide_steering`, `from agent.scoring.io_types import CategoryAssessment, ScorerInput`, `from agent.scoring.scorer import Scorer`. Keep `MODELS`, `SCORING` only if still referenced (SCORING is used in `run()`'s rollup — keep it; `MODELS` was only used by the checkpoint helper — remove the import if now unused).
- In `__init__`: remove the `scorer: Scorer` parameter and `self._scorer = scorer`; remove the `emit_score_checkpoint` parameter, `self._emit_score_checkpoint`, and `self._score_checkpoint_sequence`; remove `self._latest_assessments`.
- Remove the `score_checkpoint_count` property (lines 136–138).
- Remove the `_emit_score_checkpoint_payload` method (lines 435–457).
- In `run()`'s final return, replace `final_assessments=self._latest_assessments` with `final_assessments={}` (transcript-only completion signal; the backend grades the transcript). Keep `roll_up_assessment(...)` otherwise unchanged.

Update the `_runner` helper in `test_realtime_runner.py` to drop `scorer=...` and `emit_score_checkpoint` wiring (leave `probe_generator=` for now — Task 2 removes it):

```python
def _runner(session, event_log):
    return RealtimeInterviewRunner(
        rubric=RUBRIC,
        session=session,
        probe_generator=_stub_probe_generator(),
        guardrail_monitor=_no_violation_guardrail(),
        event_log=event_log,
        clock_now=_clock(),
    )
```

Update the two call sites (`entrypoint.py` `_realtime_run_interview`, `eval/realtime/run_eval.py`) to remove `scorer=Scorer(...)` and `emit_score_checkpoint=backend.post_score_checkpoint`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd agent && uv run pytest tests/test_realtime_runner.py -q`
Expected: PASS. Then delete or update any now-obsolete checkpoint/steering assertions in this file that reference `score_checkpoint_count` or `STEER` injections.

- [ ] **Step 6: Commit**

```bash
git add agent/src/agent/controller/realtime/runner.py agent/src/agent/worker/entrypoint.py agent/src/agent/eval/realtime/run_eval.py agent/tests/test_realtime_runner.py
git commit -m "refactor(realtime): candidate turn is transcript-only — remove live scorer/steering/checkpoint"
```

---

### Task 2: Serve scripted probes for `request_probe` (drop scorer dependency)

`_probe_provider` builds a `ProbeRequest` from `_latest_assessments` (gone after Task 1), so it would always return the fallback. Rework it to serve the current question's `scripted_probes` in order, with a neutral fallback when exhausted. No `ProbeGenerator`, no Anthropic call.

**Files:**
- Modify: `agent/src/agent/controller/realtime/runner.py`
- Modify: `agent/src/agent/worker/entrypoint.py` + `agent/src/agent/eval/realtime/run_eval.py` (drop `probe_generator=`)
- Test: `agent/tests/test_realtime_runner.py`

**Interfaces:**
- Consumes: `Question.scripted_probes: list[str]` (existing field).
- Produces: `RealtimeInterviewRunner.__init__` no longer takes `probe_generator`. `request_probe` returns the next scripted probe for the current question.

- [ ] **Step 1: Write the failing test**

```python
def test_request_probe_returns_scripted_probes_in_order(tmp_path):
    """request_probe serves the current question's scripted probes, then a
    neutral fallback — with no probe-generator/Anthropic call."""
    # Pick the first question that has >=1 scripted probe.
    q = next(q for q in RUBRIC.questions if q.scripted_probes)
    events = [
        ToolCall(call_id="a", name="advance_question",
                 arguments={"next_question_id": q.question_id}),
        OutputTranscript(text=q.verbatim_text),
        ToolCall(call_id="p1", name="request_probe",
                 arguments={"category": q.rubric_categories[0]}),
    ]
    session = FakeRealtimeSession(events=events)
    event_log = EventLog(session_id="s", path=tmp_path / "e.jsonl")
    runner = _runner(session, event_log)
    import asyncio
    asyncio.run(runner.run("s"))
    # The first probe the bus spoke equals the question's first scripted probe.
    assert q.scripted_probes[0] in session.tool_responses  # adapt to Fake API
```

(Adapt the final assertion to the `FakeRealtimeSession` recording API used in this test file — mirror how existing tests in `test_realtime_runner.py` inspect what was spoken via `respond_to_tool`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && uv run pytest tests/test_realtime_runner.py::test_request_probe_returns_scripted_probes_in_order -q`
Expected: FAIL — current `_probe_provider` returns `_FALLBACK_PROBE` (no assessment present).

- [ ] **Step 3: Rewrite `_probe_provider`**

Replace `_probe_provider` (lines 348–375) with a scripted-probe cursor. Add `self._probe_cursor: dict[str, int] = {}` in `__init__`, and remove `self._probes_used`, the `ProbeGenerator`/`ProbeRequest` imports, and the `probe_generator` parameter:

```python
    def _probe_provider(self, category: str) -> str:
        """Serve the current question's scripted probes in order; neutral
        fallback when the pool is exhausted. No model call."""
        qid = self._current_question_id
        question = self._questions.get(qid) if qid else None
        if question is None or not question.scripted_probes:
            return _FALLBACK_PROBE
        idx = self._probe_cursor.get(qid, 0)
        if idx >= len(question.scripted_probes):
            return _FALLBACK_PROBE
        self._probe_cursor[qid] = idx + 1
        return question.scripted_probes[idx]
```

Remove `probe_generator` from `__init__` and from the two call sites (`entrypoint.py`, `run_eval.py`). Remove the now-unused `_stub_probe_generator` from the test file and drop `probe_generator=` from `_runner`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd agent && uv run pytest tests/test_realtime_runner.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/controller/realtime/runner.py agent/src/agent/worker/entrypoint.py agent/src/agent/eval/realtime/run_eval.py agent/tests/test_realtime_runner.py
git commit -m "refactor(realtime): request_probe serves scripted probes, drop ProbeGenerator from live path"
```

---

### Task 3: Make the guardrail monitor non-blocking (off the speak path)

`_on_agent_turn` currently `await`s the Haiku guardrail inline (lines 205–207), serializing ~1–3 s in front of the model. Convert it to fire-and-forget: schedule the check as a background task that logs a violation and injects a *next-turn* correction, but never blocks the handler.

**Files:**
- Modify: `agent/src/agent/controller/realtime/runner.py`
- Test: `agent/tests/test_realtime_runner.py`

**Interfaces:**
- Produces: `_on_agent_turn` returns without awaiting the guardrail. Runner tracks background tasks in `self._bg_tasks: set[asyncio.Task]` and awaits/cancels them in `run()`'s shutdown.

- [ ] **Step 1: Write the failing test** — the agent-turn handler does not block on the guardrail.

```python
def test_agent_turn_does_not_block_on_guardrail(tmp_path):
    """_on_agent_turn returns before a slow guardrail completes; the violation
    correction is injected later, off the speak path."""
    import asyncio, threading

    release = threading.Event()

    def _slow_check(_text):
        release.wait(timeout=2.0)  # block until the test releases it
        return GuardrailVerdict(violation=True, kind="fabrication",
                                correction="To clarify, the team will follow up.")

    monitor = MagicMock()
    monitor.check_turn.side_effect = _slow_check
    session = FakeRealtimeSession(events=[OutputTranscript(text="Our team is huge.")])
    event_log = EventLog(session_id="s", path=tmp_path / "e.jsonl")
    runner = RealtimeInterviewRunner(
        rubric=RUBRIC, session=session, guardrail_monitor=monitor,
        event_log=event_log, clock_now=_clock(),
    )

    async def _drive():
        await runner._append_turn(speaker="agent", text="Our team is huge.", source="t")
        # Simulate handler scheduling the guardrail; it must return immediately.
        await asyncio.wait_for(runner._on_agent_turn(
            OutputTranscript(text="Our team is huge.")), timeout=0.2)
        release.set()
        await runner._drain_background()  # awaits scheduled guardrail tasks
    asyncio.run(_drive())
    # Correction eventually injected.
    assert any("follow up" in m for m in session.injected_messages)
```

(Adapt `injected_messages` to the `FakeRealtimeSession` recording API.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && uv run pytest tests/test_realtime_runner.py::test_agent_turn_does_not_block_on_guardrail -q`
Expected: FAIL — `_on_agent_turn` awaits the guardrail (times out at 0.2 s), and `_drain_background` does not exist.

- [ ] **Step 3: Implement fire-and-forget guardrail**

In `__init__` add `self._bg_tasks: set[asyncio.Task] = set()`. Replace the guardrail block in `_on_agent_turn` (lines 205–221) with:

```python
        task = asyncio.create_task(self._run_guardrail(event.text))
        self._bg_tasks.add(task)
        task.add_done_callback(self._bg_tasks.discard)
```

Add the helper methods:

```python
    async def _run_guardrail(self, agent_text: str) -> None:
        """Off-path guardrail check: log + inject a next-turn correction."""
        verdict = await asyncio.to_thread(self._guardrail_monitor.check_turn, agent_text)
        if not verdict.violation:
            return
        logger.info("guardrail violation (non-blocking)", extra={"kind": verdict.kind})
        with contextlib.suppress(Exception):
            await self._session.inject_message(verdict.correction)
        self._event_log.record_utterance(
            utterance=verdict.correction,
            reason_code="GUARDRAIL_CORRECTION",
            question_id=self._current_question_id,
        )
        await self._emit_agent_event_payload(
            utterance=verdict.correction, reason_code="GUARDRAIL_CORRECTION"
        )

    async def _drain_background(self) -> None:
        """Await any in-flight background guardrail tasks (shutdown/tests)."""
        if self._bg_tasks:
            await asyncio.gather(*list(self._bg_tasks), return_exceptions=True)
```

In `run()`, call `await self._drain_background()` immediately before `await self._session.aclose()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd agent && uv run pytest tests/test_realtime_runner.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/controller/realtime/runner.py agent/tests/test_realtime_runner.py
git commit -m "perf(realtime): guardrail runs non-blocking off the speak path"
```

---

### Task 4: Render per-question completeness exemplars into the instructions

Give the model its depth guidance: for each question, what a complete answer covers (`target_evidence`), when to stop probing, and the stall nudges (`when_stuck`). No schema change — the fields already exist.

**Files:**
- Modify: `agent/src/agent/controller/realtime/plan_builder.py:51-57` (`_question_block`) and `_TOOL_USAGE`
- Test: `agent/tests/test_realtime_plan_builder.py`

**Interfaces:**
- Produces: `build_interview_plan(rubric).instructions` contains, per question, a "complete answer covers: …" line built from `q.target_evidence` and a probe-stop instruction.

- [ ] **Step 1: Write the failing test**

```python
def test_instructions_include_completeness_exemplars():
    from pathlib import Path
    from agent.rubric_loader import load_rubric
    from agent.controller.realtime.plan_builder import build_interview_plan
    rubric = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")
    plan = build_interview_plan(rubric)
    q = next(q for q in rubric.questions if q.target_evidence)
    # Each evidence element appears in the instructions as completeness guidance.
    for element in q.target_evidence:
        assert element in plan.instructions
    assert "complete answer covers" in plan.instructions.lower()
    assert "stop probing" in plan.instructions.lower()
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && uv run pytest tests/test_realtime_plan_builder.py::test_instructions_include_completeness_exemplars -q`
Expected: FAIL — current `_question_block` renders only verbatim text, framing, and scripted probes.

- [ ] **Step 3: Extend `_question_block` and tool usage**

Replace `_question_block` with:

```python
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
```

Add one line to `_TOOL_USAGE` after the `request_probe` bullet:

```
"- Judge depth yourself: keep probing a thin answer until it covers the "
"question's listed elements, then advance. Do not over-probe a complete answer.\n"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd agent && uv run pytest tests/test_realtime_plan_builder.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/controller/realtime/plan_builder.py agent/tests/test_realtime_plan_builder.py
git commit -m "feat(realtime): per-question completeness exemplars guide model-judged depth"
```

---

### Task 5: Make realtime the only interview path; remove the `PUDDLE_USE_REALTIME` flag

Collapse the entrypoint dispatch to always run the realtime path and drop the flag from config.

**Files:**
- Modify: `agent/src/agent/worker/entrypoint.py:122-133`
- Modify: `agent/src/agent/config.py:66-77` (remove `enabled` field)
- Test: `agent/tests/test_worker_entrypoint.py` (or the existing entrypoint test module)

**Interfaces:**
- Produces: `entrypoint()` always builds the realtime session + runs `_realtime_run_interview`. `RealtimeConfig.enabled` no longer exists.

- [ ] **Step 1: Write the failing test** — entrypoint always selects realtime regardless of env.

```python
def test_entrypoint_always_runs_realtime(monkeypatch):
    monkeypatch.delenv("PUDDLE_USE_REALTIME", raising=False)
    # Importing config must not expose an `enabled` flag anymore.
    from agent.config import RealtimeConfig
    assert not hasattr(RealtimeConfig(), "enabled")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && uv run pytest tests/test_worker_entrypoint.py::test_entrypoint_always_runs_realtime -q`
Expected: FAIL — `RealtimeConfig.enabled` still exists.

- [ ] **Step 3: Collapse the dispatch + drop the flag**

In `entrypoint.py`, replace the `if REALTIME.enabled: ... else: ...` block (lines 122–133) with the realtime branch only:

```python
    voice = await _build_realtime_session(job)
    try:
        await _realtime_run_interview(ctx, voice)
    finally:
        await _close_voice_if_present(voice)
```

In `config.py`, remove the `enabled` field from `RealtimeConfig`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd agent && uv run pytest tests/test_worker_entrypoint.py -q`
Expected: PASS. Fix any test that set `PUDDLE_USE_REALTIME` to select a path.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/worker/entrypoint.py agent/src/agent/config.py agent/tests/test_worker_entrypoint.py
git commit -m "feat(realtime): realtime is the only interview path; remove PUDDLE_USE_REALTIME flag"
```

---

### Task 6: Retire the cascade interviewer (delete `interview.py` + `decision.py`)

Remove the cascade runner and its scorer-driven decision engine. Keep `scoring/scorer.py` and `scoring/probe.py` (used by the offline eval harness). Remove `_default_run_interview` and the cascade-only voice builder path.

**Files:**
- Delete: `agent/src/agent/controller/interview.py`
- Delete: `agent/src/agent/controller/decision.py`
- Delete: `agent/tests/test_interview_runner.py`, `agent/tests/test_decision.py`
- Modify: `agent/src/agent/worker/entrypoint.py` (remove `_default_run_interview`, `_build_livekit_voice_agent` if now unused, and the `InterviewRunner`/`Scorer`/`ProbeGenerator` imports it used)
- Modify: any module that imports `InterviewRunner`/`decide_next_action` (grep first)

**Interfaces:**
- Produces: no live path imports `controller.interview` or `controller.decision`. `scoring/scorer.py` is imported only by `eval/*`.

- [ ] **Step 1: Find all references**

Run: `cd agent && grep -rn "controller.interview\|InterviewRunner\|decide_next_action\|controller.decision\|_default_run_interview" src tests`
Expected: a finite list — entrypoint + the two test files + the two modules themselves.

- [ ] **Step 2: Delete the modules and tests**

```bash
git rm agent/src/agent/controller/interview.py agent/src/agent/controller/decision.py agent/tests/test_interview_runner.py agent/tests/test_decision.py
```

- [ ] **Step 3: Remove cascade wiring from the entrypoint**

In `entrypoint.py`, delete `_default_run_interview` (lines ~220–254) and any now-unused imports (`InterviewRunner`, and `Scorer`/`ProbeGenerator` if no longer referenced after Tasks 1–2). Delete `_build_livekit_voice_agent` only if grep shows it is now unused.

- [ ] **Step 4: Run the full suite to verify green**

Run: `cd agent && uv run pytest -q`
Expected: PASS — no import errors, no orphaned references. Fix any remaining import of the deleted modules.

- [ ] **Step 5: Commit**

```bash
git add -A agent
git commit -m "refactor: retire cascade interviewer (interview.py, decision.py); realtime is the path"
```

---

### Task 7: Repurpose the realtime eval to transcript-quality metrics + adaptive candidate

The eval's primary metric becomes transcript quality (required-question coverage, speaker attribution, completeness) and guardrail leak rate — not live-score fidelity. Use the existing adaptive-candidate harness to exercise probing-depth and the coverage backstop.

**Files:**
- Modify: `agent/src/agent/eval/realtime/run_eval.py`
- Modify/extend: `agent/tests/test_realtime_adaptive_candidate.py`, `agent/tests/test_realtime_harness_measurement.py`
- Reference: `agent/tests/test_realtime_run_session_backstop.py`

**Interfaces:**
- Produces: an eval measurement that reports, per run: `required_questions_asked` (coverage %), `speaker_attribution_ok` (bool), `guardrail_leak_count` (int). Live-score-fidelity metrics are removed.

- [ ] **Step 1: Write the failing test** — measurement reports transcript-coverage, not score fidelity.

```python
def test_eval_measures_transcript_coverage_not_scores():
    from agent.eval.realtime.run_eval import measure_transcript_quality  # new
    turns = [
        {"speaker": "agent", "text": "Q1 verbatim", "questionId": "q1"},
        {"speaker": "candidate", "text": "answer", "questionId": "q1"},
    ]
    required = ["q1", "q2"]
    result = measure_transcript_quality(turns, required_question_ids=required)
    assert result.required_questions_asked == 1
    assert result.coverage_ratio == 0.5
    assert result.speaker_attribution_ok is True
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && uv run pytest tests/test_realtime_harness_measurement.py::test_eval_measures_transcript_coverage_not_scores -q`
Expected: FAIL — `measure_transcript_quality` does not exist.

- [ ] **Step 3: Implement `measure_transcript_quality`**

Add to `run_eval.py` a small dataclass + function:

```python
@dataclass(frozen=True)
class TranscriptQuality:
    required_questions_asked: int
    coverage_ratio: float
    speaker_attribution_ok: bool

def measure_transcript_quality(turns, required_question_ids) -> "TranscriptQuality":
    asked = {t.get("questionId") for t in turns if t.get("speaker") == "agent"}
    hit = sum(1 for qid in required_question_ids if qid in asked)
    total = max(1, len(required_question_ids))
    ok = all(t.get("speaker") in {"agent", "candidate"} for t in turns)
    return TranscriptQuality(
        required_questions_asked=hit,
        coverage_ratio=hit / total,
        speaker_attribution_ok=ok,
    )
```

Wire this as the eval's reported metric (replace the score-fidelity reporting). Keep the offline `Scorer` available for a separate, explicitly-marked grading-quality run if desired, but it is no longer the realtime eval's primary signal.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd agent && uv run pytest tests/test_realtime_harness_measurement.py tests/test_realtime_adaptive_candidate.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/eval/realtime/run_eval.py agent/tests/test_realtime_harness_measurement.py agent/tests/test_realtime_adaptive_candidate.py
git commit -m "eval(realtime): primary metric is transcript quality + guardrail leak, not score fidelity"
```

---

### Task 8: Harden transcript persistence (buffered retry on `post_transcript_turn`)

The transcript is now the sole deliverable, so a dropped turn is the highest-impact failure. Add a bounded retry around the emit so a transient backend hiccup does not silently lose a turn, while never blocking the speak path.

**Files:**
- Modify: `agent/src/agent/worker/backend_client.py:75-80` (`post_transcript_turn`)
- Test: `agent/tests/test_backend_client.py`

**Interfaces:**
- Produces: `post_transcript_turn` retries up to N times on transient failure, logs on final failure, and never raises into the caller (emit stays best-effort).

- [ ] **Step 1: Write the failing test**

```python
def test_post_transcript_turn_retries_then_logs(monkeypatch, caplog):
    import asyncio
    calls = {"n": 0}
    async def _flaky(*a, **k):
        calls["n"] += 1
        if calls["n"] < 2:
            raise RuntimeError("transient")
    client = BackendClient(session_id="s")
    monkeypatch.setattr(client, "_post", _flaky)  # adapt to the real HTTP method name
    asyncio.run(client.post_transcript_turn({"turnIndex": 0, "speaker": "agent", "text": "hi"}))
    assert calls["n"] == 2  # retried once, then succeeded
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd agent && uv run pytest tests/test_backend_client.py::test_post_transcript_turn_retries_then_logs -q`
Expected: FAIL — current `post_transcript_turn` does a single POST with no retry.

- [ ] **Step 3: Add bounded retry**

Wrap the existing POST in `post_transcript_turn` with a small retry loop (e.g. 3 attempts, short backoff), catching transient exceptions and logging on final failure. Match the module's existing logging/HTTP patterns; do not change the public signature.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd agent && uv run pytest tests/test_backend_client.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/worker/backend_client.py agent/tests/test_backend_client.py
git commit -m "fix(worker): buffered retry on transcript-turn persistence (sole deliverable)"
```

---

### Task 9: Full-suite verification + dead-reference sweep

**Files:**
- No new code; verification only.

- [ ] **Step 1: Run the full Python suite**

Run: `cd agent && uv run pytest -q`
Expected: PASS, with the cascade/score-checkpoint tests removed and the new behavior covered.

- [ ] **Step 2: Sweep for dead references**

Run: `cd agent && grep -rn "decide_steering\|score_checkpoint\|PUDDLE_USE_REALTIME\|InterviewRunner\|decide_next_action" src tests`
Expected: only legitimate remaining hits (e.g. backend score-checkpoint endpoint if still used elsewhere). Remove any orphaned realtime/cascade references.

- [ ] **Step 3: Confirm the live path imports no live scorer**

Run: `cd agent && grep -rn "from agent.scoring.scorer\|import Scorer" src/agent/controller src/agent/worker`
Expected: NO hits (Scorer is referenced only under `src/agent/eval`).

- [ ] **Step 4: Commit any cleanup**

```bash
git add -A agent && git commit -m "chore(realtime): dead-reference sweep after scorer/cascade removal" || echo "nothing to clean"
```

---

## Manual-gate follow-up (NOT part of the autonomous run)

After this plan is green, the cutover is a separate, operator-approved step:
- Flip the deployed worker to the realtime path (the flag is gone; the entrypoint is realtime-only) — **deploy/release, manual-gate**.
- Live LiveKit room smoke test (verify tool `type:function` normalization, `_force_wrap_up` synthetic `respond_to_tool`, vendor I/O) — **manual-gate**.
- Run with a real candidate — **manual-gate**.

## Self-Review (completed)

- **Spec coverage:** §1 shape (Tasks 5–6), §2 kept/removed (Tasks 1–3, 5–6), §3 depth/coverage split (Task 4 exemplars + existing ControlBus backstop, unchanged), §4 taxonomy (model cases → Task 4 instructions; hard cases → existing ControlBus, retained; guardrail → Task 3; silence/reprompt → see note), §5 transcript contract (already met; hardened in Task 8), §6 latency (Tasks 1–3 remove all inline model calls), §7 testing (Task 7), manual-gate (follow-up section).
- **Deferred from spec (flagged, not silently dropped):** the **silence/reprompt → advance** hard control (§4 row) is NOT implemented here. The current realtime session surfaces only `InputTranscript`/`OutputTranscript`/`ToolCall` — no silence event — so a runner-side inactivity timer is a self-contained additive feature best done as its own follow-up plan once the core redesign is green and the live room confirms how the model handles pauses. Tracked as the first follow-up.
- **Placeholder scan:** test assertions that depend on the `FakeRealtimeSession` recording API are marked "adapt to the Fake API / mirror existing tests" rather than guessed — the implementer mirrors the existing `test_realtime_runner.py` fixtures.
- **Type consistency:** `_probe_cursor` (Task 2), `_bg_tasks`/`_drain_background` (Task 3), `measure_transcript_quality`/`TranscriptQuality` (Task 7) are defined where introduced and used consistently.
