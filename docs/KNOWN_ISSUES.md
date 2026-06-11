# Known Issues — must fix before production

Tracked issues found during live testing of the v1 voice integration. None are blocking the local dev loop; all are blocking a real-candidate run.

---

## ✅ Fixed 2026-06-09 — voice bugfix batch

See `docs/superpowers/plans/2026-06-09-voice-agent-bugfixes.md`. Root cause for the
"agent doesn't hear me / keeps asking me to speak" symptom was **not** a missing
VAD (the pipeline transcribes without one) — it was a readiness/input race plus
`listen()` returning on the first STT segment. Shipped:

- **Readiness handshake** — the room app signals a `ready` participant attribute
  only after the mic is published *and* browser autoplay is unblocked; the worker
  waits for it (bounded, fails open) before speaking the opener. Adds a
  "Tap to enable audio" affordance for blocked autoplay.
- **Full-answer capture** — `listen()` coalesces Deepgram final segments until a
  pause, so multi-clause answers aren't truncated; the audio-repair prompt is now
  VAD-aware (no nagging mid-answer) with a humane 20 s initial timeout.
- **VAD hardening** — Silero VAD is prewarmed at worker level and wired through a
  single tested `build_agent_session(*, stt, tts, vad)`; a regression test fails
  if VAD/turn-detection is ever dropped again. Removed the dead `livekit_agent.py`
  spike and the stale `build_agent_session` signature.
- **Tuned STT/TTS** — explicit Deepgram interview config (en-US, smart_format,
  `endpointing_ms=200`, no filler words); Cartesia `sonic-3` with `speed=1.05` and
  sentence pacing.

Remaining: **#3 (region)** is now the top latency item, and **#1 (StrictMode)** is
unchanged.

---

## 1. InCall not StrictMode-safe

**Severity:** High (correctness)
**File:** `room/src/pages/InCall.tsx`, `room/src/main.tsx`
**Discovered:** 2026-05-22, live test 2

### Symptom
With `<React.StrictMode>` enabled in dev, the InCall component double-mounts (mount → cleanup → mount). The cleanup runs `connRef.current?.disconnect()` while a second mount immediately kicks off another `connectToInterview(...)`. From LiveKit's side the candidate joins, disconnects after ~278 ms, then rejoins — which trips `participant_disconnected` on the worker and ends the session before the agent can speak.

### Workaround in place
StrictMode is disabled in `room/src/main.tsx`.

### Real fix
Make `InCall` idempotent under double-mount. Options:
- Move the room connection into a module-level singleton or React Context that owns the `Room` lifecycle independently of mount order, with reference-counted disconnect.
- Track an in-flight connect promise outside the effect so the second mount reuses it instead of starting a parallel connect.
- Defer the connect until the first user gesture (Join button inside InCall) instead of on mount, so unmount during a render cycle never tears down an active call.

Re-enable `<React.StrictMode>` in `room/src/main.tsx` once the component survives a mount → cleanup → mount cycle without losing the call.

---

## 2. MultilingualModel turn detector — no inference executor

**Severity:** Medium (quality)
**File:** `agent/src/agent/voice/session.py`, `agent/src/agent/worker/__main__.py`
**Discovered:** 2026-05-22, live test 1

### Symptom
The first end-of-turn prediction raised `RuntimeError: inference of lk_end_of_utterance_multilingual failed: no inference executor`. The MultilingualModel needs a worker-level inference process that is started via `WorkerOptions.prewarm_fnc` (or a similar `inference_executor=` config), which is not currently wired.

### Workaround in place
As of 2026-06-09 the production session is built by the single
`voice/session.py:build_agent_session(*, stt, tts, vad)` with `turn_detection="vad"`
and a Silero VAD prewarmed via `WorkerOptions.prewarm_fnc`. VAD-only endpointing is
reliable but less precise on think-pauses than the semantic EOU model, which
remains deferred (see the real fix below).

### Real fix
- Add a `prewarm_fnc` to `WorkerOptions` in `agent/src/agent/worker/__main__.py` that loads the `MultilingualModel` into `proc.userdata`.
- In `build_agent_session`, accept the prewarmed model as a parameter and pass it as `turn_detection=`.
- Verify on a live run that the first turn endpoints correctly.

---

## 3. LiveKit Cloud project pinned to São Paulo

**Severity:** Medium (latency)
**File:** none — LiveKit Cloud dashboard setting
**Discovered:** 2026-05-22, live test 1

### Symptom
Worker logs show `region: Brazil, nodeId: NM_OSAOPAULO1B_...`. Browser → LK edge RTT from SF baseline ~180 ms before any media processing.

### Workaround in place
None — adds noticeable but tolerable lag in local dev. **Now the top remaining
latency item** after the 2026-06-09 bugfix batch; tracked as the operator
manual-gate step in `docs/superpowers/plans/2026-06-09-voice-agent-bugfixes.md`
(Task 15).

### Real fix
~~LiveKit Cloud dashboard → Project Settings → Region~~ — that setting
doesn't exist for an existing project (only LiveKit-hosted Agents have a
region picker, which doesn't apply to our self-hosted ECS worker).

**Appears resolved as of 2026-06-11:** the rev-18 worker registered with
`region: "US West B"` (was `NM_OSAOPAULO1B_...`). No project change was made —
verify on the next live candidate test before closing for good.

---

## 4. Backend env-file parsing fragile

**Severity:** Low (DX)
**File:** `.env`, `backend/src/server.ts`
**Discovered:** 2026-05-22, live test 1

### Symptom
Node's built-in `--env-file` parser does not strip quotes from values; `HOST="0.0.0.0"` passes the literal string `"0.0.0.0"` through, then `app.listen({ host })` does a DNS lookup on it and fails. Same for `PORT=` if it's non-numeric.

### Workaround in place
Operator overrides `HOST=0.0.0.0 PORT=8080` on the command line; `.env` values need to be unquoted plain text.

### Real fix
- Document the strict parser rules in `docs/RUNBOOK.md` (no quotes, no trailing whitespace).
- Optionally swap to `dotenv` or `dotenvx` for forgiving parsing — adds a dep but matches user expectations.
- Add a startup sanity check in `server.ts` that validates `PORT` is a finite integer and `HOST` looks like an IP or hostname, with a clear error before `app.listen`.

---

## 5. CORS allowlist defaults to `localhost:5173` only

**Severity:** Low (deployment hygiene)
**File:** `backend/src/server.ts`
**Discovered:** 2026-05-22, build session

### Symptom
The CORS plugin defaults `origin` to `http://localhost:5173`. Any deploy that runs the room app on a different host without setting `CORS_ORIGINS` will have its session-creation calls blocked.

### Workaround in place
`CORS_ORIGINS` env var is read at startup as a comma-separated allowlist.

### Real fix
Document `CORS_ORIGINS` in `.env.example`. Make production deploy scripts set it explicitly.

---

## 6. Room app UI is unstyled

**Severity:** High (UX)
**File:** all of `room/src/pages/*.tsx`
**Discovered:** 2026-05-22, live test 1

### Symptom
All six pages render with default browser styling — no design system, no preflight UI for mic/camera testing, no candidate-facing affordances.

### Real fix
Separate UI overhaul (planned next session): Tailwind CSS + shadcn/ui design system, real preflight (device pickers, mic VU meter, camera preview), polished InCall (status indicators, transcript caption strip, leave-with-confirm dialog), branded Landing/Completion.
