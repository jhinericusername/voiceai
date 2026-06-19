# Inworld Realtime Connectivity + Voice + Tools Spike Findings

Date: 2026-06-18
Branch: prakul-script-extraction
Evidence base: `tmp/inworld-spike/` (gitignored)

## Summary

Three capabilities were tested against the Inworld Realtime API. Auth/connect (B1) and voice
fidelity (B2) are proven. Tool round-trip (B3) has a confirmed failure mode that requires a
design accommodation before production integration.

| Capability | Result |
|---|---|
| B1: Auth + WS connect | WORKS |
| B2: Verbatim speech + WAV output | WORKS (with embellishment caveat) |
| B3: Tool round-trip (advance_question) | FAIL — model silent after function_call_output |
| Accent (Jarrah en-AU) | PENDING HUMAN EAR-TEST |

---

## 1. Session-creation and WS-auth flow (working form — no secrets)

Connect directly to:
```
wss://api.inworld.ai/api/v1/realtime/session?key=<caller-generated-UUID>&protocol=realtime
```
Header: `Authorization: Basic $INWORLD_API_KEY`

The Inworld API key from the portal is already Base64-encoded; pass it verbatim as the Basic
credential. No HTTP pre-flight or token exchange is needed. The caller generates a fresh UUID
as the `key=` query parameter for each session.

**Deltas from initial assumptions:**
- Path is `/api/v1/realtime/session`, not `/v1/realtime`
- No HTTP pre-flight; caller generates `key=<UUID>` as session-id
- `protocol=realtime` is a required query param
- `language` nests under `audio.output`, not at session root
- `tool_choice: "auto"` required for tools to fire

**session.update shape (verified):**
```json
{
  "type": "session.update",
  "session": {
    "type": "realtime",
    "model": "anthropic/claude-haiku-4-5",
    "instructions": "<string>",
    "output_modalities": ["audio", "text"],
    "audio": {
      "input": {"transcription": {"model": "inworld/inworld-stt-1"}},
      "output": {"voice": "Jarrah", "model": "inworld-tts-2", "language": "en-AU"}
    },
    "tools": [...],
    "tool_choice": "auto"
  }
}
```

---

## 2. Latency / TTFB

Measured from the Task 1 + Task 2 live runs:

| Metric | Value |
|---|---|
| WS connect (handshake) | 247 ms |
| TTFB (first event after response.create) | 247 ms |
| Audio TTFB (first PCM delta) | ~2,552 ms |

Audio TTFB of ~2.5 s is higher than the ~1–1.5 s target for conversational feel. This is
consistent with Inworld TTS buffering behavior. The `tts.delivery_mode` providerData knob
(deferred to B2) may improve this; see section 6.

---

## 3. Verbatim fidelity + embellishment caveat

**Result: WORKS — verbatim phrase is present but embedded in embellished speech.**

The model spoke the approved Q1 verbatim text word-for-word, confirmed by key-phrase matching
(`technically complex`, `clever`, `hacky`, `novel solution` all matched). However the model
added substantial preamble and elaboration around the verbatim text.

**Embellishment pattern observed:**

Approved verbatim Q1:
> "Well, I guess the first question I have is, can you tell me about the time you solved a
> technically complex problem with a clever or hacky or novel solution, some roundabout way?"

Actual spoken output:
> "Awesome. Awesome. Awesome. That sounds great — distributed systems is some really meaty
> stuff. Five years of experience, that's solid.
>
> So let me dive in. My first question is: **can you tell me about the time you solved a
> technically complex problem with a clever or hacky or novel solution, some roundabout way?**
>
> I'm really looking for a situation where maybe the obvious textbook answer would've been one
> thing, but you found a smarter or more creative way around it. What comes to mind?"

**Embellishment ratio: approximately 3:1** (total spoken words vs. verbatim words). The verbatim
phrase is correctly embedded but surrounded by filler, acknowledgment, and elaboration. The
model cannot be relied on to speak ONLY the verbatim text without added framing. For the
interview design this means:
- The rubric question IS asked verbatim (no paraphrase)
- The candidate hears additional framing before and after — acceptable for interview UX
- The design should not depend on the model speaking EXACTLY the verbatim text and nothing else

**Accent:** PENDING HUMAN EAR-TEST. `out.wav` (36.5 s PCM, 1,751,040 bytes) was produced during
the spike; a human must listen to confirm recognizable Australian Jarrah voice.

---

## 4. Tool round-trip — B3 FAIL (definitive)

**B3 VERDICT: FAIL**

The `advance_question` tool fires correctly with the right arguments. After sending
`function_call_output` (carrying Q2 verbatim text) + `response.create`, the model produces
an empty response: `response.created` → `response.done` with zero content items between them.

**Post-tool event sequence (clean B3 run, 2026-06-18):**
```
conversation.item.added       ← function_call_output item queued
conversation.item.done
response.created
response.done                 ← immediate, no transcript/audio deltas
```

The model is completely silent. No audio, no text, no tool calls.

**Workarounds attempted (2 live sessions):**
- Workaround A: `response.create` with explicit `response.instructions` override telling the
  model to read the Q2 text verbatim — not exercised against a post-tool empty-response because
  the setup path (getting a clean tool call within budget) failed in the workaround session.
- Workaround B: `session.update tool_choice: "none"` + `response.create` with instructions
  — same; not exercised against the post-tool failure.

The workaround sessions did not produce a tool call within the 4-turn budget (the model kept
asking Q1 follow-up questions instead of calling `advance_question`). This is a separate
finding: the tool-call trigger is unreliable under compressed Q1 answers that include explicit
"call advance_question" nudge text — the model ignores the explicit instruction and continues
probing Q1 instead.

**Resolution path for B2 (production):**
The empty-response failure after `function_call_output` is consistent with a known Inworld
behavior where the model treats a tool-only response turn as complete and does not auto-generate
a follow-up speech turn. The mitigation is to send the next question text as a separate
`conversation.item.create` message (type `"message"`, role `"assistant"`) after the
`function_call_output` item, seeding the assistant speech text, rather than relying on the model
to read the tool output and speak it. This avoids the empty-response problem entirely and also
side-steps the verbatim-fidelity embellishment issue — the adapter controls exactly what text is
spoken. This approach must be verified in B2.

---

## 5. providerData knobs (not tested, deferred to B2)

Available knobs per Inworld docs (none were tried in this spike):
- `stt.voice_profile`
- `tts.segmenter_strategy` — may affect chunking + latency
- `tts.delivery_mode` — may reduce audio TTFB
- `backchannel.enabled`
- `responsiveness.enabled`

Defer these to B2 integration. `tts.delivery_mode` is the highest-priority knob given the
2.5 s audio TTFB.

---

## 6. B2 Recommendation: hand-rolled InworldRealtimeSession adapter

**Recommendation: (b) hand-rolled adapter — NOT LiveKit base_url.**

**Evidence:**

The installed LiveKit `livekit.plugins.openai` plugin (`RealtimeModel`) has `base_url` support,
but it cannot be pointed at Inworld for these reasons:

1. **Auth header mismatch.** The plugin hardcodes `Authorization: Bearer <api_key>` (line 936 of
   `realtime_model.py`). Inworld requires `Authorization: Basic <api_key>`. There is no
   `auth_headers` override parameter.

2. **URL rewriting breaks Inworld's path.** `process_base_url()` (lines 729–776) rewrites the
   path to append `/realtime` (e.g. `https://api.inworld.ai` → `wss://api.inworld.ai/realtime`).
   Inworld's actual path is `/api/v1/realtime/session`. Passing the full path in `base_url`
   is fragile because the function only leaves the path alone when it doesn't match a known
   short-form list (`""`, `"/v1"`, `"/openai"`, `"/openai/v1"`).

3. **Inworld-specific query params.** The `key=<uuid>&protocol=realtime` query params are
   required on every connection and must be freshly generated per session. The plugin has no
   mechanism to inject arbitrary per-session query params.

4. **Event naming.** Inworld uses `response.output_audio.delta` and
   `response.output_audio_transcript.delta` where OpenAI uses `response.audio.delta` and
   `response.audio_transcript.delta`. The plugin's event deserializer uses OpenAI's Pydantic
   types and would reject or silently drop Inworld's event shapes.

The `livekit_adapter.py` currently wires `LiveKitRealtimeSession` → `openai.realtime.RealtimeModel`
targeting OpenAI. For the Inworld integration, a parallel `InworldRealtimeSession` adapter is
needed that:
- Opens the raw WS connection directly with `websockets` (as proven in the spike)
- Handles Inworld's event names
- Implements the same `RealtimeSession` protocol surface (`start`, `events`, `respond_to_tool`,
  `inject_message`, `aclose`)
- Bridges LiveKit room audio I/O to the Inworld WS (PCM 24kHz in/out)
- Sends the next question as an assistant message item after `function_call_output` (the B3
  mitigation)

B2 must verify: (a) audio TTFB with `tts.delivery_mode` knob, (b) the assistant-message
injection mitigation for tool round-trip, (c) human ear-test of Jarrah accent from `out.wav`.
