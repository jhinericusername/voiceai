# Voice Agent Bugfixes — Design Spec

**Date:** 2026-06-09
**Branch:** prakul-script-extraction
**Status:** Proposed (awaiting approval)

## Problem

Live testing of the LiveKit voice interviewer surfaces three bugs:

1. **Slow & robotic** — the agent's voice lags and sounds synthetic.
2. **Doesn't pick up my voice / keeps asking me to speak** — most of the time the
   agent doesn't register that the candidate is speaking and repeats prompts to
   "please answer out loud."
3. **Speaks before the room is ready** — on join, the agent starts the opener
   before the candidate's client is fully loaded.

## Root causes (verified against installed `livekit-agents 1.5.11` source + docs)

A parallel investigation (6 agents, adversarial refutation) produced these
findings. The leading hypothesis — "the production `AgentSession` is missing
`vad=`/`turn_detection=`, so it never hears the candidate" — was **refuted**:
the cascaded pipeline still commits user turns from Deepgram final-transcript
events plus a default 0.5 s endpointing timer (`audio_recognition.py:858-922`,
`agent_activity.py:1810-1819`). Missing VAD is a robustness gap, not the on/off
cause.

The actual root causes:

| Symptom | Root cause | Evidence |
|---|---|---|
| **#2 (no pickup / re-prompts)** | **(a) Input/readiness race:** the worker starts the interview the instant the participant *joins the room* (`wait_for_participant()` resolves on join, not on mic-track-subscribed), and the frontend enables the mic only *after* `room.connect()` resolves. The opener + its answer-pause can occur before the agent is subscribed to the candidate's mic → no transcript → the controller's 8 s `asyncio.wait_for` times out and speaks the audio-repair lines. **(b) Truncation:** `listen()` returns on the *first* Deepgram `is_final` segment (~one clause), so longer answers get chopped → low-confidence → re-probes. | `livekit_session.py:116-119` (`wait_for_participant`); `livekit.ts:25-27` (mic after connect); `interview.py:323-356` (8/12 s repair); `livekit_session.py:170-179` (returns on first `is_final`) |
| **#3 (speaks too early)** | `wait_for_participant()` resolves on participant join; there is **no readiness handshake** confirming the candidate can hear (browser autoplay) and be heard (mic subscribed). The agent's TTS *output* is gated on subscription (`RoomIO _subscribed_fut`, so the opener isn't lost), but it still begins before the candidate is ready to answer, and audio playback may be autoplay-blocked (no `room.startAudio()` affordance). | `livekit_session.py:115-125`; `livekit.ts:18-23` (`track.attach()` + append, no `canPlaybackAudio`/`startAudio`) |
| **#1 (slow & robotic)** | **LiveKit Cloud project region pinned to São Paulo** (~180 ms RTT from SF + jitter) is the dominant latency/quality factor. "Robotic" is network jitter + the generic default Cartesia voice. `sonic-3` is the **correct/current** model id; TTS already streams (~90-200 ms TTFB) and is *not* the bottleneck. | `KNOWN_ISSUES.md` #3; `tts.py:18` (`sonic-3`); investigation: Cartesia plugin streams via `session.say()` |

**Contributing hygiene issues:** the old `livekit_agent.py` spike (with debug
`print()`s) and the VAD-configured `session.py:build_agent_session()` are both
**dead code** — the drift that let the no-VAD live path ship. **No test
exercises the real `AgentSession` construction**, so the regression was
invisible.

## Design

Five cohesive changes plus one operator action. Decisions confirmed with the
operator are marked **[chosen]**.

### 1. Readiness handshake (fixes #3 and the first-turn half of #2)

Gate the opener on the candidate being able to **hear and be heard**.

- **Frontend** (`room/src/livekit.ts`, `room/src/pages/InCall.tsx`):
  - Publish the mic with a pre-connect buffer so the first words aren't lost
    (`setMicrophoneEnabled(true, undefined, { preConnectBuffer: true })`, if
    supported by the installed `livekit-client`; otherwise enable mic and await
    the `LocalTrackPublication` before signaling ready).
  - Handle autoplay: listen for `RoomEvent.AudioPlaybackStatusChanged`, expose
    `room.canPlaybackAudio` and a `startAudio()` action. Render a **"Tap to
    enable audio"** button in `InCall` whenever `canPlaybackAudio === false`; its
    click (a real user gesture) calls `room.startAudio()`.
  - Once (i) the mic `LocalTrackPublication` is live **and** (ii) playback is
    unblocked, signal readiness: **`room.localParticipant.setAttributes({ ready: 'true' })`** **[chosen: participant attributes]**.
- **Agent** (`livekit_session.py` `start()`): after `wait_for_participant` +
  `set_participant`, await **both** the participant's `ready` attribute and the
  microphone audio track being subscribed, via `participant_attributes_changed`
  / `track_subscribed` room events, with a **bounded timeout (~10 s)**. On
  timeout, log a warning and proceed anyway (never hard-block a session). Only
  then does `start()` return, so `_speak_opener()` runs against a ready candidate.

### 2. Full-answer capture in `listen()` (fixes the truncation half of #2)

**[chosen: coalesce until pause, paired with a modest `endpointing_ms` bump]**

- In `LiveKitSessionVoiceAgent`, accumulate `is_final` transcript segments into a
  pending buffer as they arrive. After each segment, (re)start a short
  **coalesce window** (configurable, default ~0.8 s, ≥ the VAD `min_delay`); when
  it elapses with no new segment, flush the concatenated text as one
  `ListenResult`. This returns the *complete* answer instead of the first clause.
- Make the repair logic **VAD-aware**: do not fire the "I can't hear you" repair
  while the candidate is actively speaking (use `user_state`), and raise the
  initial no-speech timeout to a humane default (configurable, ~15-20 s) so
  genuine think-pauses don't trip the microphone-check prompt. Keep the repair
  lines as a graceful last-resort fallback.

### 3. VAD hardening **[chosen: include now]**

- `worker/__main__.py`: add `WorkerOptions(prewarm_fnc=...)` that loads
  `silero.VAD.load()` into `proc.userdata["vad"]` (warms the model once per
  worker process).
- `worker/entrypoint.py`: pass `vad=ctx.proc.userdata["vad"]` into
  `LiveKitSessionVoiceAgent.start(...)`.
- The session is then built with `vad=vad` and
  `turn_handling={"turn_detection": "vad", "endpointing": {"min_delay": 0.5, "max_delay": 3.0}}`.
  This enables candidate **barge-in/interruption** (`speak()` already passes
  `allow_interruptions=True`) and accurate "user is speaking" state — useful for
  the scripting/speaking changes planned next.

### 4. Explicit, tuned STT/TTS config

- `voice/stt.py` `build_deepgram_stt`: make the (currently inherited) defaults
  explicit and tuned — `language="en-US"`, `punctuate=True`, `smart_format=True`,
  `no_delay=True`, `endpointing_ms≈200`, `filler_words=False`,
  `interim_results=True`. (Do **not** pass `utterance_end_ms` — unsupported in
  1.5.11.)
- `voice/tts.py` `build_cartesia_tts`: keep `model="sonic-3"`; optionally add
  `language="en"`, a slightly brisker `speed≈1.05`, and `text_pacing=True` for
  smoother long-utterance cadence. Keep `CARTESIA_VOICE_ID` support (operator can
  set a higher-quality/cloned voice to address "robotic" timbre).

### 5. Consolidate dead code + add a wiring test **[chosen: consolidate + delete]**

- Make **one** canonical session builder, `voice/session.py`
  `build_agent_session(*, stt, tts, vad)`, returning the fully-configured
  `AgentSession`; `LiveKitSessionVoiceAgent.start()` calls it. Remove the stale
  `build_agent_session(deepgram_api_key, cartesia_api_key)` signature.
- Delete the dead `voice/livekit_agent.py` spike (and its test).
- Add a **wiring test** that builds the session the way the worker does (with a
  spy/fake `AgentSession` factory) and asserts: `vad` is not `None`,
  `turn_detection` is configured, and the STT/TTS models are `nova-3`/`sonic-3`.
  This test **fails if VAD/turn detection is ever dropped again.**

### 6. LiveKit Cloud region move — **operator action (manual-gate)**

Biggest single win for #1; no code. Operator changes **LiveKit Cloud dashboard →
Project Settings → Region** from São Paulo to a US region (`us-west-2` for SF).
`LIVEKIT_URL` does not change. I will provide exact steps; this is tracked as a
manual step and updated in `KNOWN_ISSUES.md` #3.

## Data flow (after changes)

```
Candidate browser                         Agent worker
─────────────────                         ────────────
room.connect()
mic publish (preConnectBuffer)  ──tracks──▶ wait_for_participant() resolves
startAudio() on gesture                     set_participant()
canPlaybackAudio === true                   await: ready attr + mic subscribed
setAttributes({ready:'true'}) ──attrs────▶  (≤10 s, else warn+proceed)
                                            start() returns → controller.run()
                                            _speak_opener()  ◀── candidate can hear
   speaks answer ───────audio────────────▶ STT finals → coalesce until pause
                                            listen() returns FULL turn → score
```

## Error handling

- Readiness wait is **bounded** (~10 s) and **fails open** (log + proceed) — a
  flaky client never deadlocks the worker.
- The audio-repair fallback stays, but is VAD-aware and triggered only on genuine
  silence, not while the candidate speaks.
- VAD prewarm failure is logged; the session can still construct (VAD optional at
  the builder boundary) so a prewarm hiccup degrades gracefully rather than
  crashing the worker.

## Testing

- **Unit:** `listen()` coalescing (multiple `is_final` → one full turn; window
  reset on new segment; flush on quiet); readiness gate (resolves on attr+track,
  times out and proceeds); VAD-aware repair suppression.
- **Wiring:** session-builder config assertions (VAD present, turn detection set,
  models correct) — the regression guard.
- **Live verification (operator):** one real self-test session with worker logs;
  confirm `"candidate transcript event"` lines appear and full answers are
  captured; confirm the opener fires only after readiness. (Self-test only —
  **not** a real candidate, per project manual-gate rules.)

## manual-gate items (per project `CLAUDE.md`)

- **LiveKit Cloud region change** (prod config) — operator-only dashboard action.
- **Live verification run** — must be a self-test, never a real candidate.

No database migrations, bulk writes, or deploys are in scope.

## Out of scope (explicitly deferred)

- Full room UI overhaul (`KNOWN_ISSUES` #6).
- Re-enabling `<React.StrictMode>` / `InCall` double-mount idempotency
  (`KNOWN_ISSUES` #1) — unless the readiness refactor makes it trivially safe.
- Semantic EOU `MultilingualModel` turn detector (`KNOWN_ISSUES` #2) — VAD
  endpointing is sufficient for now.
- Backend env-parsing / CORS hygiene (`KNOWN_ISSUES` #4/#5).
- The agent **scripting / question** changes the operator plans to do next.
```
