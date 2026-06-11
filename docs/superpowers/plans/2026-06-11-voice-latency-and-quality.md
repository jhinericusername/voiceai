# Voice Latency & Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill the 5–20 s post-answer silence by moving both Anthropic calls (scoring, probe generation) off the speech path and behind spoken acknowledgments, instrument every turn so the fix is measured, and set up a TTS A/B bench to fix the "wonky" voice — feeding into cloning Prakul's voice.

**Architecture:** The controller's `_run_question` loop currently runs `scorer.score()` (sync Anthropic call) and `probe_generator.generate()` (second sync call) between `listen()` returning and the next `say()` — and because they're sync calls on the event loop they also stall LiveKit's audio tasks. Fix: immediately after each answer, speak a rubric acknowledgment ("Got it. Got it. Got it.") while scoring runs in `asyncio.to_thread`; probe generation also moves to a thread. A new `TurnTimer` logs per-turn gaps (answer→ack, score, probe) so improvements are measured, not vibed. A `tmp/voice-bench/` script renders the same prompts through candidate Cartesia configs to WAVs for the operator to pick by ear.

**Tech Stack:** Python 3.12 / uv / pytest (asyncio_mode=auto), LiveKit Agents 1.5.11, Cartesia sonic-3 REST, Anthropic SDK.

**Spec:** `docs/handoff/2026-06-11-voice-latency-and-cloning.md` (treated as approved design per the prior session).

---

## Status / blocked items

- Tasks 1–4: executable now, autonomous.
- Task 5 (clone Prakul's voice): **blocked** — waiting on audio from Prakul via the user.
- Task 6 (deploy agent image): **manual-gate** — needs explicit operator approval.
- Task 7 (room-app deploy target): **blocked** — open question to user (which URL serves the call screen).

---

### Task 1: TurnTimer instrumentation

**Files:**
- Create: `agent/src/agent/controller/turn_metrics.py`
- Test: `agent/tests/test_turn_metrics.py`

- [ ] **Step 1: Write the failing test**

```python
import logging

from agent.controller.turn_metrics import TurnTimer


def _fake_clock(values: list[float]):
    it = iter(values)
    return lambda: next(it)


def test_turn_timer_records_gaps_relative_to_answer() -> None:
    # answer_received=10.0, ack_started=10.2, score_started=10.0... use marks
    timer = TurnTimer("q1", now=_fake_clock([10.0, 10.1, 10.2, 13.2, 14.0, 14.5]))
    timer.mark("score_started")     # 10.1
    timer.mark("ack_started")       # 10.2
    timer.mark("score_finished")    # 13.2
    timer.mark("probe_started")     # 14.0
    timer.mark("probe_finished")    # 14.5

    summary = timer.summary()

    assert summary["question_id"] == "q1"
    assert summary["ack_latency_seconds"] == pytest_approx(0.2)
    assert summary["score_seconds"] == pytest_approx(3.1)
    assert summary["probe_seconds"] == pytest_approx(0.5)


def pytest_approx(value: float):
    import pytest

    return pytest.approx(value, abs=1e-6)


def test_turn_timer_missing_marks_are_none() -> None:
    timer = TurnTimer(None, now=_fake_clock([0.0]))
    summary = timer.summary()
    assert summary["ack_latency_seconds"] is None
    assert summary["score_seconds"] is None
    assert summary["probe_seconds"] is None


def test_turn_timer_emit_logs_one_structured_line(caplog) -> None:
    timer = TurnTimer("q2", now=_fake_clock([0.0, 0.3]))
    timer.mark("ack_started")
    with caplog.at_level(logging.INFO, logger="agent.controller.turn_metrics"):
        timer.emit()
    records = [r for r in caplog.records if r.message == "turn latency"]
    assert len(records) == 1
    assert records[0].turn_latency["question_id"] == "q2"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent && uv run pytest tests/test_turn_metrics.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.controller.turn_metrics'`

- [ ] **Step 3: Write minimal implementation**

```python
"""Per-turn latency instrumentation for the interview controller.

Measures the gaps a candidate actually feels — answer-received → first agent
speech — plus how long scoring and probe generation take. One structured log
line per candidate turn ("turn latency", extra={"turn_latency": {...}}) so the
latency harness can parse worker logs with no new storage dependency.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable

logger = logging.getLogger(__name__)

_GAPS: dict[str, tuple[str, str]] = {
    "ack_latency_seconds": ("answer_received", "ack_started"),
    "score_seconds": ("score_started", "score_finished"),
    "probe_seconds": ("probe_started", "probe_finished"),
    "next_prompt_latency_seconds": ("answer_received", "next_prompt_started"),
}


class TurnTimer:
    """Collects monotonic checkpoints for one candidate turn.

    `answer_received` is marked at construction; the controller marks the rest
    as the turn progresses. Marks may be absent (e.g. no probe) — the summary
    reports None for those gaps.
    """

    def __init__(
        self,
        question_id: str | None,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self._now = now
        self._question_id = question_id
        self._marks: dict[str, float] = {}
        self.mark("answer_received")

    def mark(self, name: str) -> None:
        self._marks[name] = self._now()

    def _gap(self, start: str, end: str) -> float | None:
        if start not in self._marks or end not in self._marks:
            return None
        return self._marks[end] - self._marks[start]

    def summary(self) -> dict[str, float | str | None]:
        result: dict[str, float | str | None] = {"question_id": self._question_id}
        for label, (start, end) in _GAPS.items():
            result[label] = self._gap(start, end)
        return result

    def emit(self) -> dict[str, float | str | None]:
        summary = self.summary()
        logger.info("turn latency", extra={"turn_latency": summary})
        return summary
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent && uv run pytest tests/test_turn_metrics.py -v`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/controller/turn_metrics.py agent/tests/test_turn_metrics.py
git commit -m "feat(agent): per-turn latency instrumentation (TurnTimer)"
```

---

### Task 2: Speak the acknowledgment immediately; score concurrently

**Files:**
- Modify: `agent/src/agent/domain/types.py:9-17` (add `"ACK"` to `ReasonCode`)
- Modify: `agent/src/agent/controller/interview.py` (`run()` ack block out, `_run_question` restructured)
- Test: `agent/tests/test_interview_runner.py`

The rubric's own comment says acks play "when the candidate finishes a turn" — today the code plays them *before the next question* instead, leaving the answer→ack gap to the scorer LLM call. Move the ack to right after `_listen` returns and overlap it with scoring in a worker thread.

- [ ] **Step 1: Write the failing tests** (append to `agent/tests/test_interview_runner.py`)

```python
import threading
import time as time_module


async def test_ack_is_spoken_while_scoring_runs(tmp_path: Path) -> None:
    """The controller must NOT await scoring before acknowledging the answer.

    The fake scorer (running in a worker thread) blocks until the ack has been
    spoken; if the controller serialized score-then-speak this would time out.
    """
    rubric = RUBRIC.model_copy(update={"questions": [RUBRIC.questions[0]]})
    acks = set(RUBRIC.style.acknowledgments)
    ack_spoken = threading.Event()

    voice = _simulated_voice()

    async def speak(text: str, mode: str = "scripted") -> None:  # noqa: ARG001
        if text in acks:
            ack_spoken.set()

    voice.speak = AsyncMock(side_effect=speak)

    def blocking_score(si):  # noqa: ANN001
        assert ack_spoken.wait(timeout=5.0), "ack not spoken while scoring ran"
        return _confident(si.target_categories[0])

    scorer = MagicMock()
    scorer.score.side_effect = blocking_score
    runner = InterviewRunner(
        rubric=rubric, voice=voice, scorer=scorer,
        probe_generator=MagicMock(),
        event_log=EventLog(session_id="s-conc", path=tmp_path / "events.jsonl"),
        clock_now=time_module.monotonic,
    )

    assessment = await asyncio.wait_for(runner.run(session_id="s-conc"), timeout=30)
    assert assessment.session_id == "s-conc"


async def test_each_candidate_answer_is_acknowledged_immediately(tmp_path: Path) -> None:
    """After every question-loop candidate turn, the next agent utterance is an
    acknowledgment from the rubric pool (logged with the ACK reason code)."""
    rubric = RUBRIC.model_copy(update={"questions": [RUBRIC.questions[0]]})
    voice = _simulated_voice()
    scorer = MagicMock()
    scorer.score.side_effect = lambda si: _confident(si.target_categories[0])
    runner = InterviewRunner(
        rubric=rubric, voice=voice, scorer=scorer,
        probe_generator=MagicMock(),
        event_log=EventLog(session_id="s-ack", path=tmp_path / "events.jsonl"),
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
    )
    await runner.run(session_id="s-ack")

    turns = runner.transcript_turns()
    acks = set(RUBRIC.style.acknowledgments)
    question_answer_indices = [
        i for i, t in enumerate(turns)
        if t.speaker == "candidate" and t.question_id not in (None, "opener")
    ]
    assert question_answer_indices, "no question answers captured"
    for i in question_answer_indices:
        following_agent = next(
            (t for t in turns[i + 1:] if t.speaker == "agent"), None
        )
        assert following_agent is not None
        assert following_agent.text in acks, (
            f"expected ack right after answer turn {i}, got: {following_agent.text!r}"
        )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd agent && uv run pytest tests/test_interview_runner.py -v -k "ack"`
Expected: `test_ack_is_spoken_while_scoring_runs` FAILS (assertion inside scorer thread: ack not spoken) and `test_each_candidate_answer_is_acknowledged_immediately` FAILS (next agent turn is the next question / closer, not an ack).

- [ ] **Step 3: Implement**

3a. `agent/src/agent/domain/types.py` — add `"ACK"` to the `ReasonCode` Literal (after `"INTRO"`):

```python
ReasonCode = Literal[
    "CONSENT",
    "INTRO",
    "ACK",
    "SCRIPTED_QUESTION",
    "PROBE_LOW_CONFIDENCE",
    "AUDIO_REPAIR",
    "TIMEBOX_MOVE_ON",
    "CLOSING",
]
```

(The backend passes `agentEvents` through opaquely — verified no reason-code validation in `backend/src`.)

3b. `agent/src/agent/controller/interview.py` — in `run()`, delete the between-questions ack block:

```python
            # DELETE these lines from run():
            # Optional acknowledgment between questions (not before the first).
            if q_idx > 0:
                ack = self._next_acknowledgment()
                if ack:
                    await self._say(ack, "SCRIPTED_QUESTION", question.question_id)
```

3c. `interview.py` — import the timer at the top with the other controller imports:

```python
from agent.controller.turn_metrics import TurnTimer
```

3d. `interview.py` — restructure `_run_question`'s loop body (the listen→score section becomes):

```python
        while True:
            self.state_machine.transition(InterviewState.QUESTION_ANSWERING)
            await self._listen(question.question_id)  # type: ignore[attr-defined]
            timer = TurnTimer(question.question_id)  # type: ignore[attr-defined]
            self.state_machine.transition(InterviewState.QUESTION_SCORING)
            logger.info(
                "scoring candidate answer",
                extra={"question_id": question.question_id},  # type: ignore[attr-defined]
            )
            scorer_input = ScorerInput(
                script_version=self._rubric.script_version,
                question_id=question.question_id,  # type: ignore[attr-defined]
                target_categories=targets,
                transcript=list(self._transcript),
            )
            timer.mark("score_started")
            # Anthropic call runs in a worker thread so the acknowledgment can
            # play immediately — and so the LiveKit audio tasks on this event
            # loop are never starved by a blocking HTTP call.
            score_task = asyncio.create_task(
                asyncio.to_thread(self._scorer.score, scorer_input)
            )
            ack = self._next_acknowledgment()
            if ack:
                timer.mark("ack_started")
                await self._say(ack, "ACK", question.question_id)  # type: ignore[attr-defined]
            output = await score_task
            timer.mark("score_finished")
            for assessment in output.assessments:
                latest[assessment.category] = assessment
```

The remainder of the loop (decide_next_action / advance / probe) is Task 3.

- [ ] **Step 4: Run the new tests and the whole runner suite**

Run: `cd agent && uv run pytest tests/test_interview_runner.py tests/test_event_log.py -v`
Expected: all PASS (the two new tests plus no regressions).

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/domain/types.py agent/src/agent/controller/interview.py agent/tests/test_interview_runner.py
git commit -m "feat(agent): acknowledge answers immediately, score concurrently off the speech path"
```

---

### Task 3: Probe generation off the event loop + per-turn emit + latency budget test

**Files:**
- Modify: `agent/src/agent/controller/interview.py` (probe path in `_run_question`)
- Test: `agent/tests/test_interview_runner.py`

- [ ] **Step 1: Write the failing tests** (append to `agent/tests/test_interview_runner.py`)

```python
async def test_probe_generation_runs_in_worker_thread(tmp_path: Path) -> None:
    """probe_generator.generate must not run on the event loop thread."""
    rubric = RUBRIC.model_copy(update={"questions": [RUBRIC.questions[0]]})
    voice = _simulated_voice()
    seen_threads: list[str] = []
    calls = {"n": 0}

    def score(si):  # noqa: ANN001
        calls["n"] += 1
        out = _confident(si.target_categories[0])
        if calls["n"] == 1:
            out.assessments[0].confidence = 0.2  # force one probe
        return out

    def generate(req):  # noqa: ANN001
        seen_threads.append(threading.current_thread().name)
        return "Can you walk me through the hardest part?"

    scorer = MagicMock()
    scorer.score.side_effect = score
    probe_generator = MagicMock()
    probe_generator.generate.side_effect = generate
    runner = InterviewRunner(
        rubric=rubric, voice=voice, scorer=scorer,
        probe_generator=probe_generator,
        event_log=EventLog(session_id="s-probe", path=tmp_path / "events.jsonl"),
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
    )
    await runner.run(session_id="s-probe")

    assert probe_generator.generate.called
    main_thread = threading.main_thread().name
    assert all(name != main_thread for name in seen_threads), (
        "probe generation ran on the event loop thread"
    )


async def test_ack_latency_budget_with_slow_scorer(tmp_path: Path) -> None:
    """Latency budget: with a 500 ms scorer, the ack must start within 300 ms
    of the answer landing — the candidate never waits on the LLM."""
    rubric = RUBRIC.model_copy(update={"questions": [RUBRIC.questions[0]]})
    acks = set(RUBRIC.style.acknowledgments)
    answer_returned_at: list[float] = []
    ack_started_at: list[float] = []

    voice = _simulated_voice()

    async def listen() -> ListenResult:
        answer_returned_at.append(time_module.monotonic())
        return ListenResult(transcript="A full answer.", end_of_turn=True)

    async def speak(text: str, mode: str = "scripted") -> None:  # noqa: ARG001
        if text in acks and len(ack_started_at) < len(answer_returned_at):
            ack_started_at.append(time_module.monotonic())

    voice.listen = AsyncMock(side_effect=listen)
    voice.speak = AsyncMock(side_effect=speak)

    def slow_score(si):  # noqa: ANN001
        time_module.sleep(0.5)
        return _confident(si.target_categories[0])

    scorer = MagicMock()
    scorer.score.side_effect = slow_score
    runner = InterviewRunner(
        rubric=rubric, voice=voice, scorer=scorer,
        probe_generator=MagicMock(),
        event_log=EventLog(session_id="s-budget", path=tmp_path / "events.jsonl"),
        clock_now=time_module.monotonic,
    )
    await asyncio.wait_for(runner.run(session_id="s-budget"), timeout=30)

    assert ack_started_at, "no ack observed"
    gap = ack_started_at[0] - answer_returned_at[-len(ack_started_at)]
    # generous CI bound; the point is it's not 500ms+ (serialized scoring)
    assert gap < 0.3, f"ack started {gap:.3f}s after the answer"
```

Note: `answer_returned_at[-len(ack_started_at)]` pairs the first question-loop
answer with the first ack even though opener listens also append timestamps —
with the single-question rubric the last listen before the ack is the
question answer.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd agent && uv run pytest tests/test_interview_runner.py -v -k "probe_generation_runs or latency_budget"`
Expected: `test_probe_generation_runs_in_worker_thread` FAILS (main-thread name seen), `test_ack_latency_budget_with_slow_scorer` FAILS (gap ≥ 0.5 s) — *if Task 2 landed, the budget test may already pass; keep it as the permanent regression net.*

- [ ] **Step 3: Implement** — in `_run_question`, the probe path becomes:

```python
            self.state_machine.transition(InterviewState.QUESTION_PROBING)
            logger.info(
                "generating probe",
                extra={
                    "question_id": question.question_id,  # type: ignore[attr-defined]
                    "category": directive.probe_category,
                },
            )
            probe_request = ProbeRequest(
                category_assessment=latest[directive.probe_category],  # type: ignore[index]
                transcript=list(self._transcript),
                probes_used=probes_used,
                max_probes=question.max_probes,  # type: ignore[attr-defined]
            )
            timer.mark("probe_started")
            probe_text = await asyncio.to_thread(
                self._probe_generator.generate, probe_request
            )
            timer.mark("probe_finished")
            probes_used += 1
            timer.mark("next_prompt_started")
            timer.emit()
            await self._say(
                probe_text,
                "PROBE_LOW_CONFIDENCE",
                question.question_id,  # type: ignore[attr-defined]
                category=directive.probe_category,
                missing_element=directive.missing_element,
            )
```

and the advance path gains the emit before returning:

```python
            if directive.action == "advance":
                timer.mark("next_prompt_started")
                timer.emit()
                if self._clock.must_move_on():
                    await self._say(
                        HUMANE_BOUNDARY_LINE,
                        "TIMEBOX_MOVE_ON",
                        question.question_id,  # type: ignore[attr-defined]
                    )
                return latest
```

- [ ] **Step 4: Run the full agent suite + lint**

Run: `cd agent && uv run pytest -q && uv run ruff check .`
Expected: all PASS, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/controller/interview.py agent/tests/test_interview_runner.py
git commit -m "feat(agent): probe generation off the event loop; emit per-turn latency"
```

---

### Task 4: TTS A/B bench (tmp/, experimental)

**Files:**
- Create: `tmp/voice-bench/bench.py`
- Output: `tmp/voice-bench/*.wav` (gitignored area — `tmp/` is experimental per operating instructions; add `tmp/` to `.gitignore` if not present)

No TDD — this is a throwaway listening bench, not product code.

- [ ] **Step 1: Write the bench script**

```python
"""Cartesia TTS A/B bench — renders the same interview lines through candidate
configs so voice choices are heard, not guessed.

Usage:  cd agent && uv run --env-file ../.env python ../tmp/voice-bench/bench.py

Writes tmp/voice-bench/<config>__<line>.wav
"""

from __future__ import annotations

import os
from pathlib import Path

import httpx

OUT = Path(__file__).parent
API = "https://api.cartesia.ai/tts/bytes"
VERSION = "2025-04-16"

LINES = {
    "greeting": "Hello. How are you?",
    "ack": "Got it. Got it. Got it.",
    "intro": (
        "Well, my name is Prakul. I'm an engineer here at Weave, and I guess "
        "the purpose of this is to learn more about you, your technical "
        "background, stuff you do outside of work. And I guess with that "
        "being said, can you tell me a bit about yourself?"
    ),
    "question": (
        "Can you walk me through a project you are most proud of, and what "
        "made it technically hard?"
    ),
}

# Candidate configs. "current" mirrors agent/src/agent/voice/tts.py today;
# "defaults" is the prime suspect fix (no speed override, no text pacing).
CONFIGS: dict[str, dict] = {
    "current-speed105-paced": {"speed": 1.05, "text_pacing": True},
    "defaults": {},
    "slow-natural": {"speed": 0.95},
}


def synthesize(client: httpx.Client, cfg_name: str, cfg: dict, line_name: str, text: str) -> None:
    voice_id = os.environ.get("CARTESIA_VOICE_ID", "").strip()
    payload: dict = {
        "model_id": "sonic-3",
        "transcript": text,
        "language": "en",
        "output_format": {
            "container": "wav",
            "encoding": "pcm_s16le",
            "sample_rate": 24000,
        },
    }
    if voice_id:
        payload["voice"] = {"mode": "id", "id": voice_id}
    # Cartesia experimental controls ride in "speed" / generation options when set
    payload.update({k: v for k, v in cfg.items() if v is not None})
    resp = client.post(
        API,
        json=payload,
        headers={
            "X-API-Key": os.environ["CARTESIA_API_KEY"],
            "Cartesia-Version": VERSION,
        },
        timeout=60,
    )
    resp.raise_for_status()
    out = OUT / f"{cfg_name}__{line_name}.wav"
    out.write_bytes(resp.content)
    print(f"wrote {out} ({len(resp.content)} bytes)")


def main() -> None:
    with httpx.Client() as client:
        for cfg_name, cfg in CONFIGS.items():
            for line_name, text in LINES.items():
                synthesize(client, cfg_name, cfg, line_name, text)


if __name__ == "__main__":
    main()
```

(If the REST payload shape for speed/pacing differs from the plugin kwargs,
adjust per the Cartesia bytes-endpoint docs at run time — this script is in
`tmp/` precisely so it can be iterated freely.)

- [ ] **Step 2: Run it and send the WAVs to the operator**

Run: `cd agent && uv run --env-file ../.env python ../tmp/voice-bench/bench.py`
Expected: 12 WAVs under `tmp/voice-bench/`. Send them to the user (SendUserFile) grouped by config; ask which config sounds least "wonky".

- [ ] **Step 3: Apply the winning config to `agent/src/agent/voice/tts.py`** (operator picks; if "defaults" wins, drop `speed`/`text_pacing` from the kwargs and update `agent/tests/test_tts.py` expectations), run `cd agent && uv run pytest tests/test_tts.py -v`, commit:

```bash
git add agent/src/agent/voice/tts.py agent/tests/test_tts.py
git commit -m "fix(tts): apply A/B-chosen Cartesia config"
```

---

### Task 5: Clone Prakul's voice — **BLOCKED on audio**

When the user supplies 2–5 min of clean solo WAV/FLAC from Prakul (consent confirmed by sourcing it from him directly):

- [ ] Clone via Cartesia API: `POST https://api.cartesia.ai/voices/clone` (multipart: `clip=@prakul.wav`, `name="Prakul (Weave interviewer)"`, `mode="stability"`, `language="en"`) with the same `X-API-Key`/`Cartesia-Version` headers → returns a voice `id`.
- [ ] Re-run the Task 4 bench with `CARTESIA_VOICE_ID=<new id>` to A/B the clone against the current voice; user picks.
- [ ] Set `CARTESIA_VOICE_ID` in local `.env`, and add it to the agent task-def env in `infra/lib/infra-stack.ts` (plain env var, not a secret — the API key stays in Secrets Manager).
- [ ] Commit the infra change (deploying it is Task 6's gate).

---

### Task 6: Build + deploy agent image — **manual-gate**

Halt and ask the operator before any of this:

- [ ] `docker build -f agent/Dockerfile .` from repo root (ARM64), tag `puddle-videoagent-agent:<sha>-voice-latency`.
- [ ] Push to ECR `851725544921.dkr.ecr.us-west-1.amazonaws.com/puddle-videoagent-agent`, register task-def revision (family `puddle-videoagent-agent`, currently rev 15), update `puddle-videoagent-agent-service` in cluster `puddle-videoagent-cluster`.
- [ ] Verify with a test interview per `docs/RUNBOOK.md` §6; watch the new "turn latency" log lines in CloudWatch.

---

### Task 7: Room app deploy target — **blocked on user**

The committed-but-undeployed `room/` readiness signal costs every interview a
10 s opener delay (agent fails open after `PUDDLE_CANDIDATE_READY_TIMEOUT_SECONDS`).
Ask the user: *what URL serves the actual call screen in a test interview?*
(CDK `room-web` bucket is empty; only CloudFront dist points at
`react-cors-spa-j96n53xqc6` in us-east-1.) Until answered, optionally lower the
timeout via task-def env as a stopgap (that change rides the Task 6 gate).

---

## Self-review notes

- Spec coverage: latency (Tasks 1–3), wonky voice (Task 4), clone (Task 5), test harness (Tasks 1 & 3 permanent assertions + Task 4 bench), manual-gate deploy (Task 6), frontend question (Task 7). Merge-main prerequisite was completed before planning.
- Types: `TurnTimer.mark/summary/emit` used consistently; `"ACK"` reason code added before first use; `ScorerInput`/`ProbeRequest` shapes match `agent/src/agent/scoring/io_types.py` and `probe.py` as read today.
- The concurrency tests use thread-event blocking rather than sleeps where possible; the one timing assertion (300 ms bound vs 500 ms scorer) has 200 ms of slack for CI noise.
