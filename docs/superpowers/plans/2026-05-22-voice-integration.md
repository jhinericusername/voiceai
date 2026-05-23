# Live LiveKit Voice Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the skeleton audio/video seam with real LiveKit Agents 1.5 integration so a candidate can be interviewed by voice locally, end to end, and an `Assessment` is written to the database.

**Architecture:** The Interview Controller stays deterministic and speaks verbatim text. A new `LiveKitVoiceAgent` implements the existing `VoiceAgent` ABC against a real `AgentSession` (Deepgram STT, Cartesia TTS, Silero VAD) — `speak()` → `session.say()`, `listen()` → next final STT transcript. The worker entrypoint is rewritten for the real `JobContext`. The backend issues candidate join tokens; the `room` app self-serves a session and connects with `livekit-client` (mic + camera). No recording, no video analysis.

**Tech Stack:** Python 3.12 + uv; `livekit-agents` 1.5.11 + `livekit-plugins-deepgram` / `-cartesia` / `-silero` / `-turn-detector`; `asyncpg`; TypeScript pnpm workspace; `livekit-server-sdk`; `livekit-client`; Fastify; React + Vite.

**IMPORTANT — read before starting.** The live audio/video wiring (`build_agent_session`, `LiveKitVoiceAgent`, the room-app LiveKit connection) cannot be verified by unit tests — it is `# pragma: no cover` vendor wiring. Those tasks build against the real installed API; the acceptance test is a real local voice interview (Task 4.x). Where a task's code is live wiring, **verify exact signatures against the installed package** (`agent/.venv/.../livekit/agents/`) **and** https://docs.livekit.io/agents/ before and during implementation — the API shown here is the intended shape, not a guaranteed signature. The offline-testable tasks (1.3, 1.5 SQL builder, 2.1, 3.2) follow strict TDD with real assertions.

The design spec is `docs/superpowers/specs/2026-05-22-voice-integration-design.md`.

---

## Phase 1: Agent worker — real LiveKit voice loop

### Task 1.1: API spike — pin the AgentSession scripted-mode contract

This task writes NO production code. It resolves the spec's open risk: can `AgentSession` run **without an `llm`** in a `say()`-driven mode, and what are the exact signatures? Everything downstream depends on the answer.

**Files:**
- Create: `docs/superpowers/notes/livekit-agentsession-api.md`

- [ ] **Step 1: Inspect the installed AgentSession**
Run (from `agent/`):
```bash
uv run python -c "
import inspect
from livekit.agents import AgentSession, Agent, JobContext
from livekit.agents.voice.events import UserInputTranscribedEvent
print('AgentSession.__init__:', inspect.signature(AgentSession.__init__))
print('AgentSession.say:', inspect.signature(AgentSession.say))
print('AgentSession.start:', inspect.signature(AgentSession.start))
print('AgentSession.interrupt:', inspect.signature(AgentSession.interrupt) if hasattr(AgentSession,'interrupt') else 'NONE')
print('Agent.__init__:', inspect.signature(Agent.__init__))
print('UserInputTranscribedEvent fields:', UserInputTranscribedEvent.__annotations__)
print('JobContext.connect:', inspect.signature(JobContext.connect))
"
```

- [ ] **Step 2: Confirm an LLM-less session is supported**
Determine whether `AgentSession(stt=..., tts=..., vad=...)` constructs and `start()`s with **no `llm`**, and whether `session.say(text)` works without an LLM. Check the docstrings / source of `agent_session.py` and `agent_activity.py` in the venv. Check https://docs.livekit.io/agents/build/ for the "say" / scripted-speech and "transcriptions" pages.

- [ ] **Step 3: Confirm the listen path**
Confirm how a completed candidate turn surfaces: the `user_input_transcribed` event with `is_final=True`, or `conversation_item_added` with a `role="user"` item. Note the exact event name, payload fields, and how to subscribe (`session.on("user_input_transcribed", cb)`).

- [ ] **Step 4: Confirm VAD + turn detection**
Check whether `livekit-plugins-silero` is installed (`uv run python -c "import livekit.plugins.silero"`). Note how to construct VAD (`silero.VAD.load()`) and how turn detection is configured on `AgentSession` (`turn_detection=` / the `livekit-plugins-turn-detector` model).

- [ ] **Step 5: Write the findings note**
`docs/superpowers/notes/livekit-agentsession-api.md` records, with exact signatures: the `AgentSession` constructor args to use; whether `llm` is omittable (and if not, the chosen fallback — a minimal stub LLM that is never invoked, or the lower-level `RoomIO`+`stt`+`tts` approach); the `say()` signature and how to await playout; the listen event name + fields; the VAD/turn-detection construction. Every later task in Phase 1 references this note.

- [ ] **Step 6: Commit**
```bash
git add docs/superpowers/notes/livekit-agentsession-api.md && git commit -m "Spike: pin LiveKit AgentSession scripted-mode API"
```

---

### Task 1.2: Add the Silero VAD dependency and the AgentSession factory

**Files:**
- Modify: `agent/pyproject.toml`
- Create: `agent/src/agent/voice/session.py`

- [ ] **Step 1: Add the Silero plugin dependency**
In `agent/pyproject.toml`, add to the `[project].dependencies` list:
```
    "livekit-plugins-silero>=1.5",
```
Run: `cd agent && uv sync --extra dev` — expect it resolves, exit 0. If the version constraint fails to resolve, match it to the installed `livekit-agents` version line and report the adjustment.

- [ ] **Step 2: Write `build_agent_session`**
`agent/src/agent/voice/session.py` — a `# pragma: no cover` factory that constructs the real `AgentSession` per the Task 1.1 findings note. Intended shape (verify against the note):
```python
"""Construct the real LiveKit AgentSession for the cascaded voice loop."""

from __future__ import annotations

from typing import Any


def build_agent_session(deepgram_api_key: str, cartesia_api_key: str) -> Any:  # pragma: no cover — vendor wiring
    """Build an AgentSession: Deepgram STT (Nova-3), Cartesia TTS (Sonic-3),
    Silero VAD, semantic turn detection. No LLM — the Interview Controller
    supplies every spoken word verbatim.
    """
    from livekit.agents import AgentSession
    from livekit.plugins import cartesia, deepgram, silero

    return AgentSession(
        stt=deepgram.STT(model="nova-3", api_key=deepgram_api_key),
        tts=cartesia.TTS(model="sonic-3", api_key=cartesia_api_key),
        vad=silero.VAD.load(),
        # turn_detection: per the Task 1.1 note — e.g. the multilingual
        # turn-detector model, or "vad" if the model is not used.
    )
```
Adjust constructor args to exactly match the Task 1.1 findings.

- [ ] **Step 3: Verify it imports**
Run: `cd agent && uv run python -c "from agent.voice.session import build_agent_session; print('ok')"`
Expected: `ok` (the factory body is not executed — only imported).

- [ ] **Step 4: Commit**
```bash
git add agent/pyproject.toml agent/uv.lock agent/src/agent/voice/session.py && git commit -m "Add Silero VAD dep and the real AgentSession factory"
```

---

### Task 1.3: Rewrite the worker entrypoint for the real JobContext

The current `build_session_context` reads `job.metadata`, which does not exist on the real `JobContext` (it is `ctx.job.metadata`). This task fixes the parsing — it IS unit-testable with a fake context.

**Files:**
- Modify: `agent/src/agent/worker/entrypoint.py`
- Modify: `agent/tests/test_worker_entrypoint.py`

- [ ] **Step 1: Update the failing test**
Replace the body of `agent/tests/test_worker_entrypoint.py` with tests that build the fake context with the REAL shape — metadata on `ctx.job.metadata`, room name on `ctx.room.name`:
```python
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.worker.entrypoint import InterviewJobContext, build_session_context

_META = (
    '{"session_id": "sess1", "org_id": "org1", '
    '"script_version": "pilot-v1", "candidate_email": "c@example.com"}'
)


def _fake_ctx(metadata: str | None, room_name: str = "interview-sess1") -> MagicMock:
    ctx = MagicMock()
    ctx.job.metadata = metadata
    ctx.room.name = room_name
    return ctx


def test_build_session_context_reads_job_metadata() -> None:
    ctx = build_session_context(_fake_ctx(_META))
    assert isinstance(ctx, InterviewJobContext)
    assert ctx.session_id == "sess1"
    assert ctx.org_id == "org1"
    assert ctx.script_version == "pilot-v1"
    assert ctx.room_name == "interview-sess1"


def test_build_session_context_rejects_missing_session_id() -> None:
    ctx = _fake_ctx('{"org_id": "org1", "script_version": "pilot-v1"}')
    with pytest.raises(ValueError, match="session_id"):
        build_session_context(ctx)


def test_build_session_context_rejects_empty_metadata() -> None:
    with pytest.raises(ValueError):
        build_session_context(_fake_ctx(None))
```

- [ ] **Step 2: Run the test to verify it fails**
Run: `cd agent && uv run pytest tests/test_worker_entrypoint.py`
Expected: FAIL — the current `build_session_context` reads `job.metadata`, not `ctx.job.metadata`.

- [ ] **Step 3: Rewrite `build_session_context`**
In `agent/src/agent/worker/entrypoint.py`, replace `build_session_context` so it reads `ctx.job.metadata` and `ctx.room.name`:
```python
def build_session_context(ctx: Any) -> InterviewJobContext:
    """Parse the dispatch metadata on a LiveKit JobContext.

    Raises `ValueError` if required fields are absent — the worker must never
    join a room it cannot identify.
    """
    raw = ctx.job.metadata if ctx.job is not None else None
    meta = json.loads(raw) if raw else {}
    for field in ("session_id", "org_id", "script_version", "candidate_email"):
        if not meta.get(field):
            raise ValueError(f"job metadata missing required field: {field}")
    return InterviewJobContext(
        session_id=meta["session_id"],
        org_id=meta["org_id"],
        script_version=meta["script_version"],
        candidate_email=meta["candidate_email"],
        room_name=ctx.room.name,
    )
```
Leave `InterviewJobContext`, `RunInterview`, and `entrypoint` in place for now — `entrypoint`'s body is rewritten in Task 1.6.

- [ ] **Step 4: Run the test to verify it passes**
Run: `cd agent && uv run pytest tests/test_worker_entrypoint.py`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/worker/entrypoint.py agent/tests/test_worker_entrypoint.py && git commit -m "Rewrite build_session_context for the real LiveKit JobContext"
```

---

### Task 1.4: LiveKitVoiceAgent — the VoiceAgent adapter over AgentSession

`InterviewRunner` drives a `VoiceAgent` (ABC in `voice/interface.py`: `speak`, `listen`, `interrupt`, `set_mode`). This task implements that ABC against a real `AgentSession`. It is `# pragma: no cover` live wiring — but its `listen()` event-to-queue bridge has a small piece of pure logic that IS tested.

**Files:**
- Create: `agent/src/agent/voice/livekit_agent.py`
- Test: `agent/tests/test_livekit_agent.py`

- [ ] **Step 1: Write the failing test for the transcript queue bridge**
`listen()` must return one candidate turn per call. The session emits transcript events asynchronously; the adapter buffers final transcripts in an `asyncio.Queue` and `listen()` awaits one. Test that pure bridge:
```python
import asyncio

from agent.voice.interface import ListenResult
from agent.voice.livekit_agent import _TranscriptInbox


async def test_inbox_delivers_final_transcripts_in_order() -> None:
    inbox = _TranscriptInbox()
    inbox.push("I rewrote the scheduler.")
    inbox.push("It cut latency in half.")
    first = await inbox.next_turn()
    second = await inbox.next_turn()
    assert isinstance(first, ListenResult)
    assert first.transcript == "I rewrote the scheduler."
    assert first.end_of_turn is True
    assert second.transcript == "It cut latency in half."


async def test_inbox_next_turn_waits_for_a_transcript() -> None:
    inbox = _TranscriptInbox()
    task = asyncio.create_task(inbox.next_turn())
    await asyncio.sleep(0)
    assert not task.done()  # nothing pushed yet
    inbox.push("a late answer")
    result = await task
    assert result.transcript == "a late answer"
```

- [ ] **Step 2: Run the test to verify it fails**
Run: `cd agent && uv run pytest tests/test_livekit_agent.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'agent.voice.livekit_agent'`.

- [ ] **Step 3: Implement `livekit_agent.py`**
`_TranscriptInbox` is plain `asyncio` logic (tested). `LiveKitVoiceAgent` is the `# pragma: no cover` adapter. Intended shape — verify the `AgentSession` calls against the Task 1.1 note:
```python
"""LiveKitVoiceAgent — the VoiceAgent ABC backed by a real AgentSession."""

from __future__ import annotations

import asyncio
from typing import Any

from agent.voice.interface import ListenResult, VoiceAgent, VoiceMode


class _TranscriptInbox:
    """Buffers final candidate transcripts so `listen()` can await one turn."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue[str] = asyncio.Queue()

    def push(self, transcript: str) -> None:
        """Record one finalized candidate turn transcript."""
        self._queue.put_nowait(transcript)

    async def next_turn(self) -> ListenResult:
        """Await the next finalized candidate turn."""
        transcript = await self._queue.get()
        return ListenResult(transcript=transcript, end_of_turn=True)


class LiveKitVoiceAgent(VoiceAgent):  # pragma: no cover — live AgentSession wiring
    """Drives a live `AgentSession`: speaks verbatim text, hears the candidate.

    The session is started by the worker entrypoint (Task 1.6); this adapter
    subscribes to its transcript events and exposes the controller-facing
    `speak`/`listen`/`interrupt`/`set_mode` surface.
    """

    def __init__(self, session: Any) -> None:
        self._session = session
        self._inbox = _TranscriptInbox()
        self._mode: VoiceMode = "scripted"
        # Subscribe to final candidate transcripts. Confirm the event name and
        # payload fields against the Task 1.1 findings note.
        self._session.on("user_input_transcribed", self._on_transcript)

    def _on_transcript(self, event: Any) -> None:
        if getattr(event, "is_final", False) and event.transcript.strip():
            self._inbox.push(event.transcript)

    async def speak(self, text: str, mode: VoiceMode) -> None:
        self._mode = mode
        handle = self._session.say(text)
        # Await playout completion so the controller does not overlap turns.
        await handle  # or: await handle.wait_for_playout() — per Task 1.1 note

    async def listen(self) -> ListenResult:
        return await self._inbox.next_turn()

    async def interrupt(self) -> None:
        await self._session.interrupt()

    def set_mode(self, mode: VoiceMode) -> None:
        self._mode = mode
```

- [ ] **Step 4: Run the test to verify it passes**
Run: `cd agent && uv run pytest tests/test_livekit_agent.py`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/voice/livekit_agent.py agent/tests/test_livekit_agent.py && git commit -m "Add LiveKitVoiceAgent adapter over AgentSession"
```

---

### Task 1.5: Assessment persistence

When the interview ends, the rolled-up `Assessment` must be written to the `assessments` table and `sessions.status` updated. The SQL builder is pure and unit-tested; the DB call is `# pragma: no cover`.

**Files:**
- Modify: `agent/pyproject.toml`
- Create: `agent/src/agent/worker/persistence.py`
- Test: `agent/tests/test_persistence.py`

- [ ] **Step 1: Add the asyncpg dependency**
In `agent/pyproject.toml` `[project].dependencies`, add:
```
    "asyncpg>=0.30",
```
Run: `cd agent && uv sync --extra dev` — expect exit 0.

- [ ] **Step 2: Write the failing test for the SQL builder**
`agent/tests/test_persistence.py`:
```python
import json

from agent.domain.types import Assessment, CategoryScore
from agent.worker.persistence import build_assessment_insert


def _assessment() -> Assessment:
    return Assessment(
        session_id="sess1",
        script_version="pilot-v1",
        category_scores=[
            CategoryScore(
                category="problem_solving", score=4, confidence=0.9,
                evidence_quotes=["q"], rationale="r", low_confidence=False,
            )
        ],
        meets_bare_minimum=True,
        integrity_flags=[],
    )


def test_build_assessment_insert_targets_assessments_table() -> None:
    stmt = build_assessment_insert(_assessment())
    assert "INSERT INTO assessments" in stmt.sql
    assert stmt.params[0] == "sess1"
    assert stmt.params[1] == "pilot-v1"
    # category_scores serialized as JSON text for the JSONB column
    decoded = json.loads(stmt.params[2])
    assert decoded[0]["category"] == "problem_solving"
    assert decoded[0]["score"] == 4
    assert stmt.params[3] is True  # meets_bare_minimum
    assert json.loads(stmt.params[4]) == []  # integrity_flags
```

- [ ] **Step 3: Run the test to verify it fails**
Run: `cd agent && uv run pytest tests/test_persistence.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'agent.worker.persistence'`.

- [ ] **Step 4: Implement `persistence.py`**
```python
"""Persist the finished Assessment to PostgreSQL."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from agent.domain.types import Assessment


@dataclass(frozen=True)
class SqlStatement:
    """A parameterized SQL statement."""

    sql: str
    params: list[Any]


def build_assessment_insert(assessment: Assessment) -> SqlStatement:
    """Build the parameterized INSERT for the `assessments` table."""
    category_scores = json.dumps(
        [cs.model_dump() for cs in assessment.category_scores]
    )
    return SqlStatement(
        sql=(
            "INSERT INTO assessments "
            "(session_id, script_version, category_scores, "
            "meets_bare_minimum, integrity_flags) "
            "VALUES ($1, $2, $3::jsonb, $4, $5::jsonb)"
        ),
        params=[
            assessment.session_id,
            assessment.script_version,
            category_scores,
            assessment.meets_bare_minimum,
            json.dumps(assessment.integrity_flags),
        ],
    )


async def persist_assessment(  # pragma: no cover — live DB wiring
    database_url: str, assessment: Assessment
) -> None:
    """Write the Assessment and mark the session review-ready, atomically."""
    import asyncpg

    insert = build_assessment_insert(assessment)
    conn = await asyncpg.connect(database_url)
    try:
        async with conn.transaction():
            await conn.execute(insert.sql, *insert.params)
            await conn.execute(
                "UPDATE sessions SET status = 'review_ready', updated_at = now() "
                "WHERE session_id = $1",
                assessment.session_id,
            )
    finally:
        await conn.close()


async def mark_session_incomplete(  # pragma: no cover — live DB wiring
    database_url: str, session_id: str
) -> None:
    """Mark a session incomplete after a failed or abandoned interview."""
    import asyncpg

    conn = await asyncpg.connect(database_url)
    try:
        await conn.execute(
            "UPDATE sessions SET status = 'incomplete', updated_at = now() "
            "WHERE session_id = $1",
            session_id,
        )
    finally:
        await conn.close()
```

- [ ] **Step 5: Run the test to verify it passes**
Run: `cd agent && uv run pytest tests/test_persistence.py`
Expected: PASS (1 passed).

- [ ] **Step 6: Commit**
```bash
git add agent/pyproject.toml agent/uv.lock agent/src/agent/worker/persistence.py agent/tests/test_persistence.py && git commit -m "Add Assessment persistence (assessments table + session status)"
```

---

### Task 1.6: Wire the entrypoint — start the session, run the interview, persist

**Files:**
- Modify: `agent/src/agent/worker/entrypoint.py`

- [ ] **Step 1: Rewrite `entrypoint` and `_default_run_interview`**
Replace the `entrypoint` body and `_default_run_interview` so the worker, on a job: parses the context, connects, starts the `AgentSession`, builds the `LiveKitVoiceAgent` + `InterviewRunner`, runs the interview, and persists the result. `# pragma: no cover` — live wiring. Intended shape (verify `AgentSession.start` / `connect` against the Task 1.1 note):
```python
async def entrypoint(ctx: Any) -> None:  # pragma: no cover — live worker wiring
    """LiveKit Agents entrypoint: one worker process runs one interview."""
    import os
    import time
    from pathlib import Path

    import anthropic

    from agent.controller.event_log import EventLog
    from agent.controller.interview import InterviewRunner
    from agent.rubric_loader import load_rubric
    from agent.scoring.probe import ProbeGenerator
    from agent.scoring.scorer import Scorer
    from agent.voice.livekit_agent import LiveKitVoiceAgent
    from agent.voice.session import build_agent_session
    from agent.worker.persistence import mark_session_incomplete, persist_assessment

    interview = build_session_context(ctx)
    database_url = os.environ["DATABASE_URL"]
    try:
        await ctx.connect()
        session = build_agent_session(
            deepgram_api_key=os.environ["DEEPGRAM_API_KEY"],
            cartesia_api_key=os.environ["CARTESIA_API_KEY"],
        )
        # Start the AgentSession on the room. Confirm the start() signature
        # and whether an Agent instance is required against the Task 1.1 note.
        await session.start(room=ctx.room)

        repo_root = Path(__file__).parents[4]
        rubric = load_rubric(repo_root / "rubric" / f"{interview.script_version}.yaml")
        anthropic_client = anthropic.Anthropic()
        runner = InterviewRunner(
            rubric=rubric,
            voice=LiveKitVoiceAgent(session),
            scorer=Scorer(client=anthropic_client, rubric=rubric),
            probe_generator=ProbeGenerator(client=anthropic_client, rubric=rubric),
            event_log=EventLog(
                session_id=interview.session_id,
                path=repo_root / "artifacts" / interview.session_id / "agent_events.jsonl",
            ),
            clock_now=time.monotonic,
        )
        assessment = await runner.run(session_id=interview.session_id)
        await persist_assessment(database_url, assessment)
    except Exception:
        await mark_session_incomplete(database_url, interview.session_id)
        raise
    finally:
        await session.aclose() if "session" in dir() else None
```
Remove the now-obsolete `_default_run_interview` and `_build_voice_agent` (they referenced the deleted skeleton). Keep `InterviewJobContext`, `build_session_context`, and `RunInterview` only if still referenced — otherwise delete `RunInterview`.

- [ ] **Step 2: Verify the module imports and the suite is green**
Run: `cd agent && uv run python -c "import agent.worker.entrypoint" && uv run pytest`
Expected: import OK; all tests pass (the entrypoint body is `# pragma: no cover`, exercised only live).

- [ ] **Step 3: Commit**
```bash
git add agent/src/agent/worker/entrypoint.py && git commit -m "Wire worker entrypoint: AgentSession start, interview run, persistence"
```

---

### Task 1.7: Remove the skeleton voice modules

`cascaded.py`, `stt.py`, `tts.py`, `turn_detector.py` are skeleton against an invented API and are now superseded by `session.py` + `livekit_agent.py`. The `VoiceAgent` ABC in `interface.py` stays.

**Files:**
- Delete: `agent/src/agent/voice/cascaded.py`, `agent/src/agent/voice/stt.py`, `agent/src/agent/voice/tts.py`, `agent/src/agent/voice/turn_detector.py`
- Delete: `agent/tests/test_voice_interface.py` cascaded cases, `agent/tests/test_stt.py`, `agent/tests/test_tts.py`, `agent/tests/test_turn_detector.py`

- [ ] **Step 1: Delete the skeleton modules and their tests**
```bash
cd agent && rm src/agent/voice/cascaded.py src/agent/voice/stt.py src/agent/voice/tts.py src/agent/voice/turn_detector.py tests/test_stt.py tests/test_tts.py tests/test_turn_detector.py
```

- [ ] **Step 2: Trim `test_voice_interface.py`**
`agent/tests/test_voice_interface.py` tests both the `VoiceAgent` ABC (keep) and `CascadedVoiceAgent` (delete). Rewrite it to keep only the ABC/`VoiceMode`/`ListenResult` checks that do not import `cascaded`:
```python
from agent.voice.interface import ListenResult, VoiceAgent, VoiceMode


def test_voice_mode_values() -> None:
    assert set(VoiceMode.__args__) == {"scripted", "clarifying", "repair", "closing"}


def test_listen_result_holds_transcript_and_turn_flag() -> None:
    r = ListenResult(transcript="hello", end_of_turn=True)
    assert r.transcript == "hello"
    assert r.end_of_turn is True


def test_voice_agent_is_abstract() -> None:
    import pytest

    with pytest.raises(TypeError):
        VoiceAgent()  # type: ignore[abstract]
```

- [ ] **Step 3: Verify the suite is green**
Run: `cd agent && uv run pytest && uv run ruff check .`
Expected: all tests pass (the deleted tests are gone; nothing imports the removed modules); ruff clean. If anything still imports `cascaded`/`stt`/`tts`/`turn_detector`, fix the import.

- [ ] **Step 4: Commit**
```bash
git add -A agent/src/agent/voice agent/tests && git commit -m "Remove skeleton voice modules superseded by the real AgentSession wiring"
```

---

## Phase 2: Backend — candidate join token

### Task 2.1: Candidate join-token builder

**Files:**
- Create: `backend/src/livekit/token.ts`
- Test: `backend/test/token.test.ts`

- [ ] **Step 1: Write the failing test**
`backend/test/token.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { buildCandidateToken } from "../src/livekit/token.js";

const CFG = { host: "wss://x", apiKey: "devkey", apiSecret: "devsecret-at-least-32-chars-long!!" };

describe("buildCandidateToken", () => {
  it("produces a JWT (three dot-separated segments)", async () => {
    const jwt = await buildCandidateToken(CFG, "interview-sess1", "candidate-sess1");
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("encodes the room name in the token payload", async () => {
    const jwt = await buildCandidateToken(CFG, "interview-sess1", "candidate-sess1");
    const payload = JSON.parse(
      Buffer.from(jwt.split(".")[1] as string, "base64url").toString("utf-8"),
    );
    expect(JSON.stringify(payload)).toContain("interview-sess1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**
Run: `cd backend && pnpm test`
Expected: FAIL — cannot resolve `../src/livekit/token.js`.

- [ ] **Step 3: Implement `token.ts`**
```typescript
import { AccessToken } from "livekit-server-sdk";
import type { LiveKitConfig } from "./provision.js";

// A candidate join token: room-scoped, publish + subscribe, 1-hour TTL.
export async function buildCandidateToken(
  config: LiveKitConfig,
  roomName: string,
  identity: string,
): Promise<string> {
  const at = new AccessToken(config.apiKey, config.apiSecret, {
    identity,
    ttl: "1h",
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });
  return at.toJwt();
}
```
Note: `AccessToken.toJwt()` is async in current `livekit-server-sdk` — verify and keep the `await` at call sites.

- [ ] **Step 4: Run the test to verify it passes**
Run: `cd backend && pnpm test`
Expected: PASS (token tests pass).

- [ ] **Step 5: Commit**
```bash
git add backend/src/livekit/token.ts backend/test/token.test.ts && git commit -m "Add candidate LiveKit join-token builder"
```

---

### Task 2.2: Return the join token from session creation

**Files:**
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Extend `createSession` to return the candidate join details**
In `backend/src/server.ts`, change `createSession` so it also builds and returns a candidate token and the ws URL:
```typescript
import { buildCandidateToken } from "./livekit/token.js";

export async function createSession(
  liveKitConfig: LiveKitConfig,
  input: CreateSessionRequest,
): Promise<{ sessionId: string; room: string; token: string; wsUrl: string }> {
  const record = buildSessionRecord({ ...input, sessionId: randomUUID() });
  const insert = createSessionInsert(record);
  await getPool().query(insert.sql, [...insert.params]);
  const { room } = await provisionRoom(
    liveKitConfig,
    record.sessionId,
    buildWorkerDispatchMetadata(record),
  );
  const token = await buildCandidateToken(
    liveKitConfig,
    room,
    `candidate-${record.sessionId}`,
  );
  return { sessionId: record.sessionId, room, token, wsUrl: liveKitConfig.host };
}
```
The integration route returns whatever `createSession` returns, so the `room` app receives `{ sessionId, room, token, wsUrl }`.

- [ ] **Step 2: Verify the build and the suite**
Run: `cd backend && pnpm build && pnpm test`
Expected: build exit 0; all backend tests pass (the existing `buildServer` 400-path test is unaffected — it never reaches `createSession`).

- [ ] **Step 3: Commit**
```bash
git add backend/src/server.ts && git commit -m "Return candidate join token + ws URL from session creation"
```

---

## Phase 3: Room app — real LiveKit connection

### Task 3.1: Room self-serve flow logic

The room app, on Start, calls the backend to create a session and receives `{ room, token, wsUrl }`. This task adds the pure flow logic (testable); the network call and LiveKit connection are Tasks 3.2–3.3.

**Files:**
- Create: `room/src/session.ts`
- Test: `room/test/session.test.ts`

- [ ] **Step 1: Write the failing test**
`room/test/session.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { parseSessionResponse, type JoinDetails } from "../src/session.js";

describe("parseSessionResponse", () => {
  it("extracts the join details from a backend create-session response", () => {
    const join: JoinDetails = parseSessionResponse({
      sessionId: "sess1",
      room: "interview-sess1",
      token: "a.b.c",
      wsUrl: "wss://example.livekit.cloud",
    });
    expect(join.room).toBe("interview-sess1");
    expect(join.token).toBe("a.b.c");
    expect(join.wsUrl).toBe("wss://example.livekit.cloud");
  });

  it("throws when the response is missing the token", () => {
    expect(() =>
      parseSessionResponse({ sessionId: "s", room: "r", wsUrl: "w" }),
    ).toThrow(/token/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**
Run: `cd room && pnpm test`
Expected: FAIL — cannot resolve `../src/session.js`.

- [ ] **Step 3: Implement `session.ts`**
```typescript
export interface JoinDetails {
  readonly sessionId: string;
  readonly room: string;
  readonly token: string;
  readonly wsUrl: string;
}

// Validates and narrows a backend create-session response into JoinDetails.
export function parseSessionResponse(body: unknown): JoinDetails {
  const b = body as Record<string, unknown>;
  for (const field of ["sessionId", "room", "token", "wsUrl"] as const) {
    if (typeof b[field] !== "string" || !b[field]) {
      throw new Error(`create-session response missing field: ${field}`);
    }
  }
  return {
    sessionId: b.sessionId as string,
    room: b.room as string,
    token: b.token as string,
    wsUrl: b.wsUrl as string,
  };
}

// Calls the backend to create a session and returns the join details.
export async function createSession(
  backendUrl: string,
  input: {
    orgId: string;
    candidateEmail: string;
    scriptVersion: string;
    scheduledAt: string;
  },
): Promise<JoinDetails> {
  const res = await fetch(`${backendUrl}/integration/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`create-session failed: ${res.status}`);
  }
  return parseSessionResponse(await res.json());
}
```

- [ ] **Step 4: Run the test to verify it passes**
Run: `cd room && pnpm test`
Expected: PASS (session tests pass).

- [ ] **Step 5: Commit**
```bash
git add room/src/session.ts room/test/session.test.ts && git commit -m "Add room self-serve session creation logic"
```

---

### Task 3.2: LiveKit connection module

**Files:**
- Create: `room/src/livekit.ts`

- [ ] **Step 1: Implement the connection module**
`# pragma`-equivalent live wiring — no unit test; verified by the live interview. Verify the `livekit-client` API against https://docs.livekit.io/home/client/ and the installed `livekit-client` (`room/node_modules/livekit-client`):
```typescript
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";

export interface RoomConnection {
  readonly room: Room;
  disconnect: () => Promise<void>;
}

// Connects to the interview room: publishes mic + camera, attaches the
// agent's audio so the candidate hears it. Returns the live Room handle.
export async function connectToInterview(
  wsUrl: string,
  token: string,
  onAgentAudio: (el: HTMLAudioElement) => void,
  onSelfVideo: (track: MediaStreamTrack) => void,
): Promise<RoomConnection> {
  const room = new Room({ adaptiveStream: true, dynacast: true });

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach() as HTMLAudioElement;
      onAgentAudio(el);
    }
  });

  await room.connect(wsUrl, token);
  await room.localParticipant.setMicrophoneEnabled(true);
  await room.localParticipant.setCameraEnabled(true);

  const camPub = room.localParticipant
    .getTrackPublications()
    .find((p) => p.kind === Track.Kind.Video);
  if (camPub?.track) {
    onSelfVideo(camPub.track.mediaStreamTrack);
  }

  return { room, disconnect: () => room.disconnect() };
}
```

- [ ] **Step 2: Verify the room build still compiles**
Run: `cd room && pnpm build`
Expected: exit 0 (the module is imported by Task 3.3; on its own it must type-check).

- [ ] **Step 3: Commit**
```bash
git add room/src/livekit.ts && git commit -m "Add room LiveKit connection module (mic + camera + agent audio)"
```

---

### Task 3.3: Rewrite InCall and wire the self-serve flow

**Files:**
- Modify: `room/src/pages/InCall.tsx`
- Modify: `room/src/App.tsx`

- [ ] **Step 1: Rewrite `InCall.tsx`**
The in-call page receives the `JoinDetails`, connects on mount via `connectToInterview`, renders the candidate self-view and the agent audio element, and disconnects on unmount / End. Live wiring — verified by the live test:
```typescript
import { useEffect, useRef, useState } from "react";
import { connectToInterview, type RoomConnection } from "../livekit.js";
import type { JoinDetails } from "../session.js";

interface InCallProps {
  readonly join: JoinDetails;
  readonly onComplete: () => void;
}

export function InCall({ join, onComplete }: InCallProps): JSX.Element {
  const selfVideoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "ended">("connecting");
  const connRef = useRef<RoomConnection | null>(null);

  useEffect(() => {
    let cancelled = false;
    connectToInterview(
      join.wsUrl,
      join.token,
      (audioEl) => document.body.appendChild(audioEl),
      (videoTrack) => {
        if (selfVideoRef.current) {
          selfVideoRef.current.srcObject = new MediaStream([videoTrack]);
        }
      },
    )
      .then((conn) => {
        if (cancelled) {
          void conn.disconnect();
          return;
        }
        connRef.current = conn;
        setStatus("live");
      })
      .catch(() => setStatus("ended"));
    return () => {
      cancelled = true;
      void connRef.current?.disconnect();
    };
  }, [join]);

  const end = (): void => {
    void connRef.current?.disconnect();
    setStatus("ended");
    onComplete();
  };

  return (
    <main>
      <div aria-label="status">{status}</div>
      <video aria-label="self-view" ref={selfVideoRef} autoPlay muted playsInline />
      <button onClick={end}>End interview</button>
    </main>
  );
}
```

- [ ] **Step 2: Wire `App.tsx` to self-serve the session**
On reaching the in-call step, `App.tsx` calls `createSession` and passes the resulting `JoinDetails` to `InCall`. Drive it from the existing `room/src/flow.ts` step machine; add the backend URL from `import.meta.env.VITE_BACKEND_URL` (default `http://localhost:8080`). Keep the Landing/Consent/Preflight steps as the click-through gate before `createSession` runs. Implement the wiring so `InCall` is only rendered once `JoinDetails` exists.

- [ ] **Step 3: Verify build and tests**
Run: `cd room && pnpm build && pnpm test`
Expected: build exit 0; flow + session tests pass.

- [ ] **Step 4: Commit**
```bash
git add room/src/pages/InCall.tsx room/src/App.tsx && git commit -m "Rewrite InCall for real LiveKit; wire room self-serve flow"
```

---

## Phase 4: Local end-to-end test

### Task 4.1: Update the runbook for live test interviews

**Files:**
- Modify: `docs/RUNBOOK.md`

- [ ] **Step 1: Replace the "Run locally" and "Known gaps" sections**
Update §6 so the worker section notes the real voice loop, and add a "Run a test interview" subsection: start backend (`node --env-file=../.env dist/server.js`), worker (`uv run --env-file ../.env python -m agent.worker dev`), room app (`pnpm dev`); set `VITE_BACKEND_URL` if not default; open the room app, click Start, complete the interview by voice; confirm an `assessments` row appears (`select * from assessments;` in Supabase). Remove the "video frame-pump" and "agent worker launcher" gap lines from §9 (the launcher exists; video is intentionally out of scope for this integration). Note first-run model downloads: `uv run python -m agent.worker download-files`.

- [ ] **Step 2: Commit**
```bash
git add docs/RUNBOOK.md && git commit -m "Update runbook for live local test interviews"
```

---

### Task 4.2: Full verification

- [ ] **Step 1: Run every offline suite**
```bash
cd agent && uv run pytest && uv run ruff check .
cd .. && pnpm -r test
cd backend && pnpm build && cd ../room && pnpm build && cd ../review && pnpm build
```
Expected: all Python tests pass, ruff clean, all TS package tests pass, all three TS builds exit 0. Fix any regression before continuing.

- [ ] **Step 2: Live acceptance test (manual)**
Per the updated runbook: start backend + worker + room app with a populated `.env`, open the room app, and complete one interview by voice. Confirm: the agent speaks the four pilot questions, listens and probes, and an `assessments` row is written with four category scores and `sessions.status = 'review_ready'`. This is the acceptance test the automated suites cannot cover — record the outcome (and any live-API fixes needed) in `docs/superpowers/notes/livekit-agentsession-api.md`.

- [ ] **Step 2 note:** If the live test surfaces an API mismatch (a `say()`/`start()`/event signature different from Task 1.1's findings), fix it in the relevant Phase 1/3 file, re-run Step 1, and commit with a clear message. The live test may take two or three fix-and-retry cycles — that is expected for vendor wiring.

- [ ] **Step 3: Final commit**
```bash
git add -A && git commit -m "Voice integration: verified local test interview" || echo "nothing to commit"
```

---

## Self-review

**Spec coverage:** Real `AgentSession` voice loop → Tasks 1.1, 1.2, 1.4, 1.6. Real `JobContext` → 1.3. Backend join token → 2.1, 2.2. Room `livekit-client` connection (mic + camera, agent audio) → 3.1, 3.2, 3.3. Assessment persistence + `sessions.status` → 1.5, 1.6. Skeleton retired → 1.7. Error handling (`incomplete` on failure) → 1.6 (`mark_session_incomplete`). Runbook + acceptance → 4.1, 4.2. Out-of-scope items (Egress, S3, VLM, review app, calibration) — correctly untouched.

**Placeholders:** None. Task 1.1 is an explicit spike with a concrete deliverable (the findings note), not a vague placeholder; the live-wiring tasks carry real code shaped to the intended API with explicit "verify against the installed package / Task 1.1 note" instructions — appropriate and necessary for unverifiable vendor wiring.

**Type consistency:** `InterviewJobContext`, `VoiceAgent`/`ListenResult`/`VoiceMode`, `Assessment`/`CategoryScore`, `LiveKitConfig`, `JoinDetails`, `SqlStatement` are used consistently across tasks. `InterviewRunner`'s constructor (`rubric`, `voice`, `scorer`, `probe_generator`, `event_log`, `clock_now`, optional `perception`) is unchanged — `LiveKitVoiceAgent` satisfies its `voice` slot.

**Manual-gate:** No task performs a destructive shared-data operation. Persistence writes one `assessments` row per interview to the developer's own dev database during the manual acceptance test — not a bulk write. The DB migration was already applied. No `[manual-gate]` task required.

**Verification reality:** Phase 1 offline pieces (`build_session_context`, `_TranscriptInbox`, `build_assessment_insert`), Phase 2 (`buildCandidateToken`), and Phase 3 (`parseSessionResponse`) are TDD'd with real assertions. The live A/V wiring is `# pragma: no cover` and gated by the Task 4.2 manual acceptance test — this is inherent to a vendor-integration seam and is called out up front.

**Total:** 16 tasks across 4 phases — Phase 1: 7, Phase 2: 2, Phase 3: 3, Phase 4: 2 (+ Task 1.1 spike).
