# Realtime Plugin Capability Findings — De-risk Gate for Task 9/11

**Date:** 2026-06-17
**Resolved versions:** livekit-plugins-openai=1.5.11, livekit-agents=1.5.11 (was `>=0.12` in pyproject.toml; locked to 1.x)
**Regression suite:** 220 passed / 0 failed — GREEN

---

## Step 0 — Install + Compat

`uv add livekit-plugins-openai>=1.5.11` resolved the entire livekit-* ecosystem to 1.5.11 in lock-step:

| Package | Resolved version |
|---|---|
| livekit | 1.1.8 |
| livekit-agents | 1.5.11 |
| livekit-api | 1.1.0 |
| livekit-plugins-openai | 1.5.11 |
| livekit-plugins-cartesia | 1.5.11 |
| livekit-plugins-deepgram | 1.5.11 |
| livekit-plugins-silero | 1.5.11 |
| livekit-plugins-turn-detector | 1.5.11 |

The 0.12 → 1.x bump is a major version bump. The regression suite stayed **fully green** (220/220), confirming the cascade voice path (livekit-agents STT/TTS/worker imports) is unbroken.

---

## Q1 — Candidate input transcription

**PASS.**

The plugin handles the server event `conversation.item.input_audio_transcription.completed` and emits it upward as `input_audio_transcription_completed` carrying an `InputTranscriptionCompleted` dataclass.

Source evidence:
- `realtime_model.py:1071-1079` — handler dispatch for `conversation.item.input_audio_transcription.completed`
- `realtime_model.py:1762-1780` — `_handle_conversion_item_input_audio_transcription_completed` emits `"input_audio_transcription_completed"` with `llm.InputTranscriptionCompleted(item_id, transcript, is_final=True, confidence)`
- `livekit/agents/llm/realtime.py:148-155` — `InputTranscriptionCompleted` dataclass: fields `item_id: str`, `transcript: str`, `is_final: bool`, `confidence: float | None`

**Subscription:** subscribe to `session.on("input_audio_transcription_completed", cb)` on the `RealtimeSession`. This fires once per user turn, after speech stops, with the complete transcript. The adapter maps this to `InputTranscript(text=event.transcript)`.

**Requirement:** `input_audio_transcription` must be set (e.g. `AudioTranscription(model="gpt-4o-transcribe")`) when constructing `RealtimeModel`, otherwise transcription is disabled (`realtime_model.py:1647`).

---

## Q2 — Agent output transcription with clean per-turn boundaries

**PASS.**

The plugin accumulates agent audio-transcript deltas per response item and closes the stream on `response.output_item.done`.

Source evidence:
- `realtime_model.py:1083-1084` — `response.output_audio_transcript.delta` → `_handle_response_audio_transcript_delta` appends delta to `item_generation.audio_transcript` and sends to `text_ch`
- `realtime_model.py:1841-1858` — `response.output_item.done` → `_handle_response_output_item_done` closes `text_ch` and `audio_ch` for the message item; this is the end-of-turn boundary
- `realtime_model.py:1876-1904` — `response.done` → `_handle_response_done` closes `function_ch` and `message_ch`, sets `_done_fut`, clears `_current_generation`

**Turn boundary signal:** `text_ch` channel close (on `response.output_item.done`) = end of that turn's transcript. The adapter collects the full accumulated `audio_transcript` string from the `ChatMessage` written to `remote_chat_ctx` at `response.done` (`realtime_model.py:1896-1901`).

**Guardrail hook point:** subscribe to `"generation_created"` to get the `GenerationCreatedEvent`, consume `message_stream` until channel closes, then emit `OutputTranscript(text=accumulated_text)`.

---

## Q3 — Model tool/function calls surface + answer path

**PASS.**

Function calls are surfaced via a dedicated `function_ch` channel on each `_ResponseGeneration`. The answer path uses `update_chat_ctx` to push a `FunctionCallOutput` item (which the plugin converts to a `conversation.item.create` WS event with `type="function_call_output"`), then calls `generate_reply` to trigger the next response.

Source evidence:
- `realtime_model.py:1846-1874` — `response.output_item.done` with `type="function_call"` → `_handle_function_call` sends `llm.FunctionCall(id, call_id, name, arguments)` to `function_ch`
- `livekit/agents/llm/chat_context.py:343` — `FunctionCall` fields: `id`, `call_id`, `name`, `arguments: str` (JSON string)
- `realtime_model.py:1500-1544` — `generate_reply(instructions=..., tool_choice=..., tools=...)` sends `response.create` WS event; returns a future for `GenerationCreatedEvent`
- Plugin utils `utils.py:143-150` — `livekit_item_to_openai_item` maps `FunctionCallOutput` → `RealtimeConversationItemFunctionCallOutput(type="function_call_output", call_id, output)` sent via `conversation.item.create`
- `agent_activity.py:3487-3490` — realtime tool path: after tool execution, pushes `FunctionCallOutput` into a copied `chat_ctx` and calls `self._rt_session.update_chat_ctx(chat_ctx)`; then at line 3501-3521 calls `self._rt_session.generate_reply()` (manual, since `auto_tool_reply_generation=False` per `realtime_model.py:419`)

**Adapter mapping:** `ToolCall.call_id` = `FunctionCall.call_id`; `ToolCall.name` = `FunctionCall.name`; `ToolCall.arguments` = `json.loads(FunctionCall.arguments)`. `respond_to_tool(call_id, output)` must push a `FunctionCallOutput` item and then call `generate_reply`.

---

## Q4 — Out-of-band injection mid-session

**PASS (with documented fallback).**

`generate_reply(instructions=str)` is the primary injection mechanism. It sends a `response.create` WS event with per-response `instructions` that are appended to the session-level instructions.

Source evidence:
- `realtime_model.py:1500-1544` — `RealtimeSession.generate_reply(*, instructions=..., tool_choice=..., tools=...)`. When `instructions` is given and `self._instructions` is set, the final instruction passed is `f"{session_instructions}\n{injected_text}"` (line 1511-1514).
- `realtime_model.py:1453-1463` — `update_instructions(instructions: str)` sends a `session.update` WS event with new `instructions` and persists as `self._instructions`; affects all subsequent responses.

**Adapter `inject_message(text)`** can be implemented as:
1. `await session.update_instructions(new_instructions)` — replaces session instructions immediately (persistent), or
2. `session.generate_reply(instructions=text)` — one-shot steering for the next response only (non-persistent, appended to existing session instructions).

Both primitives are available and unconditional. Option 2 maps most cleanly to the `inject_message` contract (fire-and-forget steering without replacing standing instructions).

---

## Q5 — GA realtime session config schema

**CONFIRMED.**

The installed plugin uses `output_modalities` (not `modalities`) in the `RealtimeSessionCreateRequest`, confirming the GA schema. The beta/Azure path explicitly maps `output_modalities` → `modalities` for backwards compatibility.

Source evidence:
- `realtime_model.py:1163-1166` — `RealtimeSessionCreateRequest(type="realtime", model=..., output_modalities=[modality], audio=RealtimeAudioConfig(...))`
- `realtime_model.py:155-161` — `_oai_session_to_azure`: "Flatten `output_modalities` → `modalities` (Azure uses the old field name)"
- `openai.types.realtime.RealtimeSessionCreateRequest` from the `openai` SDK (imported at line 68) is the GA type; `openai.types.beta.realtime.*` is the legacy beta type

GA session config shape confirmed:
```
{
  "type": "realtime",
  "model": "gpt-realtime",
  "output_modalities": ["audio"],    # NOT "modalities"
  "audio": {
    "input":  { "format": {...}, "transcription": {...}, "turn_detection": {...} },
    "output": { "format": {...}, "voice": "...", "speed": 1.0 }
  },
  "max_output_tokens": ...,
  "instructions": "..."
}
```

---

## Verdict Table

| Primitive | Status | Contract method backed | Evidence (file:line) |
|---|---|---|---|
| Candidate input transcription | **PASS** | `events()` → `InputTranscript` | `realtime_model.py:1071, 1762-1780` |
| Agent output transcript + turn boundary | **PASS** | `events()` → `OutputTranscript` | `realtime_model.py:1841-1858, 1896-1901` |
| Tool call surface + answer path | **PASS** | `events()` → `ToolCall`; `respond_to_tool()` | `realtime_model.py:1846-1874, utils.py:143-150` |
| Out-of-band injection | **PASS** | `inject_message()` | `realtime_model.py:1500-1514, 1453-1463` |
| GA session config (`output_modalities`) | **CONFIRMED** | `start()` config | `realtime_model.py:1163-1166` |

---

## GATE VERDICT: ALL-CLEAR

All three hard-required primitives PASS:
1. Input transcription — `input_audio_transcription_completed` event, `InputTranscriptionCompleted.transcript`
2. Output transcription with turn boundary — `text_ch` close on `response.output_item.done`
3. Tool call surface + answer path — `function_ch` → `FunctionCall`; tool output via `update_chat_ctx` + `generate_reply`

GA session config confirmed (`output_modalities`, not `modalities`).

Injection available via `generate_reply(instructions=...)` (one-shot) or `update_instructions(...)` (persistent).

**Regression suite: 220 passed, 0 failed — GREEN.**

Task 9 (OpenAI realtime adapter) and Task 11 (guardrail integration) are unblocked.

### Compat friction notes
- `livekit-agents` jumped from `>=0.12` spec to `1.5.11` resolved. No existing tests broke, but the pyproject.toml spec `>=0.12` is now misleading — it pins to 1.x in practice via uv.lock.
- `input_audio_transcription` must be explicitly set on `RealtimeModel` at construction; the adapter's `start()` must pass this config or transcription silently won't fire.
- `auto_tool_reply_generation=False` for this plugin (`realtime_model.py:419`): tool output must be manually pushed via `update_chat_ctx` + `generate_reply`. The adapter owns this loop.
