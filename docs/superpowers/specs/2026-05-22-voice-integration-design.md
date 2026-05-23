# Puddle Voice Interviewer — Live LiveKit Integration (design spec)

**Date:** 2026-05-22
**Status:** approved — ready for implementation planning

## Problem

The v1 build produced a complete, tested architecture and all the deterministic
IP (Interview Controller, Scorer, Probe Generator, eval harness). But the live
audio/video seam is **skeleton written against an invented API**:

- `agent/src/agent/worker/entrypoint.py` reads `job.metadata` — the real
  LiveKit `JobContext` (v1.5.11) has no `.metadata` (it is `ctx.job.metadata`).
- `CascadedVoiceAgent` / `DeepgramSTT` / `CartesiaTTS` call `room_output.play()`,
  `stt.next_turn()`, `plugin.stream()` — none of which exist in the real
  `livekit-agents` / `livekit-plugins-*` packages.
- The candidate `room` app renders a 6-step UI but never opens a LiveKit room
  (`livekit-client` is a dependency, unused).

Result: no interview can actually run. The v1 plan deliberately scoped this
out (every such function is `# pragma: no cover` "live-environment wiring").

## Goal

A developer can, locally: start the backend + agent worker + room app, open the
room app, click **Start**, and be interviewed **by voice** by the AI agent — it
asks the 4 pilot questions, probes on low-confidence answers, respects the time
caps, and writes an `Assessment` row to the database.

## Scope

**In scope**
- Real LiveKit Agents 1.5 `AgentSession` voice loop (Deepgram STT, Cartesia TTS,
  Silero VAD).
- Real `JobContext` handling in the worker entrypoint.
- Backend candidate join-token issuance; `POST /sessions` returns room + token +
  ws URL.
- Room app: real `livekit-client` connection (publish mic + camera, play the
  agent's audio), self-serve session creation.
- Persisting the finished `Assessment` to the `assessments` table; updating
  `sessions.status`.

**Out of scope** (unchanged from v1 / deferred)
- LiveKit Egress recording, S3 object storage.
- Video perception / VLM integrity analysis — the `InterviewRunner` `perception`
  hook stays unused.
- The `review` app, platform integration, calibration.
- Production deploy / hosting.

## Decisions (from brainstorming, 2026-05-22)

- **Media:** candidate publishes **mic + camera**; camera self-view shown; no
  analysis of the video.
- **Recording:** **skipped** — no Egress, no S3.
- **Start flow:** **room app self-serves** — it calls the backend to create a
  session and get a join token, then connects.

## Architecture

### The scripted-agent challenge

LiveKit's `AgentSession` is normally an autonomous STT→LLM→TTS loop. Puddle's
design is the opposite: the **Interview Controller is deterministic** and speaks
**verbatim** text (scripted questions, Probe-Generator probes, scripted lines) —
no LLM generates the agent's speech. The integration therefore uses
`AgentSession` in a **controller-driven** mode:

- `AgentSession` created with `stt`, `tts`, `vad` — **no `llm`** driving
  conversation.
- The agent **speaks** via `session.say(text)` — exact text, awaited to
  completion (`SpeechHandle`).
- The agent **listens** by consuming `user_input_transcribed` events; a
  candidate turn = the final transcript after end-of-turn (LiveKit VAD + turn
  detection provides endpointing).
- The existing `InterviewRunner` loop (verbatim question → listen → score →
  probe/advance) is **unchanged**; only its injected `voice` object becomes a
  real LiveKit-backed adapter.

> **Risk to verify first (plan Task 1.1):** confirm against the installed
> `livekit-agents==1.5.11` and https://docs.livekit.io/agents/ that
> `AgentSession` can run **without an `llm`** in a `say()`-driven mode. If it
> cannot, the adapter uses the lower-level room I/O + `stt`/`tts` streams
> directly instead of `AgentSession`. The plan's first task is a spike that
> resolves this and pins the exact API before the rest is built.

### Components

| Component | File | Notes |
|---|---|---|
| `build_agent_session` | `agent/src/agent/voice/session.py` (new) | Constructs the real `AgentSession` — `deepgram.STT(model="nova-3")`, `cartesia.TTS(model="sonic-3")`, `silero.VAD.load()`, turn detection. `# pragma: no cover`. |
| `LiveKitVoiceAgent` | `agent/src/agent/voice/livekit_agent.py` (new) | Implements the existing `VoiceAgent` ABC against a live `AgentSession`. `speak()`→`await session.say()`; `listen()`→await next final user transcript (bridges the event stream to an `asyncio` queue); `interrupt()`→`session.interrupt()`; `set_mode()`→pacing/no-op. |
| `entrypoint.py` | `agent/src/agent/worker/entrypoint.py` (rewrite) | `build_session_context` reads `ctx.job.metadata`; `entrypoint` does `await ctx.connect()`, awaits the participant, starts the `AgentSession` on `ctx.room`, builds `LiveKitVoiceAgent` + `InterviewRunner`, runs the interview, persists the `Assessment`. |
| Assessment persistence | `agent/src/agent/worker/persistence.py` (new) | Writes the finished `Assessment` to `assessments` and sets `sessions.status`. Python Postgres driver (`asyncpg`). |
| Backend join token | `backend/src/livekit/token.ts` (new) | `buildCandidateToken(...)` via `livekit-server-sdk` `AccessToken`, room-join grant. `POST /sessions` response extended with `{ token, wsUrl, room }`. |
| Room LiveKit connection | `room/src/livekit.ts` (new) | `livekit-client` `Room`: connect with token, publish mic + camera, expose the agent's audio track + local video. |
| Room in-call UI | `room/src/pages/InCall.tsx` (rewrite) | Uses `room/src/livekit.ts`; renders agent audio + candidate self-view; handles disconnect. |
| Room self-serve flow | `room/src/flow.ts` / `App.tsx` (extend) | On Start, `POST /sessions`, capture `{room, token, wsUrl}`, advance to InCall and connect. |

### Skeleton retired

`agent/src/agent/voice/cascaded.py`, `stt.py`, `tts.py`, `turn_detector.py` are
skeleton against an invented API and are **removed** with their tests. The
`VoiceAgent` ABC, `VoiceMode`, and `ListenResult` in `voice/interface.py` are
**kept** — the new `LiveKitVoiceAgent` implements them, so `InterviewRunner` is
untouched.

### Data flow (one interview)

```
room app  ──POST /sessions──▶  backend
                               ├─ insert sessions row
                               ├─ provision LiveKit room
                               ├─ dispatch `puddle-interviewer` worker
                               └─ return { room, token, wsUrl }
room app  ──connect(token)──▶  LiveKit room  (publishes mic + camera)
worker entrypoint            ──▶ AgentSession.start(room)
InterviewRunner.run()          ─ say() verbatim question ─▶ candidate
                               ◀─ STT final transcript ── candidate answer
                               ─ Scorer → probe / advance ─ (loop ×4 questions)
worker                       ──▶ roll up Assessment → INSERT assessments
                                  UPDATE sessions.status = 'review_ready'
```

## Error handling

- LiveKit / STT / TTS failure mid-interview: the worker logs it, sets
  `sessions.status = 'incomplete'`, and exits cleanly — **no partial Assessment
  is written**.
- Candidate disconnect: the room emits a disconnect; the worker ends the run and
  marks the session `incomplete`.
- Scorer (Anthropic) bad output already raises `ScorerParseError`; the existing
  controller handling applies.

## Testing

- **Offline (TDD):** `build_session_context` against a fake `JobContext` with the
  real `ctx.job.metadata` shape; the backend token builder; the room-app
  self-serve flow logic; the Assessment-persistence SQL builder.
- **Live wiring** (`build_agent_session`, `LiveKitVoiceAgent` against a real
  session, `InCall.tsx` LiveKit connection) is `# pragma: no cover` — verified by
  a **real local test interview**, not unit tests.
- The existing **113 Python + 35 TS tests must stay green** — the
  `InterviewRunner` loop, Controller, Scorer, Probe Generator are unchanged.
- **Acceptance:** a human completes a voice interview locally and an
  `Assessment` row appears in the database with the four category scores.

## Risks

- The exact `AgentSession` API for a no-LLM, scripted, `say()`-driven flow must
  be pinned against the installed package and LiveKit docs — the plan's **Task
  1.1 is a spike** that does this before the dependent work.
- This integration **cannot be fully verified by automated tests**; a real voice
  run against the developer's LiveKit/Deepgram/Cartesia accounts is the
  acceptance test.
- `livekit-plugins-silero` and `livekit-plugins-turn-detector` model downloads
  may be needed at first run (`python -m agent.worker download-files`).
