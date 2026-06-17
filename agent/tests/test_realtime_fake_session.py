"""Tests for FakeRealtimeSession and the RealtimeSession protocol."""
from __future__ import annotations

from agent.voice.realtime.interface import (
    FakeRealtimeSession,
    InputTranscript,
    OutputTranscript,
    RealtimeSession,
    ToolCall,
)


async def test_start_records_instructions_and_tools() -> None:
    session = FakeRealtimeSession(scripted=[])
    await session.start(instructions="INS", tools=[{"name": "advance_question"}])
    assert session.started_with == ("INS", [{"name": "advance_question"}])


async def test_events_yields_scripted_in_order() -> None:
    scripted = [
        OutputTranscript(text="hi"),
        ToolCall(call_id="c1", name="advance_question", arguments={"next_question_id": "q1"}),
        InputTranscript(text="my answer"),
    ]
    session = FakeRealtimeSession(scripted=scripted)
    collected = [ev async for ev in session.events()]
    assert collected == scripted


async def test_respond_to_tool_records_call() -> None:
    session = FakeRealtimeSession(scripted=[])
    await session.respond_to_tool("c1", "V-q1")
    assert session.tool_responses == [("c1", "V-q1")]


async def test_inject_message_records_text() -> None:
    session = FakeRealtimeSession(scripted=[])
    await session.inject_message("dig deeper")
    assert session.injections == ["dig deeper"]


async def test_aclose_sets_closed_flag() -> None:
    session = FakeRealtimeSession(scripted=[])
    await session.aclose()
    assert session.closed is True


async def test_fake_session_satisfies_protocol() -> None:
    session = FakeRealtimeSession(scripted=[])
    assert isinstance(session, RealtimeSession)
