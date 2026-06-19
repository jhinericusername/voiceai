# Inworld Voice Integration (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give the realtime interviewer an Australian voice (Jarrah) via Inworld Realtime, keeping our control tools and Claude-Haiku brain — spike-first, so we prove the protocol/voice/tools before building the production LiveKit↔Inworld bridge.

**Architecture:** Inworld Realtime is OpenAI-Realtime-protocol-compatible (a managed STT→LLM→TTS cascade) but needs a session-id pre-flight (HTTP) + `key=<session-id>` on the WS, NOT Bearer auth. The realtime path already speaks a `RealtimeSession` protocol (`agent/src/agent/voice/realtime/interface.py`) with swappable adapters; Inworld becomes a new adapter. **B1 (this plan) is the connectivity spike. B2 (the production LiveKit-room bridge) gets its own plan, written from B1's findings — because the bridge's exact shape (whether LiveKit's `RealtimeModel(base_url=…)` can carry the session-id auth, or we hand-roll the WS) is the unknown the spike exists to resolve.**

**Tech Stack:** Python (uv); Inworld Realtime WS API; base `websockets`/`httpx` already used by the eval `openai_ws_adapter`. No new prod deps for the spike.

## Global Constraints

- Branch `prakul-script-extraction`. Python under `agent/`. Tests/spike: `cd agent && uv run …`.
- Spec: `docs/superpowers/specs/2026-06-18-interviewer-persona-and-inworld-voice-design.md`. Memory `inworld-voice-decision`.
- Decided params (verbatim): provider Inworld Realtime; LLM `anthropic/claude-haiku-4-5`; voice `Jarrah`; `audio.output.model: "inworld-tts-2"`; `language: "en-AU"`; STT `inworld/inworld-stt-1`; `output_modalities: ["audio","text"]`; tools = `advance_question`/`request_probe`/`flag_off_script`/`close_interview`.
- Auth: `INWORLD_API_KEY` (Base64 Key:Secret) is in repo-root `.env`. Realtime WS needs a session-id pre-flight then `key=<session-id>` query param; the WS does NOT accept Bearer-header auth. Base `https://api.inworld.ai`, WS `/v1/realtime`.
- The spike hits the live Inworld API (token-billed) — allowed autonomous (no LiveKit room, no candidate, no deploy). It lives under gitignored `tmp/inworld-spike/`.
- `manual-gate`: the B2 production bridge swap + deploy + real candidate.

---

### Task 1: Inworld session-id pre-flight + authed WS connect

**Files:**
- Create: `tmp/inworld-spike/inworld_client.py`

**Interfaces:**
- Produces: `async def open_inworld_session(instructions: str, tools: list[dict]) -> InworldWS` that does the HTTP session-id pre-flight, opens the WS with `key=<session-id>`, sends the initial `session.update` (model=claude-haiku, Jarrah voice, tts-2, en-AU, stt, modalities, tools), and returns a connected wrapper exposing `send(event: dict)` and `async events()`.

- [ ] **Step 1: Confirm the exact endpoints + payload from the docs.**

Read https://docs.inworld.ai/realtime/connect/websocket and `.../openai-migration` (and `.../usage/using-realtime-models`). Capture: the session-creation HTTP endpoint + how the session id is returned; the WS URL form (`wss://api.inworld.ai/v1/realtime?key=<id>&protocol=realtime` per current notes — VERIFY); the `Authorization: Basic <INWORLD_API_KEY>` header usage for the HTTP pre-flight. Record the exact shapes in a comment at the top of `inworld_client.py`. If the docs contradict the assumptions here, follow the docs and note the delta.

- [ ] **Step 2: Implement the client.**

Write `inworld_client.py` using `httpx` (pre-flight) + `websockets` (the stream). The initial `session.update` payload:
```python
SESSION_UPDATE = {
    "type": "session.update",
    "session": {
        "type": "realtime",
        "model": "anthropic/claude-haiku-4-5",
        "instructions": instructions,
        "output_modalities": ["audio", "text"],
        "audio": {
            "input": {"transcription": {"model": "inworld/inworld-stt-1"}},
            "output": {"voice": "Jarrah", "model": "inworld-tts-2", "language": "en-AU"},
        },
        "tools": tools,  # our 4 control tools, OpenAI function schema
    },
}
```
Read `INWORLD_API_KEY` from repo-root `.env` (absolute path).

- [ ] **Step 3: Smoke the connection.**

Run a `__main__` that opens the session with a one-line instruction ("Say: g'day, this is a test.") and prints the first few received events (expect `session.created`/`session.updated`, then audio/text deltas). 
Run: `cd /Users/pmishra/Repos/voiceai && uv run --env-file .env python tmp/inworld-spike/inworld_client.py`
Expected: a successful WS handshake (no auth error) and streamed events. If auth fails, the session-id flow is wrong — fix from the docs before proceeding. This is the go/no-go on auth + protocol.

- [ ] **Step 4: Commit** (the spike dir is gitignored; commit the report note instead)

```bash
# tmp/ is gitignored; record findings in the spike report (Task 4). No code commit here.
echo "auth+connect verified" 
```

---

### Task 2: Verbatim fidelity + Australian voice check

**Files:**
- Modify: `tmp/inworld-spike/inworld_client.py` (add a scripted-turn driver)

**Interfaces:**
- Consumes: `open_inworld_session(...)`, the real interviewer instructions from `build_interview_plan`.
- Produces: a saved `tmp/inworld-spike/out.wav` (or mp3) of the agent asking Q1 verbatim, plus printed transcript text.

- [ ] **Step 1: Drive a scripted turn with the real instructions.**

Build the actual instructions: `from agent.controller.realtime.plan_builder import build_interview_plan` + `load_rubric("rubric/pilot-v1.yaml")`. Open the Inworld session with those instructions + the 4 tool schemas (`plan_builder._tool_schemas()`). Send a candidate opener turn (`conversation.item.create` with a short candidate message), then `response.create`. Collect the audio deltas → write to a WAV; collect the text.

- [ ] **Step 2: Verify fidelity + accent.**

Run the driver. Confirm: (a) the agent's spoken text matches the approved Q1 wording (verbatim fidelity — the redesign's key property), (b) the saved audio is recognizably an Australian male voice (Jarrah). Listen to the WAV (`open tmp/inworld-spike/out.wav`).
Expected: verbatim Q1, Australian voice. Record sim/notes in the report.

- [ ] **Step 3: Commit** — record findings in the report (Task 4); no code commit (gitignored).

---

### Task 3: Tool-call round-trip through Inworld

**Files:**
- Modify: `tmp/inworld-spike/inworld_client.py`

**Interfaces:**
- Produces: evidence that Inworld emits `response.function_call_arguments.done` for our tools and accepts `function_call_output` back.

- [ ] **Step 1: Force a tool call.**

Drive a turn where the model should call `advance_question` (e.g. after a complete answer) or `request_probe`. Capture the `response.function_call_arguments.done` event (name + arguments). Reply with a `conversation.item.create` of type `function_call_output` carrying the tool result (e.g. the verbatim next question), then `response.create`, and confirm the model speaks the returned text.

- [ ] **Step 2: Verify the loop.**

Run it. Confirm: the tool call fires with the right name/args, our returned text is spoken verbatim. This proves the ControlBus contract survives on Inworld.
Expected: clean tool round-trip. Record in the report.

- [ ] **Step 3: Commit** — report only.

---

### Task 4: Spike report + B2 go/no-go

**Files:**
- Create: `docs/architecture/2026-06-18-inworld-spike-findings.md`

- [ ] **Step 1: Write the findings.**

Document: exact session-creation + WS-auth flow that worked (or didn't); verbatim-fidelity result; voice/accent confirmation; tool round-trip result; latency observations (TTFB if measurable); any `providerData` knobs tried (back-channel/responsiveness); and the **B2 recommendation** — specifically whether the production bridge should (a) point LiveKit's `openai.realtime.RealtimeModel(base_url=…)` at Inworld (if the session-id auth can be carried) or (b) hand-roll an `InworldRealtimeSession` adapter bridging LiveKit room audio ↔ the WS. State which, with evidence.

- [ ] **Step 2: Commit the report.**

```bash
git add docs/architecture/2026-06-18-inworld-spike-findings.md
git commit -m "docs(spike): Inworld realtime connectivity + voice + tools findings; B2 recommendation"
```

- [ ] **Step 3: Hand off to B2 planning.**

The spike findings determine the B2 plan. Write `docs/superpowers/plans/2026-06-18-inworld-voice-b2.md` (the production adapter) from the recommendation — out of scope for this plan; B1's job is to make B2 plannable with real facts.

## Manual-gate follow-up (B2, NOT this plan)
- Build the `InworldRealtimeSession` production adapter (LiveKit room ↔ Inworld WS) per the spike recommendation.
- Configure barge-in (`turn_detection: semantic_vad` + interrupt) and back-channel/responsiveness `providerData`.
- Swap the entrypoint default from OpenAI `gpt-realtime` to Inworld; deploy; live room smoke test; real candidate — all manual-gate.

## Self-Review (completed)
- **Spec coverage:** B-decided params (Task 1 session config), B1 spike auth/fidelity/voice/tools (Tasks 1–3), spike report + B2 go/no-go (Task 4). B2 production bridge + barge-in + back-channel are explicitly deferred to their own plan (spike-gated, per spec) — not a placeholder, a sequencing decision.
- **Placeholder scan:** the session payload + endpoints are concrete; Task 1 Step 1 verifies them against live docs before coding (correct for an external API).
- **Type consistency:** `open_inworld_session(instructions, tools)` used consistently across Tasks 1–3.
