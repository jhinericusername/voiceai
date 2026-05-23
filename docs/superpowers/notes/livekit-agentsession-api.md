# LiveKit AgentSession 1.5.11 — Scripted-Mode API Findings

**Date:** 2026-05-22
**Status:** pinned — basis for Tasks 1.2, 1.4, 1.6
**Versions:** livekit-agents 1.5.11, livekit-plugins-{deepgram,cartesia,turn-detector} 1.5.11, livekit-plugins-silero TBD-by-Task-1.2.

All signatures below were read directly out of the installed package at
`agent/.venv/lib/python3.12/site-packages/livekit/agents/` on 2026-05-22.
The silero constructor was confirmed from the official docs page
`docs.livekit.io/agents/build/turns/vad/` since the plugin is not yet
installed in the venv.

---

## 1. AgentSession constructor

Exact signature (read via `inspect.signature(AgentSession.__init__)`):

```python
AgentSession(
    *,
    stt: NotGivenOr[stt.STT | STTModels | str] = NOT_GIVEN,
    vad: NotGivenOr[vad.VAD] = NOT_GIVEN,
    llm: NotGivenOr[llm.LLM | llm.RealtimeModel | LLMModels | str] = NOT_GIVEN,
    tts: NotGivenOr[tts.TTS | TTSModels | str] = NOT_GIVEN,
    turn_handling: NotGivenOr[TurnHandlingOptions] = NOT_GIVEN,
    tools: NotGivenOr[list[llm.Tool | llm.Toolset]] = NOT_GIVEN,
    max_tool_steps: int = 3,
    use_tts_aligned_transcript: NotGivenOr[bool] = NOT_GIVEN,
    tts_text_transforms: NotGivenOr[Sequence[TextTransforms] | None] = NOT_GIVEN,
    min_consecutive_speech_delay: float = 0.0,
    userdata: NotGivenOr[Userdata_T] = NOT_GIVEN,
    video_sampler: NotGivenOr[_VideoSampler | None] = NOT_GIVEN,
    aec_warmup_duration: float | None = 3.0,
    ivr_detection: bool = False,
    user_away_timeout: float | None = 15.0,
    session_close_transcript_timeout: float = 2.0,
    conn_options: NotGivenOr[SessionConnectOptions] = NOT_GIVEN,
    loop: asyncio.AbstractEventLoop | None = None,
    preemptive_generation: NotGivenOr[bool] = NOT_GIVEN,
    min_endpointing_delay: NotGivenOr[float] = NOT_GIVEN,
    max_endpointing_delay: NotGivenOr[float] = NOT_GIVEN,
    false_interruption_timeout: NotGivenOr[float | None] = NOT_GIVEN,
    turn_detection: NotGivenOr[TurnDetectionMode] = NOT_GIVEN,
    discard_audio_if_uninterruptible: NotGivenOr[bool] = NOT_GIVEN,
    min_interruption_duration: NotGivenOr[float] = NOT_GIVEN,
    min_interruption_words: NotGivenOr[int] = NOT_GIVEN,
    allow_interruptions: NotGivenOr[bool] = NOT_GIVEN,
    resume_false_interruption: NotGivenOr[bool] = NOT_GIVEN,
    agent_false_interruption_timeout: NotGivenOr[float | None] = NOT_GIVEN,
    mcp_servers: NotGivenOr[list[mcp.MCPServer]] = NOT_GIVEN,
) -> None
```

**Args we use, with rationale**

| arg | value | why |
| --- | --- | --- |
| `stt` | `deepgram.STT(model="nova-3", language="en-US")` | Streaming STT for candidate audio. Deepgram plugin already installed. |
| `tts` | `cartesia.TTS(model="sonic-2", voice=…)` | Streaming TTS for the agent's verbatim questions. |
| `vad` | `silero.VAD.load()` | Voice activity for endpointing. Required so turn_detection="vad" is honored and so the MultilingualModel turn detector has a VAD to gate on (see §7). |
| `turn_handling` | `{"turn_detection": MultilingualModel(), "endpointing": {"min_delay": 0.6, "max_delay": 3.0}}` | Use the new turn_handling dict to avoid hitting the deprecated kwargs path. End-of-turn model gives better endpointing than raw VAD alone. |
| `allow_interruptions` | omit (default True) | Candidate can speak over the agent and interrupt; LiveKitVoiceAgent.speak() may pass `allow_interruptions=False` for question prompts if we want them unbreakable later. |
| `preemptive_generation` | leave default | Irrelevant — we never call `generate_reply()`. |
| `llm` | NOT passed | We script everything via `session.say()`. See §2. |

The deprecated kwargs (`min_endpointing_delay`, `turn_detection`,
`allow_interruptions`, etc. at the top level) still work via
`_migrate_turn_handling()`, but Task 1.2 should pass `turn_handling=`
directly to avoid the deprecation warning that fires for
`turn_detection=` and friends.

---

## 2. LLM-less operation

**Verdict: SUPPORTED.** Constructing `AgentSession` with `llm` omitted is
allowed, and `session.say(text)` works in that mode. The `_generate_reply`
path is the only thing that requires an LLM, and the activity guards it:

`livekit/agents/voice/agent_activity.py:2039` —

```python
elif self.llm is None:
    return  # skip response if no llm is set
```

So when STT finalizes a candidate turn, the framework will NOT try to
autonomously generate a reply. It just emits `user_input_transcribed`,
appends the message to chat ctx, and waits. The Interview Controller
drives the next `session.say(...)` itself. This is exactly the scripted
flow we want.

`AgentSession.say()` only requires a TTS (or RealtimeModel that supports
say) — it does NOT touch `self.llm` at all
(`agent_activity.py:1048-1124`). The relevant guard is:

```python
if (
    not is_given(audio)
    and not self.tts
    and not (isinstance(self.llm, llm.RealtimeModel) and self.llm.capabilities.supports_say)
    and self._session.output.audio
    and self._session.output.audio_enabled
):
    raise RuntimeError("trying to generate speech from text without a TTS model …")
```

Since we pass `tts=cartesia.TTS(...)`, this branch is never raised.

Minimal LLM-less construction:

```python
from livekit.agents import AgentSession
from livekit.plugins import deepgram, cartesia, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

session = AgentSession(
    stt=deepgram.STT(model="nova-3", language="en-US"),
    tts=cartesia.TTS(model="sonic-2"),
    vad=silero.VAD.load(),
    turn_handling={
        "turn_detection": MultilingualModel(),
        "endpointing": {"min_delay": 0.6, "max_delay": 3.0},
    },
)
```

---

## 3. AgentSession.start signature

```python
AgentSession.start(
    self,
    agent: Agent,                                       # POSITIONAL, REQUIRED
    *,
    capture_run: bool = False,
    room: NotGivenOr[rtc.Room] = NOT_GIVEN,
    room_options: NotGivenOr[room_io.RoomOptions] = NOT_GIVEN,
    record: NotGivenOr[bool | RecordingOptions] = NOT_GIVEN,
    room_input_options: NotGivenOr[room_io.RoomInputOptions] = NOT_GIVEN,
    room_output_options: NotGivenOr[room_io.RoomOutputOptions] = NOT_GIVEN,
) -> RunResult | None
```

**Yes**, an `Agent` instance is required. The minimum for a scripted
flow is `Agent(instructions="...")` — the only required Agent kwarg is
`instructions` (str or `Instructions`). All other Agent kwargs (`stt`,
`tts`, `vad`, `llm`, `tools`, etc.) default to NOT_GIVEN and fall back
to the AgentSession-level values.

Agent ctor:

```python
Agent(
    *,
    instructions: str | Instructions,                   # ONLY required arg
    id: str | None = None,
    chat_ctx: NotGivenOr[llm.ChatContext | None] = NOT_GIVEN,
    tools: list[llm.Tool | llm.Toolset] | None = None,
    stt: NotGivenOr[stt.STT | STTModels | str | None] = NOT_GIVEN,
    vad: NotGivenOr[vad.VAD | None] = NOT_GIVEN,
    turn_handling: NotGivenOr[TurnHandlingOptions] = NOT_GIVEN,
    llm: NotGivenOr[llm.LLM | llm.RealtimeModel | LLMModels | str | None] = NOT_GIVEN,
    tts: NotGivenOr[tts.TTS | TTSModels | str | None] = NOT_GIVEN,
    min_consecutive_speech_delay: NotGivenOr[float] = NOT_GIVEN,
    use_tts_aligned_transcript: NotGivenOr[bool] = NOT_GIVEN,
    turn_detection: NotGivenOr[TurnDetectionMode | None] = NOT_GIVEN,
    min_endpointing_delay: NotGivenOr[float] = NOT_GIVEN,
    max_endpointing_delay: NotGivenOr[float] = NOT_GIVEN,
    allow_interruptions: NotGivenOr[bool] = NOT_GIVEN,
    mcp_servers: NotGivenOr[list[mcp.MCPServer] | None] = NOT_GIVEN,
)
```

For our scripted flow, the `instructions` string is essentially ignored
by runtime behavior (the framework would feed it to an LLM, but we have
no LLM). We still pass something meaningful for observability, e.g.:

```python
agent = Agent(instructions="Puddle voice interviewer. All speech is "
                           "driven by the Interview Controller via "
                           "session.say(); do not synthesize replies.")
await session.start(agent, room=ctx.room)
```

---

## 4. session.say(text)

Signature:

```python
AgentSession.say(
    self,
    text: str | AsyncIterable[str],
    *,
    audio: NotGivenOr[AsyncIterable[rtc.AudioFrame]] = NOT_GIVEN,
    allow_interruptions: NotGivenOr[bool] = NOT_GIVEN,
    add_to_chat_ctx: bool = True,
) -> SpeechHandle
```

**Return is SYNCHRONOUS** — `say()` itself returns a `SpeechHandle`
without `await`. The handle is awaitable: `SpeechHandle.__await__` calls
`await self.wait_for_playout()` which awaits `asyncio.shield(self._done_fut)`.
So both of these forms are correct and equivalent for "wait until
playout completes":

```python
handle = session.say(text)
await handle                           # form A: await the handle itself

handle = session.say(text)
await handle.wait_for_playout()        # form B: explicit method
```

The combined idiomatic form `await session.say(text)` works because
`say()` returns an awaitable. Use it as the default.

**`SpeechHandle` public surface** (`speech_handle.py`):

```
add_done_callback(callback)        # sync
remove_done_callback(callback)
done() -> bool
interrupt(*, force: bool = False) -> SpeechHandle    # SYNC, returns self
wait_for_playout() -> None         # ASYNC (despite annotation showing -> None)
__await__                          # awaits wait_for_playout
```

`speak()` adapter shape for `LiveKitVoiceAgent.speak`:

```python
async def speak(self, text: str, *, allow_interruptions: bool = True) -> None:
    handle = self._session.say(text, allow_interruptions=allow_interruptions)
    try:
        await handle  # waits for full playout (incl. queued playback)
    except asyncio.CancelledError:
        # caller cancelled the speak (e.g. interview aborted); make sure
        # we don't leave the TTS half-spoken
        handle.interrupt(force=True)
        raise
```

Notes:

- `say()` schedules the speech at `SPEECH_PRIORITY_NORMAL` and queues it
  behind any in-flight speech, so back-to-back calls play sequentially
  without us having to gate them.
- `add_to_chat_ctx=True` (default) appends the spoken text as an
  assistant ChatMessage. For us this is fine — it just gives the chat
  history a transcript of what we said.

---

## 5. session.interrupt()

```python
AgentSession.interrupt(self, *, force: bool = False) -> asyncio.Future[None]
```

**Returns an `asyncio.Future`** (not a coroutine). The implementation
delegates to `self._activity.interrupt(force=force)` and immediately
returns the future, which resolves once the interruption is fully
processed and the chat context has been updated. You can either:

```python
session.interrupt()             # fire-and-forget
await session.interrupt()       # wait for the interrupt to settle
```

`SpeechHandle.interrupt(*, force=False)` is **synchronous** (returns
the handle itself). Use it when you already hold the handle from a
prior `session.say(...)`.

---

## 6. Listen path — final candidate transcripts

**Event name:** `"user_input_transcribed"` (string literal, registered
in `EventTypes` in `voice/events.py:91-104`).

**Payload** (`UserInputTranscribedEvent`, `voice/events.py:124-130`):

```python
class UserInputTranscribedEvent(BaseModel):
    type: Literal["user_input_transcribed"] = "user_input_transcribed"
    transcript: str
    is_final: bool
    speaker_id: str | None = None
    language: LanguageCode | None = None
    created_at: float = Field(default_factory=time.time)
```

**Subscription** — `AgentSession` extends `EventEmitter`. `on()`
signature:

```python
session.on(event: EventTypes, callback: Callable | None = None) -> Callable
```

The callback is **synchronous** (the emitter calls it directly). To do
async work (e.g. push into an asyncio.Queue that the Interview
Controller awaits on), schedule it with `asyncio.create_task` or
`loop.call_soon_threadsafe(queue.put_nowait, ...)`.

Minimal subscriber:

```python
import asyncio
from livekit.agents.voice.events import UserInputTranscribedEvent

_final_transcripts: asyncio.Queue[str] = asyncio.Queue()

def _on_user_input_transcribed(ev: UserInputTranscribedEvent) -> None:
    if ev.is_final and ev.transcript.strip():
        _final_transcripts.put_nowait(ev.transcript)

session.on("user_input_transcribed", _on_user_input_transcribed)

# Later, in the Interview Controller:
async def listen(self, *, timeout_s: float) -> str:
    return await asyncio.wait_for(_final_transcripts.get(), timeout=timeout_s)
```

We only consume `is_final=True` events; interim transcripts surface as
the same event with `is_final=False`. The framework also emits
`"conversation_item_added"` after the activity persists the message,
but `user_input_transcribed` fires first and carries the raw transcript,
which is what the deterministic controller needs.

---

## 7. VAD + turn detection

**Silero VAD plugin** (not yet installed; from docs):

```python
from livekit.plugins import silero

vad = silero.VAD.load(
    min_speech_duration=0.05,        # float, default 0.05
    min_silence_duration=0.55,       # float, default 0.55
    prefix_padding_duration=0.5,     # float, default 0.5
    max_buffered_speech=60.0,        # float, default 60.0
    activation_threshold=0.5,        # float, default 0.5
    sample_rate=16000,               # Literal[8000, 16000], default 16000
    force_cpu=True,                  # bool, default True
)
```

For Task 1.2 the no-arg `silero.VAD.load()` is fine; we can tune
`min_silence_duration` later if endpointing is too eager.

**`turn_detection=` accepted values** (from
`voice/turn.py:31`):

```python
TurnDetectionMode = Literal["stt", "vad", "realtime_llm", "manual"] | _TurnDetector
```

Where `_TurnDetector` is the Protocol that the turn-detector plugin's
`MultilingualModel` implements. Inspected MRO and methods:

```
MultilingualModel(EOUModelBase, ABC, object)
  public: model, predict_end_of_turn, provider, supports_language, unlikely_threshold
  ctor:   MultilingualModel(*, unlikely_threshold: float | None = None)
```

The `_validate_turn_detection` path in `agent_activity.py:231-304`
shows: if `turn_detection` is a `_TurnDetector` (not a string), it is
used directly. The `MultilingualModel` is a pure end-of-turn classifier
that operates on the running `ChatContext`; it does not need an LLM
present.

**Decision:** for Task 1.2 pass:

```python
turn_handling={
    "turn_detection": MultilingualModel(),
    "endpointing": {"min_delay": 0.6, "max_delay": 3.0},
}
```

Rationale: with no LLM and short scripted prompts, the multilingual EOU
model gives noticeably better end-of-turn precision than `"vad"` alone,
particularly when the candidate pauses mid-thought. The `min_delay`
override gives the model a slightly larger window than the default
`0.5` to handle deliberate pauses common in interview answers.

If the MultilingualModel adds undesired startup latency or fails to
load offline, the fallback is `turn_detection="vad"` with `vad=
silero.VAD.load()`.

---

## 8. JobContext

```python
JobContext.connect(
    self,
    *,
    encryption: rtc.E2EEOptions | None = None,
    auto_subscribe: AutoSubscribe = AutoSubscribe.SUBSCRIBE_ALL,
    rtc_config: rtc.RtcConfiguration | None = None,
    e2ee: rtc.E2EEOptions | None = None,
) -> None
```

Call as: `await ctx.connect()`.

**Metadata access:**

- `ctx.job.metadata` — `str`, the per-job dispatch metadata. This is
  the JSON string we'll pack from the backend with `{interview_id,
  candidate_id, …}` when we dispatch the worker. `Job` is the protobuf
  message with fields `id, dispatch_id, type, room, participant,
  namespace, metadata, agent_name, state, enable_recording, deployment`.
- There is no `ctx.metadata` shortcut — go through `ctx.job.metadata`.

**Room access:**

- `ctx.room` returns the `rtc.Room` (only valid after `connect()`).
- `ctx.room.name` for the room name (post-connect).
- `ctx.room.local_participant` for the agent's participant; also
  exposed as `ctx.agent`.

`ctx.wait_for_participant(identity=..., kind=...)` is the right
primitive to block until the candidate joins. `ctx.add_shutdown_callback`
is the place to drain the runner / finalize the assessment when the
job ends.

---

## 9. Decisions that pin downstream tasks

- **Task 1.2 `build_agent_session(...)` will pass:**
  - `stt=deepgram.STT(model="nova-3", language="en-US")` (or pulled
    from config)
  - `tts=cartesia.TTS(model="sonic-2", voice=<config>)`
  - `vad=silero.VAD.load()` (Task 1.2 adds the dep)
  - `turn_handling={"turn_detection": MultilingualModel(),
    "endpointing": {"min_delay": 0.6, "max_delay": 3.0}}`
  - NO `llm=` kwarg.

- **Task 1.4 `LiveKitVoiceAgent.speak` will:**
  - `handle = self._session.say(text, allow_interruptions=...)`
  - `await handle` (== `await handle.wait_for_playout()`) to block until
    full playout completes
  - On `CancelledError`, call `handle.interrupt(force=True)` (sync) to
    stop the TTS before re-raising

- **Task 1.4 `LiveKitVoiceAgent.listen` event subscription:**
  - Register sync callback via
    `session.on("user_input_transcribed", cb)` where `cb` filters
    `ev.is_final and ev.transcript.strip()` and pushes `ev.transcript`
    into an `asyncio.Queue` owned by the adapter
  - `listen(timeout_s)` does `await asyncio.wait_for(queue.get(),
    timeout=timeout_s)`
  - Unregister with `session.off("user_input_transcribed", cb)` (off()
    is inherited from EventEmitter) during shutdown

- **Task 1.6 `entrypoint` will call (in order):**
  1. `await ctx.connect()` (with default `auto_subscribe=SUBSCRIBE_ALL`)
  2. `metadata = json.loads(ctx.job.metadata or "{}")` to pull
     `interview_id` / `candidate_id`
  3. Optional: `await ctx.wait_for_participant(identity=<candidate>)`
     to gate startup on the candidate actually joining
  4. `session = build_agent_session(...)` (Task 1.2)
  5. `agent = Agent(instructions=<short scripted-mode marker>)`
  6. `await session.start(agent, room=ctx.room)`
  7. Construct `LiveKitVoiceAgent(session, ...)` and run the
     `InterviewRunner` to completion
  8. Register `ctx.add_shutdown_callback(...)` to persist the assessment

---

## 10. Open issues / live-test risks

- **Cartesia stream stability.** Long single `say()` calls (an entire
  multi-sentence question) sometimes show TTS reconnect blips on flaky
  networks. We won't know until Task 4.2 whether question prompts need
  to be chunked. Mitigation if it bites: break each question into
  sentence-level `say()` calls awaited sequentially.
- **MultilingualModel cold start.** First-load can pull a model file
  from cache or remote; that can stall the first turn by a few seconds.
  Confirmed acceptable only by Task 4.2. Fallback is `turn_detection=
  "vad"`.
- **Deepgram `is_final` definition.** Deepgram's "final" event includes
  intermediate "is_final but not endpointed" results in some configs.
  We treat the AgentSession's `UserInputTranscribedEvent.is_final` as
  authoritative, since the framework normalizes across STT providers.
  If we still see double-fires in Task 4.2, the controller should dedupe
  by `created_at` within a small window.
- **`session.say` vs simultaneous candidate audio.** Since
  `allow_interruptions` defaults True, a candidate who talks while the
  agent is reading a question will cut the agent off. For the question
  prompts we likely want `allow_interruptions=False` to guarantee the
  full prompt is heard. Task 1.4 should expose this as a parameter on
  `speak()`. Final decision deferred to Task 1.4 review.
- **AEC warmup.** Default `aec_warmup_duration=3.0s` means the first
  three seconds of agent speech can't be interrupted at all. This is
  actually desirable for us (the opening greeting must finish), so we
  leave it at the default.
- **No `manual-gate` op runs from this spike** — no code changed, no
  package installed, no migration applied.
