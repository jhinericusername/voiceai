"""Production LiveKit `RealtimeModel` adapter for the realtime interview.

This drives OpenAI `gpt-realtime` through LiveKit's `RealtimeModel`/`AgentSession`
and exposes it via the `RealtimeSession` protocol, so the runner can treat it
identically to the test `FakeRealtimeSession`.

The vendor I/O — `RealtimeModel`/`AgentSession` construction, handler
registration, room join, and the `generate_reply`/`update_chat_ctx` calls — is
inherently untestable in unit tests and is marked `# pragma: no cover`. Only the
pure parts carry real unit tests: the event-translation helpers, the `events()`
queue drain, and the ported participant-lifecycle callbacks.

API specifics follow the Task 8 capability findings
(`docs/architecture/2026-06-17-realtime-plugin-capabilities.md`), which is
authoritative for the installed livekit-agents 1.x realtime surface.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import AsyncIterator, Callable
from typing import Any

from agent.voice.realtime.interface import (
    InputTranscript,
    OutputTranscript,
    RealtimeEvent,
    ToolCall,
)

logger = logging.getLogger(__name__)

_INSTRUCTIONS_FALLBACK = "You are Puddle's realtime interviewer."
_DEFAULT_RECONNECT_GRACE_SECONDS = 300.0
_TRANSCRIPTION_MODEL = "gpt-4o-transcribe"


class _EndSentinel:
    """Single-instance marker that terminates the `events()` async generator."""

    __slots__ = ()


_END = _EndSentinel()

ParticipantStateCallback = Callable[[], None]


class ParticipantDisconnectedError(RuntimeError):
    """Raised when the linked participant does not reconnect within the grace window."""


def _attribute_ready(attributes: Any) -> bool:
    """True when participant attributes carry ``ready == 'true'``."""
    if not attributes:
        return False
    try:
        return str(attributes.get("ready", "")).strip().lower() == "true"
    except AttributeError:
        return False


def _to_input_transcript(event: Any) -> InputTranscript:
    """Map a plugin ``InputTranscriptionCompleted`` event to ``InputTranscript``.

    The vendor event carries ``transcript`` (the full final candidate turn).
    """
    return InputTranscript(text=str(getattr(event, "transcript", "")))


def _to_output_transcript(accumulated_text: str) -> OutputTranscript:
    """Map an accumulated agent turn transcript to ``OutputTranscript``."""
    return OutputTranscript(text=accumulated_text)


def _to_tool_call(event: Any) -> ToolCall:
    """Map a plugin ``FunctionCall`` event to a protocol ``ToolCall``.

    ``FunctionCall.arguments`` is a JSON string; the protocol carries a dict.
    """
    raw = getattr(event, "arguments", "") or ""
    arguments: dict = json.loads(raw) if raw else {}  # type: ignore[type-arg]
    return ToolCall(
        call_id=str(getattr(event, "call_id", "")),
        name=str(getattr(event, "name", "")),
        arguments=arguments,
    )


class LiveKitRealtimeSession:
    """`RealtimeSession` backed by LiveKit `RealtimeModel` + `AgentSession`.

    Construction params live in ``__init__`` (sync). The protocol ``start`` does
    the vendor wiring. The runner drives this exactly as it drives
    ``FakeRealtimeSession``: ``await start(...)`` then iterate ``events()``.
    """

    def __init__(
        self,
        job: Any,
        *,
        model: str,
        participant_identity: str | None = None,
        participant_reconnect_grace_seconds: float = _DEFAULT_RECONNECT_GRACE_SECONDS,
    ) -> None:
        self._job = job
        self._model = model
        self._participant_identity = participant_identity
        self._participant_reconnect_grace_seconds = participant_reconnect_grace_seconds
        self._queue: asyncio.Queue[RealtimeEvent | _EndSentinel] = asyncio.Queue()
        self._session: Any | None = None
        self._room: Any | None = None
        self._closed = False
        self._consumers: list[asyncio.Task[Any]] = []
        self._grace_task: asyncio.Task[None] | None = None
        # Participant-lifecycle state (ported from LiveKitSessionVoiceAgent).
        self._participant_connected = True
        self._participant_state_changed = asyncio.Event()
        self._on_disconnect_callback: ParticipantStateCallback | None = None
        self._on_reconnect_callback: ParticipantStateCallback | None = None
        self._on_reconnect_grace_expired_callback: ParticipantStateCallback | None = None

    # -- protocol surface ---------------------------------------------------

    async def start(self, *, instructions: str, tools: list[dict]) -> None:  # type: ignore[type-arg]  # pragma: no cover
        """Build the realtime model + session, register handlers, join the room.

        Vendor I/O — not unit-tested. The pure pieces it calls into (event
        translation, queue emit, lifecycle linking) are covered separately.
        """
        from livekit.agents import Agent, AgentSession, room_io
        from livekit.plugins.openai import realtime as openai_realtime
        from openai.types.realtime import AudioTranscription

        # input_audio_transcription MUST be set explicitly or candidate
        # transcription events never fire (Task 8 finding Q1). The plugin keeps
        # auto_tool_reply_generation off by default; this adapter owns the
        # tool-reply loop (Task 8 finding Q3, see respond_to_tool).
        realtime_model = openai_realtime.RealtimeModel(
            model=self._model,
            input_audio_transcription=AudioTranscription(model=_TRANSCRIPTION_MODEL),
        )

        session = AgentSession(llm=realtime_model)
        self._session = session

        # generation_created → consume the per-turn streams and translate.
        session.on("generation_created", self._on_generation_created)
        session.on("input_audio_transcription_completed", self._on_input_transcription)
        session.on("close", self._on_session_close)
        session.on("error", self._on_session_error)

        room_options_kwargs: dict[str, Any] = {
            "audio_input": True,
            "audio_output": True,
            "text_output": True,
            "close_on_disconnect": False,
        }
        if self._participant_identity is not None:
            room_options_kwargs["participant_identity"] = self._participant_identity

        await session.start(
            Agent(instructions=instructions or _INSTRUCTIONS_FALLBACK),
            room=self._job.room,
            room_options=room_io.RoomOptions(**room_options_kwargs),
        )

        if self._participant_identity:
            participant = await self._job.wait_for_participant(
                identity=self._participant_identity
            )
        else:
            participant = await self._job.wait_for_participant()
        session.room_io.set_participant(participant.identity)
        self._link_participant(self._job.room, participant.identity)
        logger.info(
            "started realtime LiveKit session",
            extra={"room": self._job.room.name, "participant": participant.identity},
        )

    async def events(self) -> AsyncIterator[RealtimeEvent]:
        """Drain the internal queue until the end sentinel."""
        while True:
            item = await self._queue.get()
            if isinstance(item, _EndSentinel):
                return
            yield item

    async def respond_to_tool(self, call_id: str, output: str) -> None:  # pragma: no cover
        """Return a tool result, then trigger the next agent response.

        With ``auto_tool_reply_generation`` off (the plugin default) the adapter
        owns this loop: push a ``FunctionCallOutput`` into the chat context and
        re-generate (Task 8 finding Q3). We use the public
        ``AgentSession.generate_reply(chat_ctx=…)`` path seeded from
        ``session.history`` rather than reaching into the private realtime
        session — same effect, supported surface.
        """
        if self._session is None:
            raise RuntimeError("respond_to_tool called before start()")
        from livekit.agents.llm import FunctionCallOutput

        chat_ctx = self._session.history.copy()
        chat_ctx.items.append(
            FunctionCallOutput(call_id=call_id, output=output, is_error=False)
        )
        self._session.generate_reply(chat_ctx=chat_ctx)

    async def inject_message(self, text: str) -> None:  # pragma: no cover
        """Send out-of-band steering: one-shot ``generate_reply(instructions=…)``.

        Non-persistent — appended to the standing session instructions for the
        next response only (Task 8 finding Q4).
        """
        if self._session is None:
            raise RuntimeError("inject_message called before start()")
        self._session.generate_reply(instructions=text)

    async def aclose(self) -> None:
        """Shut the session down and release resources."""
        self._closed = True
        if self._grace_task is not None and not self._grace_task.done():
            self._grace_task.cancel()
        for task in self._consumers:
            task.cancel()
        # Await cancellation so no in-flight translated event gets queued onto
        # an already-_END-terminated queue and silently dropped.
        await asyncio.gather(*self._consumers, return_exceptions=True)
        if self._grace_task is not None:
            await asyncio.gather(self._grace_task, return_exceptions=True)
        self._teardown_handlers()
        if self._session is not None:  # pragma: no cover - vendor I/O
            await self._session.aclose()
        self._emit(_END)

    # -- internal: queue + vendor-event translation -------------------------

    def _emit(self, event: RealtimeEvent | _EndSentinel) -> None:
        """Push a translated event (or the end sentinel) onto the queue."""
        self._queue.put_nowait(event)

    def _on_input_transcription(self, event: Any) -> None:  # pragma: no cover - vendor event
        self._emit(_to_input_transcript(event))

    def _on_generation_created(self, event: Any) -> None:  # pragma: no cover - vendor event
        # Each generation carries a message stream (agent transcript deltas) and
        # a function stream (tool calls). Consume both concurrently.
        self._consumers.append(
            asyncio.create_task(self._consume_message_stream(event.message_stream))
        )
        self._consumers.append(
            asyncio.create_task(self._consume_function_stream(event.function_stream))
        )

    async def _consume_message_stream(  # pragma: no cover - vendor I/O
        self, message_stream: Any
    ) -> None:
        async for message in message_stream:
            parts: list[str] = []
            async for delta in message.text_stream:
                parts.append(delta)
            text = "".join(parts).strip()
            if text:
                self._emit(_to_output_transcript(text))

    async def _consume_function_stream(  # pragma: no cover - vendor I/O
        self, function_stream: Any
    ) -> None:
        async for function_call in function_stream:
            self._emit(_to_tool_call(function_call))

    def _on_session_close(self, event: Any) -> None:  # pragma: no cover - vendor event
        self._closed = True
        self._participant_state_changed.set()
        self._emit(_END)

    def _on_session_error(self, event: Any) -> None:  # pragma: no cover - vendor event
        logger.error(
            "realtime LiveKit session error",
            extra={"error": str(getattr(event, "error", ""))},
        )

    def _teardown_handlers(self) -> None:
        session = self._session
        if session is not None:  # pragma: no cover - vendor I/O
            for name, handler in (
                ("generation_created", self._on_generation_created),
                ("input_audio_transcription_completed", self._on_input_transcription),
                ("close", self._on_session_close),
                ("error", self._on_session_error),
            ):
                with contextlib.suppress(Exception):
                    session.off(name, handler)
        if self._room is not None:
            with contextlib.suppress(Exception):
                self._room.off("participant_disconnected", self._on_participant_disconnected)
            with contextlib.suppress(Exception):
                self._room.off("participant_connected", self._on_participant_connected)

    # -- participant lifecycle (ported from LiveKitSessionVoiceAgent) -------

    def set_participant_state_handlers(
        self,
        *,
        on_disconnect: ParticipantStateCallback | None = None,
        on_reconnect: ParticipantStateCallback | None = None,
        on_reconnect_grace_expired: ParticipantStateCallback | None = None,
    ) -> None:
        """Register controller hooks for the participant disconnect lifecycle."""
        self._on_disconnect_callback = on_disconnect
        self._on_reconnect_callback = on_reconnect
        self._on_reconnect_grace_expired_callback = on_reconnect_grace_expired

    def _link_participant(self, room: Any, participant_identity: str) -> None:
        self._room = room
        self._participant_identity = participant_identity
        self._participant_connected = True
        room.on("participant_disconnected", self._on_participant_disconnected)
        room.on("participant_connected", self._on_participant_connected)

    def _on_participant_disconnected(self, participant: Any) -> None:
        if getattr(participant, "identity", None) != self._participant_identity:
            return
        self._participant_connected = False
        self._participant_state_changed.set()
        if self._on_disconnect_callback is not None:
            self._on_disconnect_callback()
        logger.info(
            "participant disconnected", extra={"participant": self._participant_identity}
        )
        self._spawn_grace_task()

    def _spawn_grace_task(self) -> None:
        """Schedule the reconnect-grace wait, at most one pending at a time.

        The room ``.on`` handler that calls this is sync, so we schedule the
        coroutine on the running loop. If a grace task is already pending we do
        not spawn another — the in-flight one already covers this disconnect.
        """
        if self._grace_task is not None and not self._grace_task.done():
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # pragma: no cover - no running loop (defensive)
            return
        self._grace_task = loop.create_task(self._run_reconnect_grace())

    async def _run_reconnect_grace(self) -> None:
        """Await the grace window; on expiry, end the session via the queue.

        Clean return means the participant reconnected within grace (the
        reconnect callback already fired from ``_on_participant_connected``).
        Expiry fires the grace-expired callback (inside the wait) and pushes the
        ``_END`` sentinel so ``events()`` terminates and the session ends.
        """
        try:
            await self._wait_for_participant_reconnect()
        except ParticipantDisconnectedError:
            self._emit(_END)

    def _on_participant_connected(self, participant: Any) -> None:
        if getattr(participant, "identity", None) != self._participant_identity:
            return
        self._participant_connected = True
        room_io = getattr(self._session, "room_io", None)
        if room_io is not None:  # pragma: no cover - vendor I/O
            room_io.set_participant(self._participant_identity)
        self._participant_state_changed.set()
        if self._on_reconnect_callback is not None:
            self._on_reconnect_callback()
        logger.info(
            "participant connected", extra={"participant": self._participant_identity}
        )

    async def _wait_for_participant_reconnect(self) -> None:
        """Block until the participant reconnects, honoring the grace window."""
        started_at = time.monotonic()
        while not self._participant_connected:
            if self._closed:
                raise RuntimeError("realtime session closed while waiting for reconnect")
            remaining = self._participant_reconnect_grace_seconds - (
                time.monotonic() - started_at
            )
            if remaining <= 0:
                self._notify_reconnect_grace_expired()
                raise ParticipantDisconnectedError(
                    f"participant {self._participant_identity} did not reconnect"
                )
            self._participant_state_changed.clear()
            try:
                await asyncio.wait_for(
                    self._participant_state_changed.wait(), timeout=remaining
                )
            except TimeoutError as exc:
                self._notify_reconnect_grace_expired()
                raise ParticipantDisconnectedError(
                    f"participant {self._participant_identity} did not reconnect"
                ) from exc

    def _notify_reconnect_grace_expired(self) -> None:
        if self._on_reconnect_grace_expired_callback is not None:
            self._on_reconnect_grace_expired_callback()
