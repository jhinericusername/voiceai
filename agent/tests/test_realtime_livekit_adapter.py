"""Tests for the production LiveKit RealtimeModel adapter.

Only the PURE parts are exercised here: the event-translation helpers, the
`events()` queue drain, and the ported participant-lifecycle callbacks. The
vendor I/O (RealtimeModel/AgentSession construction, room join, generate_reply)
is `# pragma: no cover` in the adapter and is not unit-tested.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from agent.voice.realtime.interface import (
    InputTranscript,
    OutputTranscript,
    RealtimeSession,
    ToolCall,
)
from agent.voice.realtime.livekit_adapter import (
    _END,
    LiveKitRealtimeSession,
    ParticipantDisconnectedError,
    _attribute_ready,
    _to_input_transcript,
    _to_output_transcript,
    _to_tool_call,
)


class FakeRoom:
    def __init__(self) -> None:
        self.handlers: dict = {}

    def on(self, event: str, callback) -> None:  # noqa: ANN001
        self.handlers[event] = callback

    def off(self, event: str, callback) -> None:  # noqa: ANN001
        if self.handlers.get(event) == callback:
            del self.handlers[event]


def _make_session(job=None) -> LiveKitRealtimeSession:
    return LiveKitRealtimeSession(job, model="gpt-realtime")


# ---------------------------------------------------------------------------
# Pure event-translation helpers
# ---------------------------------------------------------------------------


def test_to_input_transcript_maps_transcript_text() -> None:
    ev = SimpleNamespace(transcript="I rewrote the scheduler.", is_final=True)
    assert _to_input_transcript(ev) == InputTranscript(text="I rewrote the scheduler.")


def test_to_output_transcript_maps_accumulated_text() -> None:
    assert _to_output_transcript("Tell me about the migration.") == OutputTranscript(
        text="Tell me about the migration."
    )


def test_to_tool_call_maps_call_id_name_and_parses_arguments() -> None:
    ev = SimpleNamespace(
        call_id="call_abc",
        name="advance_question",
        arguments='{"next_question_id": "q2"}',
    )
    assert _to_tool_call(ev) == ToolCall(
        call_id="call_abc",
        name="advance_question",
        arguments={"next_question_id": "q2"},
    )


def test_to_tool_call_handles_empty_arguments() -> None:
    ev = SimpleNamespace(call_id="c1", name="finish", arguments="")
    assert _to_tool_call(ev) == ToolCall(call_id="c1", name="finish", arguments={})


# ---------------------------------------------------------------------------
# events() queue drain ordering
# ---------------------------------------------------------------------------


async def test_events_drains_queue_in_order_until_end_sentinel() -> None:
    session = _make_session()
    scripted = [
        OutputTranscript(text="hi"),
        ToolCall(call_id="c1", name="advance_question", arguments={"next_question_id": "q1"}),
        InputTranscript(text="my answer"),
    ]
    for ev in scripted:
        session._emit(ev)
    session._emit(_END)
    # A trailing event after the sentinel must NOT be yielded.
    session._emit(OutputTranscript(text="after end"))

    collected = [ev async for ev in session.events()]
    assert collected == scripted


async def test_events_stops_at_end_even_when_empty() -> None:
    session = _make_session()
    session._emit(_END)
    collected = [ev async for ev in session.events()]
    assert collected == []


# ---------------------------------------------------------------------------
# Protocol conformance
# ---------------------------------------------------------------------------


def test_adapter_satisfies_realtime_session_protocol() -> None:
    assert isinstance(_make_session(), RealtimeSession)


# ---------------------------------------------------------------------------
# Ported participant-lifecycle readiness + callbacks
# ---------------------------------------------------------------------------


def test_attribute_ready_true_only_when_ready_attribute_is_true() -> None:
    assert _attribute_ready({"ready": "true"}) is True
    assert _attribute_ready({"ready": "false"}) is False
    assert _attribute_ready({}) is False
    assert _attribute_ready(None) is False


async def test_disconnect_and_reconnect_callbacks_fire() -> None:
    session = _make_session()
    room = FakeRoom()
    on_disconnect = []
    on_reconnect = []
    session.set_participant_state_handlers(
        on_disconnect=lambda: on_disconnect.append(1),
        on_reconnect=lambda: on_reconnect.append(1),
    )
    session._link_participant(room, "candidate-1")

    assert session._participant_connected is True
    room.handlers["participant_disconnected"](SimpleNamespace(identity="candidate-1"))
    assert session._participant_connected is False
    assert on_disconnect == [1]

    room.handlers["participant_connected"](SimpleNamespace(identity="candidate-1"))
    assert session._participant_connected is True
    assert on_reconnect == [1]


async def test_disconnect_ignores_other_participants() -> None:
    session = _make_session()
    room = FakeRoom()
    on_disconnect = []
    session.set_participant_state_handlers(on_disconnect=lambda: on_disconnect.append(1))
    session._link_participant(room, "candidate-1")

    room.handlers["participant_disconnected"](SimpleNamespace(identity="someone-else"))
    assert session._participant_connected is True
    assert on_disconnect == []


async def test_wait_for_reconnect_grace_expired_callback_fires_and_raises() -> None:
    session = _make_session()
    room = FakeRoom()
    grace_expired = []
    session.set_participant_state_handlers(
        on_reconnect_grace_expired=lambda: grace_expired.append(1)
    )
    session._participant_reconnect_grace_seconds = 0.01
    session._link_participant(room, "candidate-1")
    room.handlers["participant_disconnected"](SimpleNamespace(identity="candidate-1"))

    with pytest.raises(ParticipantDisconnectedError):
        await session._wait_for_participant_reconnect()
    assert grace_expired == [1]


async def test_wait_for_reconnect_returns_when_participant_returns() -> None:
    session = _make_session()
    room = FakeRoom()
    session._participant_reconnect_grace_seconds = 1.0
    session._link_participant(room, "candidate-1")
    room.handlers["participant_disconnected"](SimpleNamespace(identity="candidate-1"))

    wait_task = asyncio.create_task(session._wait_for_participant_reconnect())
    await asyncio.sleep(0)
    assert not wait_task.done()
    room.handlers["participant_connected"](SimpleNamespace(identity="candidate-1"))
    await asyncio.wait_for(wait_task, timeout=1.0)  # returns without raising
