"""Raw OpenAI websocket adapter — eval transport.

Drives OpenAI's GA realtime websocket directly via the `openai` SDK (no
LiveKit). This is the transport used by the eval harness (Tasks 14-16) to
run the interview against the live API WITHOUT a LiveKit room. It implements
the same `RealtimeSession` protocol as `LiveKitRealtimeSession` and
`FakeRealtimeSession`, so the runner treats all three identically.

Network/socket I/O is `# pragma: no cover`. Unit tests cover only the pure
event-translation functions fed canned server-event dicts.

GA realtime gotcha (confirmed by spike in `tmp/realtime-spike/spike.py`):
  - Use ``output_modalities`` (not ``modalities``) in the session config.
  - Session config shape: ``{"type": "realtime", "output_modalities": [...]}``
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from agent.voice.realtime.interface import (
    InputTranscript,
    OutputTranscript,
    RealtimeEvent,
    ToolCall,
)

logger = logging.getLogger(__name__)

_DEFAULT_OUTPUT_MODALITIES = ["text", "audio"]


class _EndSentinel:
    """Single-instance marker that terminates the `events()` async generator."""

    __slots__ = ()


_END = _EndSentinel()


class EventTranslator:
    """Stateful translator for GA realtime server-event dicts.

    Maintains per-turn accumulation of ``response.output_text.delta`` fragments
    so that ``response.output_text.done`` can emit the full ``OutputTranscript``.
    One ``EventTranslator`` per session; reset between sessions if reused.
    """

    def __init__(self) -> None:
        self._output_text_parts: list[str] = []


def _translate_event(
    translator: EventTranslator,
    event: dict[str, Any],
) -> RealtimeEvent | None:
    """Translate a single GA server-event dict to a protocol event.

    Returns ``None`` for accumulation-only events (``output_text.delta``) and
    for events that carry no protocol-level meaning (session lifecycle, etc.).

    GA server-event types handled:
    - ``conversation.item.input_audio_transcription.completed``
        → ``InputTranscript(text=<transcript>)``
    - ``response.output_text.delta``
        → accumulate; returns ``None``
    - ``response.output_text.done``
        → ``OutputTranscript(text=<full turn>)`` (uses ``text`` field or
           joined deltas as fallback); resets the accumulator
    - ``response.function_call_arguments.done``
        → ``ToolCall(call_id, name, arguments=<parsed dict>)``
    - everything else
        → ``None`` (ignored, no crash)
    """
    event_type: str = event.get("type", "")

    if event_type == "conversation.item.input_audio_transcription.completed":
        return InputTranscript(text=str(event.get("transcript", "")))

    if event_type == "response.output_text.delta":
        delta = event.get("delta", "") or ""
        translator._output_text_parts.append(delta)
        return None

    if event_type == "response.output_text.done":
        # Prefer the authoritative `text` field; fall back to joined deltas.
        joined = "".join(translator._output_text_parts)
        text = str(event.get("text", joined) or joined).strip()
        translator._output_text_parts = []
        return OutputTranscript(text=text)

    if event_type == "response.function_call_arguments.done":
        raw: str = event.get("arguments", "") or ""
        try:
            arguments: dict[str, Any] = json.loads(raw) if raw else {}
        except (json.JSONDecodeError, ValueError):
            arguments = {}
        return ToolCall(
            call_id=str(event.get("call_id", "")),
            name=str(event.get("name", "")),
            arguments=arguments,
        )

    # Unknown / session-lifecycle events (session.created, response.done,
    # rate_limits.updated, etc.) are silently ignored.
    return None


class OpenAIWebsocketRealtimeSession:
    """`RealtimeSession` backed by the OpenAI GA realtime websocket.

    Intended as the eval transport: it drives ``gpt-realtime`` directly via
    the ``openai`` SDK and does NOT require a LiveKit room.

    Construction (sync, no I/O):
        ``__init__`` stores config and initialises the internal event queue.

    Protocol surface (async, I/O in start/respond_to_tool/inject_message/aclose):
        ``start``            — opens websocket, sends ``session.update``
        ``events``           — async generator draining the queue
        ``respond_to_tool``  — sends ``function_call_output`` + ``response.create``
        ``inject_message``   — sends user item + ``response.create``
        ``aclose``           — closes the websocket, emits ``_END``
    """

    def __init__(
        self,
        *,
        model: str,
        api_key: str | None = None,
        output_modalities: list[str] | None = None,
    ) -> None:
        self._model = model
        self._api_key = api_key
        self._output_modalities: list[str] = (
            output_modalities if output_modalities is not None else list(_DEFAULT_OUTPUT_MODALITIES)
        )
        self._queue: asyncio.Queue[RealtimeEvent | _EndSentinel] = asyncio.Queue()
        self._conn: Any | None = None
        self._read_task: asyncio.Task[None] | None = None
        self._closed = False
        self._translator = EventTranslator()

    # -- protocol surface ---------------------------------------------------

    async def start(  # pragma: no cover
        self, *, instructions: str, tools: list[dict[str, Any]]
    ) -> None:
        """Open the realtime websocket and send the initial ``session.update``.

        GA session config shape (confirmed by spike):
          ``{"type": "realtime", "output_modalities": [...], "instructions": ...,
             "tools": [...]}``

        Vendor I/O — not unit-tested.
        """
        from openai import AsyncOpenAI

        kwargs: dict[str, Any] = {}
        if self._api_key:
            kwargs["api_key"] = self._api_key

        client = AsyncOpenAI(**kwargs)
        # The `async with` context manager drives the websocket lifetime; we
        # store the connection so aclose() can exit it.
        self._ctx = client.realtime.connect(model=self._model)
        conn = await self._ctx.__aenter__()
        self._conn = conn

        # The GA realtime API requires each tool to carry "type": "function"
        # (plan_builder emits transport-neutral {name, description, parameters}).
        # Without it the server rejects session.update with a missing-parameter
        # error and never produces a response.
        ga_tools = [t if t.get("type") else {"type": "function", **t} for t in tools]
        session_cfg: dict[str, Any] = {
            "type": "realtime",
            "instructions": instructions,
            "output_modalities": self._output_modalities,
            "tools": ga_tools,
        }
        await conn.session.update(session=session_cfg)
        logger.info(
            "OpenAI realtime session started",
            extra={"model": self._model, "output_modalities": self._output_modalities},
        )

        # Spawn the background reader task that translates server events and
        # pushes them onto the internal queue. MUST keep a strong reference:
        # the event loop holds only a weak ref, so an unstored task gets
        # garbage-collected mid-await and the socket is never drained (no
        # events ever reach the queue → events() blocks forever).
        self._read_task = asyncio.create_task(self._read_loop(conn))

        # In text modality there is no audio VAD to trigger the agent, so
        # explicitly request the opening turn — the model delivers its opener
        # per the instructions. Subsequent turns are triggered by
        # respond_to_tool / inject_message (each sends response.create).
        await conn.response.create()

    async def events(self) -> AsyncIterator[RealtimeEvent]:  # type: ignore[override]
        """Drain the internal queue until the end sentinel."""
        while True:
            item = await self._queue.get()
            if isinstance(item, _EndSentinel):
                return
            yield item

    async def respond_to_tool(self, call_id: str, output: str) -> None:  # pragma: no cover
        """Send a ``function_call_output`` conversation item + ``response.create``."""
        if self._conn is None:
            raise RuntimeError("respond_to_tool called before start()")
        await self._conn.conversation.item.create(
            item={
                "type": "function_call_output",
                "call_id": call_id,
                "output": output,
            }
        )
        await self._conn.response.create()

    async def inject_message(self, text: str) -> None:  # pragma: no cover
        """Send a user conversation item + ``response.create``."""
        if self._conn is None:
            raise RuntimeError("inject_message called before start()")
        await self._conn.conversation.item.create(
            item={
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": text}],
            }
        )
        await self._conn.response.create()

    async def aclose(self) -> None:  # pragma: no cover
        """Close the websocket and signal the end of the event stream."""
        self._closed = True
        if self._read_task is not None:
            self._read_task.cancel()
            try:
                await self._read_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001 — best-effort teardown
                pass
        if self._conn is not None and hasattr(self, "_ctx"):
            try:
                await self._ctx.__aexit__(None, None, None)
            except Exception:  # noqa: BLE001 — best-effort teardown
                logger.debug("error closing OpenAI realtime websocket", exc_info=True)
        self._emit(_END)

    # -- internal -----------------------------------------------------------

    def _emit(self, event: RealtimeEvent | _EndSentinel) -> None:
        """Push a translated event (or end sentinel) onto the queue."""
        self._queue.put_nowait(event)

    async def _read_loop(self, conn: Any) -> None:  # pragma: no cover
        """Background task: iterate server events, translate, and emit."""
        try:
            async for raw_event in conn:
                if self._closed:
                    break
                # The openai SDK yields typed objects; convert to a plain dict
                # so the pure translator function can work on either the SDK
                # objects (via __dict__ / model_dump) or raw dicts from tests.
                event_dict: dict[str, Any]
                if hasattr(raw_event, "model_dump"):
                    event_dict = raw_event.model_dump()
                elif hasattr(raw_event, "__dict__"):
                    event_dict = vars(raw_event)
                else:
                    event_dict = dict(raw_event)  # type: ignore[arg-type]

                if event_dict.get("type") == "error":
                    # Surface protocol errors — a swallowed session-config error
                    # otherwise looks identical to a silent hang.
                    logger.error(
                        "OpenAI realtime error event", extra={"error": event_dict.get("error")}
                    )
                translated = _translate_event(self._translator, event_dict)
                if translated is not None:
                    self._emit(translated)
        except Exception:  # noqa: BLE001
            logger.exception("error in OpenAI realtime read loop")
        finally:
            self._emit(_END)
