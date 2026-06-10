# Voice Agent Bugfixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three live voice-interviewer bugs — answers not picked up / repeated "please speak" prompts, slow & robotic voice, and the agent speaking before the candidate's room is ready — by adding a readiness handshake, full-answer transcript coalescing, VAD hardening, tuned STT/TTS config, and a regression-guarding session builder.

**Architecture:** The worker runs a LiveKit `AgentSession` (cascaded Deepgram STT + Cartesia TTS, no LLM) wrapped by `LiveKitSessionVoiceAgent`, driven by the `InterviewRunner` controller. Root cause analysis (`docs/superpowers/specs/2026-06-09-voice-agent-bugfixes-design.md`) showed the bugs are an input/readiness race + `listen()` returning on the first STT segment + a São Paulo region — **not** missing VAD (the pipeline transcribes without it). We fix the real causes and add VAD as hardening behind a single tested session builder.

**Tech Stack:** Python 3.12 / `uv` / `pytest` (`asyncio_mode=auto`) for `agent/`; TypeScript / `vitest` / `livekit-client ^2.6.0` for `room/`; `livekit-agents 1.5.11` + Deepgram/Cartesia/Silero plugins.

---

## File Structure

**agent/ (Python)**
- `src/agent/voice/livekit_session.py` — MODIFY: transcript coalescing in `listen()`, user-speaking state, `_await_candidate_ready()`, build session via `build_agent_session`, accept `vad`.
- `src/agent/voice/session.py` — MODIFY: replace dead `build_agent_session(deepgram_api_key, cartesia_api_key)` with canonical `build_agent_session(*, stt, tts, vad)`.
- `src/agent/voice/interface.py` — MODIFY: add concrete default `user_is_speaking()` to `VoiceAgent`.
- `src/agent/voice/stt.py` — MODIFY: explicit tuned Deepgram config.
- `src/agent/voice/tts.py` — MODIFY: keep `sonic-3`, add naturalness/pacing kwargs.
- `src/agent/voice/livekit_agent.py` — DELETE (dead spike with debug prints).
- `src/agent/controller/interview.py` — MODIFY: VAD-aware repair, humane default timeout.
- `src/agent/worker/entrypoint.py` — MODIFY: `prewarm()` fn, pass `vad` into `start()`.
- `src/agent/worker/__main__.py` — MODIFY: wire `prewarm_fnc` into `WorkerOptions`.
- `tests/test_livekit_session_voice.py`, `tests/test_interview_runner.py`, `tests/test_session_builder.py` (new), `tests/test_stt.py`, `tests/test_tts.py`, `tests/test_worker_prewarm.py` (new) — tests.
- `tests/test_livekit_agent.py` — DELETE.

**room/ (TypeScript)**
- `src/readiness.ts` (new) — pure readiness-gate helper.
- `src/livekit.ts` — MODIFY: autoplay handling, `startAudio`, signal `ready` attribute, pre-connect mic.
- `src/pages/InCall.tsx` — MODIFY: "Tap to enable audio" affordance.
- `src/readiness.test.ts` (new) — helper test.

**docs/**
- `docs/KNOWN_ISSUES.md` — MODIFY: update #2/#3 status.

---

## Phase 1 — Full-answer capture (#2: truncation + re-prompts)

### Task 1: Coalesce STT segments in `listen()`

**Files:**
- Modify: `agent/src/agent/voice/livekit_session.py`
- Test: `agent/tests/test_livekit_session_voice.py`

- [ ] **Step 1: Write the failing tests**

Add to `agent/tests/test_livekit_session_voice.py`:

```python
async def test_listen_coalesces_multiple_finals_into_one_turn() -> None:
    session = FakeSession()
    voice = LiveKitSessionVoiceAgent(session, coalesce_window_seconds=0.05)

    listen_task = asyncio.create_task(voice.listen())
    push = session.handlers["user_input_transcribed"]
    push(SimpleNamespace(transcript="I rewrote the scheduler", is_final=True))
    await asyncio.sleep(0.01)
    push(SimpleNamespace(transcript="using backpressure.", is_final=True))
    result = await listen_task

    assert result.transcript == "I rewrote the scheduler using backpressure."
    assert result.end_of_turn is True


async def test_listen_returns_after_pause_window() -> None:
    session = FakeSession()
    voice = LiveKitSessionVoiceAgent(session, coalesce_window_seconds=0.05)

    listen_task = asyncio.create_task(voice.listen())
    session.handlers["user_input_transcribed"](
        SimpleNamespace(transcript="Just one clause.", is_final=True)
    )
    result = await listen_task

    assert result.transcript == "Just one clause."
```

Also update the two existing tests that construct the agent for listening so they use a tiny window (they currently assume an instant return):

```python
# in test_livekit_session_listen_returns_next_final_transcript
voice = LiveKitSessionVoiceAgent(session, coalesce_window_seconds=0.01)
# in test_livekit_session_listen_survives_participant_reconnect
voice = LiveKitSessionVoiceAgent(
    session, participant_reconnect_grace_seconds=1.0, coalesce_window_seconds=0.01
)
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd agent && uv run pytest tests/test_livekit_session_voice.py -v`
Expected: FAIL — `LiveKitSessionVoiceAgent.__init__() got an unexpected keyword argument 'coalesce_window_seconds'`.

- [ ] **Step 3: Implement coalescing**

In `livekit_session.py`, add a module constant near the other defaults:

```python
_DEFAULT_COALESCE_WINDOW_SECONDS = 0.8
```

Add the constructor parameter (extend the existing signature) and store it:

```python
    def __init__(
        self,
        session: Any,
        *,
        participant_reconnect_grace_seconds: float = _DEFAULT_RECONNECT_GRACE_SECONDS,
        coalesce_window_seconds: float = _DEFAULT_COALESCE_WINDOW_SECONDS,
    ) -> None:
        ...
        self._coalesce_window_seconds = coalesce_window_seconds
```

Refactor `listen()`: keep the existing race-aware logic to get the **first** final, then drain additional finals until a quiet `coalesce_window_seconds`. Rename the current body to `_next_final_transcript()` and add the coalescing wrapper:

```python
    async def listen(self) -> ListenResult:
        """Wait for a full candidate turn: the first final transcript plus any
        further finals that arrive within `coalesce_window_seconds` (so a
        multi-clause answer isn't truncated to its first segment)."""
        first = await self._next_final_transcript()
        parts = [first]
        while True:
            try:
                nxt = await asyncio.wait_for(
                    self._transcripts.get(), timeout=self._coalesce_window_seconds
                )
            except TimeoutError:
                break
            parts.append(nxt)
        transcript = " ".join(p.strip() for p in parts if p.strip())
        logger.info(
            "received coalesced candidate turn",
            extra={"participant": self._participant_identity, "segments": len(parts)},
        )
        return ListenResult(transcript=transcript, end_of_turn=True)

    async def _next_final_transcript(self) -> str:
        logger.info(
            "waiting for final candidate transcript",
            extra={"participant": self._participant_identity},
        )
        while True:
            if self._closed:
                raise RuntimeError("LiveKit agent session closed while waiting for transcript")
            if not self._participant_connected:
                await self._wait_for_participant_reconnect()

            transcript_task = asyncio.create_task(self._transcripts.get())
            state_task = asyncio.create_task(self._participant_state_changed.wait())
            pending: set[asyncio.Task[Any]] = {transcript_task, state_task}
            try:
                done, pending = await asyncio.wait(
                    pending, return_when=asyncio.FIRST_COMPLETED
                )
            finally:
                for task in pending:
                    task.cancel()

            if transcript_task in done:
                return transcript_task.result()

            self._participant_state_changed.clear()
```

(Delete the old `listen()` body that returned `ListenResult` on the first final.)

- [ ] **Step 4: Run tests, verify pass**

Run: `cd agent && uv run pytest tests/test_livekit_session_voice.py -v`
Expected: PASS (all, including the two updated tests).

- [ ] **Step 5: Read the coalesce window from env in `start()`**

In `start()` (classmethod), pass the env-tunable window when constructing `voice`:

```python
        voice = cls(
            session,
            participant_reconnect_grace_seconds=float(
                os.environ.get(
                    "PUDDLE_PARTICIPANT_RECONNECT_GRACE_SECONDS",
                    _DEFAULT_RECONNECT_GRACE_SECONDS,
                )
            ),
            coalesce_window_seconds=float(
                os.environ.get(
                    "PUDDLE_TRANSCRIPT_COALESCE_SECONDS",
                    _DEFAULT_COALESCE_WINDOW_SECONDS,
                )
            ),
        )
```

- [ ] **Step 6: Commit**

```bash
git add agent/src/agent/voice/livekit_session.py agent/tests/test_livekit_session_voice.py
git commit -m "fix(voice): coalesce STT segments so full answers aren't truncated"
```

---

### Task 2: Track candidate-speaking state

**Files:**
- Modify: `agent/src/agent/voice/livekit_session.py`, `agent/src/agent/voice/interface.py`
- Test: `agent/tests/test_livekit_session_voice.py`

- [ ] **Step 1: Write the failing test**

```python
async def test_user_is_speaking_tracks_user_state_events() -> None:
    session = FakeSession()
    voice = LiveKitSessionVoiceAgent(session)
    assert voice.user_is_speaking() is False

    session.handlers["user_state_changed"](
        SimpleNamespace(old_state="listening", new_state="speaking")
    )
    assert voice.user_is_speaking() is True

    session.handlers["user_state_changed"](
        SimpleNamespace(old_state="speaking", new_state="listening")
    )
    assert voice.user_is_speaking() is False
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd agent && uv run pytest tests/test_livekit_session_voice.py::test_user_is_speaking_tracks_user_state_events -v`
Expected: FAIL — `AttributeError: 'LiveKitSessionVoiceAgent' object has no attribute 'user_is_speaking'`.

- [ ] **Step 3: Implement speaking state**

In `interface.py`, add a concrete (non-abstract) default to `VoiceAgent`:

```python
    def user_is_speaking(self) -> bool:
        """Whether the candidate is currently speaking (VAD-driven).

        Default False; cascaded adapters with a VAD override this so the
        controller can avoid nagging mid-answer."""
        return False
```

In `livekit_session.py` `__init__`, initialize state:

```python
        self._user_speaking = False
```

Update `_on_user_state_changed` to track it and add the accessor:

```python
    def _on_user_state_changed(self, event: Any) -> None:
        new_state = getattr(event, "new_state", None)
        self._user_speaking = new_state == "speaking"
        logger.info(
            "user state changed",
            extra={"old_state": getattr(event, "old_state", None), "new_state": new_state},
        )

    def user_is_speaking(self) -> bool:
        """True while the candidate is actively speaking (VAD user state)."""
        return self._user_speaking
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd agent && uv run pytest tests/test_livekit_session_voice.py tests/test_voice_interface.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/voice/livekit_session.py agent/src/agent/voice/interface.py agent/tests/test_livekit_session_voice.py
git commit -m "feat(voice): expose candidate-speaking state from VAD user events"
```

---

### Task 3: VAD-aware repair + humane listen timeout (controller)

**Files:**
- Modify: `agent/src/agent/controller/interview.py`
- Test: `agent/tests/test_interview_runner.py`

- [ ] **Step 1: Write the failing test**

Add to `agent/tests/test_interview_runner.py`:

```python
async def test_runner_does_not_nag_while_candidate_is_speaking(
    tmp_path: Path,
    monkeypatch,
) -> None:  # noqa: ANN001
    monkeypatch.setattr(interview_module, "_LISTEN_INITIAL_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(interview_module, "_LISTEN_REPAIR_TIMEOUT_SECONDS", 0.01)
    rubric = RUBRIC.model_copy(
        update={"questions": [RUBRIC.questions[0]], "opener": None}
    )
    voice = MagicMock()
    voice.speak = AsyncMock()
    voice.user_is_speaking = MagicMock(return_value=True)  # candidate mid-answer
    listen_calls = {"count": 0}

    async def listen() -> ListenResult:
        listen_calls["count"] += 1
        if listen_calls["count"] == 1:
            await asyncio.sleep(60)  # first wait times out
        return ListenResult(transcript="A full answer.", end_of_turn=True)

    voice.listen = listen
    scorer = MagicMock()
    scorer.score.side_effect = lambda si: _confident(si.target_categories[0])
    event_log = EventLog(session_id="s-speaking", path=tmp_path / "events.jsonl")
    runner = InterviewRunner(
        rubric=rubric, voice=voice, scorer=scorer,
        probe_generator=MagicMock(), event_log=event_log,
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
    )

    await runner.run(session_id="s-speaking")

    # Because the candidate was speaking, NO audio-repair line was spoken.
    spoken = [c.args[0] for c in voice.speak.await_args_list]
    assert "I'm listening. Please answer out loud when you're ready." not in spoken
    assert "AUDIO_REPAIR" not in [e.reason_code for e in event_log.events()]
```

Update the `_simulated_voice()` helper and the existing silent test so the speaking probe returns a real bool:

```python
# in _simulated_voice(): add
    voice.user_is_speaking = MagicMock(return_value=False)
# in test_runner_prompts_after_silent_candidate_turn(): after `voice.speak = AsyncMock()` add
    voice.user_is_speaking = MagicMock(return_value=False)
```

- [ ] **Step 2: Run tests, verify the new one fails**

Run: `cd agent && uv run pytest tests/test_interview_runner.py -v`
Expected: `test_runner_does_not_nag_while_candidate_is_speaking` FAILS (repair line is spoken because the probe is ignored); existing tests still PASS.

- [ ] **Step 3: Implement VAD-aware repair + raise default timeout**

In `interview.py`, raise the initial default:

```python
_LISTEN_INITIAL_TIMEOUT_SECONDS = _positive_float_env(
    "PUDDLE_LISTEN_INITIAL_TIMEOUT_SECONDS",
    20.0,
)
```

Add a helper on `InterviewRunner`:

```python
    def _candidate_is_speaking(self) -> bool:
        probe = getattr(self._voice, "user_is_speaking", None)
        if not callable(probe):
            return False
        try:
            return bool(probe())
        except Exception:
            return False
```

In `_listen`, suppress the repair while the candidate speaks:

```python
            except TimeoutError:
                if self._candidate_is_speaking():
                    logger.info(
                        "listen timeout while candidate speaking; extending",
                        extra={"question_id": question_id},
                    )
                    timeout_seconds = _LISTEN_REPAIR_TIMEOUT_SECONDS
                    continue
                repair_text = _AUDIO_REPAIR_LINES[
                    min(repair_attempts, len(_AUDIO_REPAIR_LINES) - 1)
                ]
                repair_attempts += 1
                logger.info(
                    "candidate silence timeout; speaking audio repair",
                    extra={
                        "question_id": question_id,
                        "repair_attempts": repair_attempts,
                        "timeout_seconds": timeout_seconds,
                    },
                )
                await self._say(repair_text, "AUDIO_REPAIR", question_id)
                timeout_seconds = _LISTEN_REPAIR_TIMEOUT_SECONDS
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd agent && uv run pytest tests/test_interview_runner.py -v`
Expected: PASS (all, including the existing silent-candidate repair test, which keeps `user_is_speaking=False`).

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/controller/interview.py agent/tests/test_interview_runner.py
git commit -m "fix(controller): don't nag while candidate is speaking; humane listen timeout"
```

---

## Phase 2 — Readiness handshake, agent side (#3 + first-turn #2)

### Task 4: `_await_candidate_ready()` helper

**Files:**
- Modify: `agent/src/agent/voice/livekit_session.py`
- Test: `agent/tests/test_livekit_session_voice.py`

- [ ] **Step 1: Write the failing tests**

```python
async def test_await_candidate_ready_resolves_on_attr_and_track() -> None:
    session = FakeSession()
    room = FakeRoom()
    voice = LiveKitSessionVoiceAgent(session)
    voice._link_participant(room, "candidate-1")
    participant = SimpleNamespace(identity="candidate-1", attributes={})

    wait_task = asyncio.create_task(
        voice._await_candidate_ready(participant, timeout=1.0)
    )
    await asyncio.sleep(0)
    room.handlers["track_subscribed"](
        SimpleNamespace(kind="audio"), SimpleNamespace(), SimpleNamespace(identity="candidate-1")
    )
    room.handlers["participant_attributes_changed"](
        SimpleNamespace(identity="candidate-1", attributes={"ready": "true"})
    )
    await asyncio.wait_for(wait_task, timeout=1.0)  # returns without raising


async def test_await_candidate_ready_fails_open_on_timeout() -> None:
    session = FakeSession()
    room = FakeRoom()
    voice = LiveKitSessionVoiceAgent(session)
    voice._link_participant(room, "candidate-1")
    participant = SimpleNamespace(identity="candidate-1", attributes={})

    # No events fire; helper must return (not raise) after the timeout.
    await voice._await_candidate_ready(participant, timeout=0.05)
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd agent && uv run pytest tests/test_livekit_session_voice.py -k await_candidate_ready -v`
Expected: FAIL — `AttributeError: ... has no attribute '_await_candidate_ready'`.

- [ ] **Step 3: Implement the helper**

Add a module constant + helpers in `livekit_session.py`:

```python
_DEFAULT_CANDIDATE_READY_TIMEOUT_SECONDS = 10.0


def _is_audio_track(track: Any) -> bool:
    kind = getattr(track, "kind", None)
    return "audio" in str(kind).lower()


def _attribute_ready(attributes: Any) -> bool:
    if not attributes:
        return False
    try:
        return str(attributes.get("ready", "")).strip().lower() == "true"
    except AttributeError:
        return False
```

Add the method:

```python
    async def _await_candidate_ready(self, participant: Any, timeout: float) -> None:
        """Block until the candidate can both hear (autoplay unblocked, signalled
        via a `ready` participant attribute) and be heard (mic audio track
        subscribed). Bounded and fails open: on timeout we log and proceed so a
        flaky client never deadlocks the interview."""
        if self._room is None:
            return
        identity = participant.identity
        ready = asyncio.Event()
        state = {"attr": _attribute_ready(getattr(participant, "attributes", None)),
                 "track": False}

        def _maybe_done() -> None:
            if state["attr"] and state["track"]:
                ready.set()

        # Seed from any already-subscribed mic track.
        for pub in getattr(participant, "track_publications", {}).values() if hasattr(
            getattr(participant, "track_publications", None), "values"
        ) else []:
            if getattr(pub, "subscribed", False) and _is_audio_track(getattr(pub, "track", None)):
                state["track"] = True

        def on_attrs(changed: Any) -> None:
            if getattr(changed, "identity", None) != identity:
                return
            if _attribute_ready(getattr(changed, "attributes", None)):
                state["attr"] = True
                _maybe_done()

        def on_track(track: Any, publication: Any, p: Any) -> None:
            if getattr(p, "identity", None) != identity:
                return
            if _is_audio_track(track):
                state["track"] = True
                _maybe_done()

        _maybe_done()
        self._room.on("participant_attributes_changed", on_attrs)
        self._room.on("track_subscribed", on_track)
        try:
            await asyncio.wait_for(ready.wait(), timeout=timeout)
            logger.info("candidate ready", extra={"participant": identity})
        except TimeoutError:
            logger.warning(
                "candidate readiness wait timed out; proceeding",
                extra={"participant": identity, "ready_state": state},
            )
        finally:
            with contextlib.suppress(Exception):
                self._room.off("participant_attributes_changed", on_attrs)
            with contextlib.suppress(Exception):
                self._room.off("track_subscribed", on_track)
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd agent && uv run pytest tests/test_livekit_session_voice.py -k await_candidate_ready -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/voice/livekit_session.py agent/tests/test_livekit_session_voice.py
git commit -m "feat(voice): bounded candidate-readiness gate (ready attr + mic track)"
```

---

### Task 5: Wire the readiness gate into `start()`

**Files:**
- Modify: `agent/src/agent/voice/livekit_session.py`

- [ ] **Step 1: Edit `start()`**

After `voice._link_participant(...)` and before `return voice`, await readiness:

```python
        session.room_io.set_participant(participant.identity)
        voice._link_participant(job.room, participant.identity)
        await voice._await_candidate_ready(
            participant,
            timeout=float(
                os.environ.get(
                    "PUDDLE_CANDIDATE_READY_TIMEOUT_SECONDS",
                    _DEFAULT_CANDIDATE_READY_TIMEOUT_SECONDS,
                )
            ),
        )
        logger.info(
            "linked LiveKit participant",
            extra={"room": job.room.name, "participant": participant.identity},
        )
        return voice
```

- [ ] **Step 2: Verify nothing regressed**

Run: `cd agent && uv run pytest tests/test_livekit_session_voice.py -v`
Expected: PASS (existing tests unaffected; `start()` is live wiring covered by the helper test + the live self-test in Task 16).

- [ ] **Step 3: Commit**

```bash
git add agent/src/agent/voice/livekit_session.py
git commit -m "fix(voice): gate opener on candidate readiness in start()"
```

---

## Phase 3 — Session builder, VAD, config, cleanup

### Task 6: Canonical `build_agent_session(*, stt, tts, vad)` + regression guard

**Files:**
- Modify: `agent/src/agent/voice/session.py`
- Test (new): `agent/tests/test_session_builder.py`

- [ ] **Step 1: Confirm the installed `AgentSession` kwarg names**

Run: `cd agent && uv run python -c "import inspect, livekit.agents as a; print(inspect.signature(a.AgentSession.__init__))"`
Use the printed names for VAD/turn-detection/endpointing below. This plan assumes `vad=`, `turn_detection=`, `min_endpointing_delay=`, `max_endpointing_delay=`. If the installed signature differs, adjust the kwargs in Step 3 and the assertions in Step 2 to match — the test asserts our captured kwargs, so keep them consistent.

- [ ] **Step 2: Write the failing test**

Create `agent/tests/test_session_builder.py`:

```python
from types import SimpleNamespace
from unittest.mock import MagicMock

import agent.voice.session as session_module
from agent.voice.session import build_agent_session


def test_build_agent_session_wires_vad_and_turn_detection(monkeypatch) -> None:  # noqa: ANN001
    captured = {}

    def fake_agent_session(**kwargs):  # noqa: ANN003
        captured.update(kwargs)
        return SimpleNamespace(**kwargs)

    # AgentSession is imported inside the function from livekit.agents.
    import livekit.agents as lk_agents
    monkeypatch.setattr(lk_agents, "AgentSession", fake_agent_session)

    stt, tts, vad = MagicMock(), MagicMock(), MagicMock()
    build_agent_session(stt=stt, tts=tts, vad=vad)

    assert captured["vad"] is vad, "VAD must be wired into the production session"
    assert captured["stt"] is stt
    assert captured["tts"] is tts
    assert captured["llm"] is None
    assert captured["turn_detection"] == "vad"
```

- [ ] **Step 3: Replace the dead builder**

Rewrite `session.py` so the single canonical builder takes pre-built plugins + a VAD:

```python
"""Construct the production LiveKit AgentSession for the cascaded voice loop.

One builder, used by the worker via LiveKitSessionVoiceAgent.start(). The
controller supplies every spoken word verbatim via session.say(); there is no
LLM. Turn-taking uses Silero VAD endpointing.
"""

from __future__ import annotations

from typing import Any


def build_agent_session(*, stt: Any, tts: Any, vad: Any) -> Any:  # pragma: no cover - vendor wiring
    """Build the production AgentSession: cascaded STT/TTS, no LLM, VAD-based
    turn detection. `vad` is the prewarmed Silero model from the worker."""
    from livekit.agents import AgentSession

    return AgentSession(
        stt=stt,
        tts=tts,
        llm=None,
        vad=vad,
        turn_detection="vad",
        min_endpointing_delay=0.5,
        max_endpointing_delay=3.0,
    )
```

- [ ] **Step 4: Run test, verify pass**

Run: `cd agent && uv run pytest tests/test_session_builder.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/voice/session.py agent/tests/test_session_builder.py
git commit -m "refactor(voice): single tested session builder with VAD turn detection"
```

---

### Task 7: Build the session via the canonical builder in `start()`

**Files:**
- Modify: `agent/src/agent/voice/livekit_session.py`

- [ ] **Step 1: Edit `start()` to accept `vad` and use the builder**

Change the `start` signature and session construction:

```python
    @classmethod
    async def start(
        cls,
        job: Any,
        *,
        stt: Any,
        tts: Any,
        vad: Any = None,
        participant_identity: str | None = None,
    ) -> LiveKitSessionVoiceAgent:
        """Start LiveKit room I/O and link to the interview participant."""
        from livekit.agents import Agent, room_io

        from agent.voice.session import build_agent_session

        session = build_agent_session(stt=stt, tts=tts, vad=vad)
```

(Remove the old inline `AgentSession(stt=stt, tts=tts, llm=None)` and its now-unused `AgentSession` import in this method.)

- [ ] **Step 2: Verify no regression**

Run: `cd agent && uv run pytest tests/test_livekit_session_voice.py -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add agent/src/agent/voice/livekit_session.py
git commit -m "refactor(voice): start() builds session via build_agent_session"
```

---

### Task 8: Prewarm Silero VAD at worker level

**Files:**
- Modify: `agent/src/agent/worker/entrypoint.py`, `agent/src/agent/worker/__main__.py`
- Test (new): `agent/tests/test_worker_prewarm.py`

- [ ] **Step 1: Write the failing test**

Create `agent/tests/test_worker_prewarm.py`:

```python
from types import SimpleNamespace

import agent.worker.entrypoint as entrypoint_module
from agent.worker.entrypoint import prewarm


def test_prewarm_loads_vad_into_userdata(monkeypatch) -> None:  # noqa: ANN001
    sentinel = object()

    import livekit.plugins.silero as silero
    monkeypatch.setattr(silero.VAD, "load", staticmethod(lambda *a, **k: sentinel))

    proc = SimpleNamespace(userdata={})
    prewarm(proc)

    assert proc.userdata["vad"] is sentinel
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd agent && uv run pytest tests/test_worker_prewarm.py -v`
Expected: FAIL — `ImportError: cannot import name 'prewarm'`.

- [ ] **Step 3: Add `prewarm` and pass `vad` through**

In `entrypoint.py`, add at module level:

```python
def prewarm(proc: Any) -> None:  # pragma: no cover - exercised via test_worker_prewarm
    """Load the Silero VAD once per worker process into proc.userdata."""
    from livekit.plugins import silero

    proc.userdata["vad"] = silero.VAD.load()
```

(Add `from typing import Any` to the top-level imports if not already present — it is used by `entrypoint`.)

In `entrypoint(ctx)`, pass the prewarmed VAD into `start()`:

```python
        voice = await LiveKitSessionVoiceAgent.start(
            ctx,
            stt=build_deepgram_stt(os.environ["DEEPGRAM_API_KEY"]),
            tts=build_cartesia_tts(os.environ["CARTESIA_API_KEY"]),
            vad=ctx.proc.userdata.get("vad"),
        )
```

In `__main__.py`, wire the prewarm function:

```python
from livekit.agents import WorkerOptions, cli

from agent.worker.entrypoint import entrypoint, prewarm

if __name__ == "__main__":  # pragma: no cover — live LiveKit worker process
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name="puddle-interviewer",
        )
    )
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd agent && uv run pytest tests/test_worker_prewarm.py tests/test_worker_entrypoint.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/worker/entrypoint.py agent/src/agent/worker/__main__.py agent/tests/test_worker_prewarm.py
git commit -m "feat(worker): prewarm Silero VAD and pass it into the session"
```

---

### Task 9: Explicit, tuned Deepgram STT config

**Files:**
- Modify: `agent/src/agent/voice/stt.py`
- Test: `agent/tests/test_stt.py`

- [ ] **Step 1: Write the failing test**

Add to `agent/tests/test_stt.py`:

```python
def test_build_deepgram_stt_sets_explicit_interview_config(monkeypatch) -> None:  # noqa: ANN001
    captured = {}

    import livekit.plugins.deepgram as deepgram
    monkeypatch.setattr(deepgram, "STT", lambda **kwargs: captured.update(kwargs) or object())

    from agent.voice.stt import build_deepgram_stt
    build_deepgram_stt("dg-key")

    assert captured["model"] == "nova-3"
    assert captured["language"] == "en-US"
    assert captured["interim_results"] is True
    assert captured["smart_format"] is True
    assert captured["no_delay"] is True
    assert captured["endpointing_ms"] == 200
    assert captured["filler_words"] is False
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd agent && uv run pytest tests/test_stt.py -k explicit_interview_config -v`
Expected: FAIL (KeyError on the new kwargs).

- [ ] **Step 3: Implement**

Replace `build_deepgram_stt` in `stt.py`:

```python
def build_deepgram_stt(api_key: str) -> Any:  # pragma: no cover — vendor wiring
    """Construct the LiveKit Deepgram plugin tuned for an English interview.

    Defaults are made explicit: nova-3 + en-US, interim results for
    responsiveness, smart_format for clean numbers/dates, no_delay so finals
    aren't held back, a 200ms endpoint so one answer coalesces into fewer
    segments, and filler_words off (no semantic EOU model in this pipeline)."""
    from livekit.plugins import deepgram

    return deepgram.STT(
        model="nova-3",
        language="en-US",
        api_key=api_key,
        interim_results=True,
        punctuate=True,
        smart_format=True,
        no_delay=True,
        endpointing_ms=200,
        filler_words=False,
    )
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd agent && uv run pytest tests/test_stt.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/voice/stt.py agent/tests/test_stt.py
git commit -m "fix(stt): explicit tuned Deepgram config for interview turn-taking"
```

---

### Task 10: Cartesia TTS naturalness/pacing

**Files:**
- Modify: `agent/src/agent/voice/tts.py`
- Test: `agent/tests/test_tts.py`

- [ ] **Step 1: Confirm sonic-3 kwargs in the installed plugin**

Run: `cd agent && uv run python -c "import inspect; from livekit.plugins import cartesia; print(inspect.signature(cartesia.TTS.__init__))"`
Confirm `speed`, `language`, and `text_pacing` (or the version's equivalents) exist. Adjust the kwargs below + the test to match the real signature.

- [ ] **Step 2: Write the failing test**

Add to `agent/tests/test_tts.py`:

```python
def test_build_cartesia_tts_uses_sonic3_with_pacing(monkeypatch) -> None:  # noqa: ANN001
    captured = {}

    import livekit.plugins.cartesia as cartesia
    monkeypatch.setattr(cartesia, "TTS", lambda **kwargs: captured.update(kwargs) or object())
    monkeypatch.delenv("CARTESIA_VOICE_ID", raising=False)

    from agent.voice.tts import build_cartesia_tts
    build_cartesia_tts("ct-key")

    assert captured["model"] == "sonic-3"
    assert captured["language"] == "en"
    assert captured["speed"] == 1.05
    assert captured["text_pacing"] is True
    assert "voice" not in captured  # no CARTESIA_VOICE_ID set
```

- [ ] **Step 3: Implement**

Update `build_cartesia_tts` in `tts.py`:

```python
def build_cartesia_tts(api_key: str) -> Any:  # pragma: no cover — vendor wiring
    """Construct the LiveKit Cartesia plugin (Sonic-3) with a slightly brisker
    cadence and sentence pacing for smoother long utterances. Uses CARTESIA_VOICE_ID
    when set, else the Cartesia default voice."""
    from livekit.plugins import cartesia

    kwargs: dict[str, Any] = {
        "model": "sonic-3",
        "api_key": api_key,
        "language": "en",
        "speed": 1.05,
        "text_pacing": True,
    }
    voice_id = os.environ.get("CARTESIA_VOICE_ID", "").strip()
    if voice_id:
        kwargs["voice"] = voice_id
    return cartesia.TTS(**kwargs)
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd agent && uv run pytest tests/test_tts.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/voice/tts.py agent/tests/test_tts.py
git commit -m "fix(tts): sonic-3 with brisker pace + sentence pacing"
```

---

### Task 11: Delete the dead `livekit_agent.py` spike

**Files:**
- Delete: `agent/src/agent/voice/livekit_agent.py`, `agent/tests/test_livekit_agent.py`

- [ ] **Step 1: Confirm it has no importers**

Run: `cd agent && grep -rn "livekit_agent" src tests | grep -v "livekit_session"`
Expected: only matches inside `livekit_agent.py`/`test_livekit_agent.py` themselves (no production importers).

- [ ] **Step 2: Delete the files**

```bash
git rm agent/src/agent/voice/livekit_agent.py agent/tests/test_livekit_agent.py
```

- [ ] **Step 3: Run the full agent suite**

Run: `cd agent && uv run pytest -q`
Expected: PASS, no import errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(voice): remove dead LiveKitVoiceAgent spike and debug prints"
```

---

## Phase 4 — Readiness handshake, frontend (#3 + autoplay)

### Task 12: Readiness gate + autoplay handling in `livekit.ts`

**Files:**
- Create: `room/src/readiness.ts`, `room/src/readiness.test.ts`
- Modify: `room/src/livekit.ts`

- [ ] **Step 1: Write the failing test**

Create `room/src/readiness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isCandidateReady } from "./readiness.js";

describe("isCandidateReady", () => {
  it("is ready only when mic is published and audio can play", () => {
    expect(isCandidateReady(true, true)).toBe(true);
    expect(isCandidateReady(false, true)).toBe(false);
    expect(isCandidateReady(true, false)).toBe(false);
    expect(isCandidateReady(false, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd room && pnpm test`
Expected: FAIL — cannot resolve `./readiness.js`.

- [ ] **Step 3: Implement the helper**

Create `room/src/readiness.ts`:

```ts
// The candidate is "ready" only when they can BOTH be heard (mic track
// published) and hear the agent (browser autoplay unblocked). The agent worker
// waits for this signal before speaking the opener.
export function isCandidateReady(micPublished: boolean, canPlaybackAudio: boolean): boolean {
  return micPublished && canPlaybackAudio;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `cd room && pnpm test`
Expected: PASS.

- [ ] **Step 5: Wire autoplay + readiness into `connectToInterview`**

Rewrite `room/src/livekit.ts` to expose audio-playback state and signal readiness:

```ts
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { isCandidateReady } from "./readiness.js";

export interface RoomConnection {
  readonly room: Room;
  startAudio: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export async function connectToInterview(
  wsUrl: string,
  token: string,
  onAgentAudio: (el: HTMLAudioElement) => void,
  onSelfVideo: (track: MediaStreamTrack) => void,
  onAudioPlaybackChanged?: (canPlayback: boolean) => void,
): Promise<RoomConnection> {
  const room = new Room({ adaptiveStream: true, dynacast: true });

  let micPublished = false;
  const signalReadyIfPossible = (): void => {
    if (isCandidateReady(micPublished, room.canPlaybackAudio)) {
      void room.localParticipant.setAttributes({ ready: "true" });
    }
  };

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach() as HTMLAudioElement;
      onAgentAudio(el);
    }
  });
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    onAudioPlaybackChanged?.(room.canPlaybackAudio);
    signalReadyIfPossible();
  });

  await room.connect(wsUrl, token);

  // Publish mic with a pre-connect buffer so the first words aren't lost.
  // (If the installed livekit-client lacks preConnectBuffer, the third arg is
  // ignored and we still await the publication below.)
  await room.localParticipant.setMicrophoneEnabled(true, undefined, {
    preConnectBuffer: true,
  } as never);
  await room.localParticipant.setCameraEnabled(true);
  micPublished = room.localParticipant
    .getTrackPublications()
    .some((p) => p.kind === Track.Kind.Audio);

  const camPub = room.localParticipant
    .getTrackPublications()
    .find((p) => p.kind === Track.Kind.Video);
  if (camPub?.track) {
    onSelfVideo(camPub.track.mediaStreamTrack);
  }

  onAudioPlaybackChanged?.(room.canPlaybackAudio);
  signalReadyIfPossible();

  return {
    room,
    startAudio: async () => {
      await room.startAudio();
      signalReadyIfPossible();
    },
    disconnect: () => room.disconnect(),
  };
}
```

- [ ] **Step 6: Typecheck + test**

Run: `cd room && pnpm test && pnpm exec tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 7: Commit**

```bash
git add room/src/readiness.ts room/src/readiness.test.ts room/src/livekit.ts
git commit -m "feat(room): signal candidate-ready after mic publish + audio unblock"
```

---

### Task 13: "Tap to enable audio" affordance in `InCall.tsx`

**Files:**
- Modify: `room/src/pages/InCall.tsx`

- [ ] **Step 1: Wire playback state + button**

Update `InCall.tsx` to track playback and render an unblock button:

```tsx
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
  const [needsAudioGesture, setNeedsAudioGesture] = useState(false);
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
      (canPlayback) => setNeedsAudioGesture(!canPlayback),
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

  const enableAudio = (): void => {
    void connRef.current?.startAudio().then(() => setNeedsAudioGesture(false));
  };

  const end = (): void => {
    void connRef.current?.disconnect();
    setStatus("ended");
    onComplete();
  };

  return (
    <main>
      <div aria-label="status">{status}</div>
      {needsAudioGesture && (
        <button aria-label="enable-audio" onClick={enableAudio}>
          Tap to enable audio
        </button>
      )}
      <video aria-label="self-view" ref={selfVideoRef} autoPlay muted playsInline />
      <button onClick={end}>End interview</button>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd room && pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add room/src/pages/InCall.tsx
git commit -m "feat(room): tap-to-enable-audio affordance for blocked autoplay"
```

---

## Phase 5 — Docs & manual gates

### Task 14: Update `docs/KNOWN_ISSUES.md`

**Files:**
- Modify: `docs/KNOWN_ISSUES.md`

- [ ] **Step 1: Edit**

- Under **#2 (turn detector)**: note that production now uses VAD endpointing via the single `build_agent_session`, and the no-VAD live path is fixed; the semantic EOU model remains deferred.
- Under **#3 (region)**: mark it the highest-priority remaining latency item and reference Task 15.
- Add a short "Fixed 2026-06-09" note pointing at this plan for the readiness handshake, transcript coalescing, and VAD wiring.

- [ ] **Step 2: Commit**

```bash
git add docs/KNOWN_ISSUES.md
git commit -m "docs: update KNOWN_ISSUES for voice bugfixes"
```

---

### Task 15: LiveKit Cloud region move — **manual-gate (operator)**

> **manual-gate:** prod config change. Halts the autonomous run; operator performs it.

- [ ] **Step 1 (operator):** LiveKit Cloud dashboard → your project → **Settings → Region** → change from São Paulo to **us-west-2** (or nearest US region for SF). `LIVEKIT_URL` does not change.
- [ ] **Step 2 (operator):** Restart the worker so it registers against the new region; confirm worker logs show a US `nodeId`/region (not `OSAOPAULO`).
- [ ] **Step 3 (operator):** Tick `KNOWN_ISSUES.md` #3 as resolved.

---

### Task 16: Live self-test verification — **manual-gate (operator)**

> **manual-gate:** running a live interview. Self-test only — **never a real candidate** (per project `CLAUDE.md`).

- [ ] **Step 1:** Start the worker with debug logging: `cd agent && uv run --env-file ../.env python -m agent.worker dev`
- [ ] **Step 2:** Run the room app, join a test interview, and answer the opener normally; deliberately also pause mid-answer once.
- [ ] **Step 3:** Confirm in the worker logs:
  - `candidate ready` fires before the opener (`speaking utterance` for the INTRO comes after it).
  - `candidate transcript event` lines appear with `final: true` while you speak.
  - `received coalesced candidate turn` shows `segments > 1` for a multi-clause answer.
  - No `AUDIO_REPAIR` utterance while you were speaking.
- [ ] **Step 4:** Confirm in the browser you heard the opener (and, if the "Tap to enable audio" button appeared, that tapping it started audio).
- [ ] **Step 5:** If `candidate transcript event` never appears during a stuck turn, the residual problem is the audio input path (mic publish/subscribe) — capture the log and reopen investigation before further changes.

---

## Self-Review

**Spec coverage:** Readiness handshake → Tasks 4,5,12,13. Full-answer capture → Task 1. VAD-aware repair / humane timeout → Task 3. VAD hardening → Tasks 6,7,8. STT/TTS config → Tasks 9,10. Dead-code consolidation + wiring test → Tasks 6,11. Region move (operator) → Task 15. Live verification (operator) → Task 16. Docs → Task 14. All spec sections covered.

**Placeholder scan:** none — every code/test step has concrete content; the only deliberate "verify against installed SDK" steps (Tasks 6,10) carry exact commands and fallbacks.

**Type/name consistency:** `coalesce_window_seconds` (ctor param + env), `user_is_speaking()` (ABC + impl + controller probe), `_await_candidate_ready(participant, timeout)`, `build_agent_session(*, stt, tts, vad)`, `prewarm(proc)`, `isCandidateReady(micPublished, canPlaybackAudio)`, `startAudio()` — used consistently across tasks.

**Risk note:** The single version-API uncertainty is the exact `AgentSession`/`cartesia.TTS` kwarg names (Tasks 6, 10) — each has a confirm-signature step up front, and the tests assert *our captured kwargs* so they stay honest regardless.
