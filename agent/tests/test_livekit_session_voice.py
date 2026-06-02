import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.voice.interface import ListenResult, VoiceAgent
from agent.voice.livekit_session import (
    LiveKitSessionVoiceAgent,
    ParticipantDisconnectedError,
    _agent_session_recording_enabled,
)


class FakeSpeechHandle:
    def __init__(self) -> None:
        self.wait_for_playout = AsyncMock()


class FakeSession:
    def __init__(self) -> None:
        self.handlers = {}
        self.handle = FakeSpeechHandle()
        self.say_calls = []
        self.interrupt = AsyncMock(return_value=None)
        self.aclose = AsyncMock(return_value=None)
        self.room_io = SimpleNamespace(set_participant=MagicMock())

    def on(self, event: str, callback) -> None:  # noqa: ANN001
        self.handlers[event] = callback

    def off(self, event: str, callback) -> None:  # noqa: ANN001
        if self.handlers.get(event) == callback:
            del self.handlers[event]

    def say(self, *args, **kwargs):  # noqa: ANN002, ANN003, ANN201
        self.say_calls.append((args, kwargs))
        return self.handle


class FakeRoom:
    def __init__(self) -> None:
        self.handlers = {}

    def on(self, event: str, callback) -> None:  # noqa: ANN001
        self.handlers[event] = callback

    def off(self, event: str, callback) -> None:  # noqa: ANN001
        if self.handlers.get(event) == callback:
            del self.handlers[event]


def test_livekit_session_voice_agent_satisfies_contract() -> None:
    assert issubclass(LiveKitSessionVoiceAgent, VoiceAgent)


def test_livekit_session_default_reconnect_grace_is_five_minutes() -> None:
    voice = LiveKitSessionVoiceAgent(FakeSession())

    assert voice._participant_reconnect_grace_seconds == 300.0


def test_agent_session_recording_defaults_off() -> None:
    assert _agent_session_recording_enabled({}) is False


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("true", True),
        ("1", True),
        ("on", True),
        ("false", False),
        ("0", False),
        ("off", False),
    ],
)
def test_agent_session_recording_env_override(value: str, expected: bool) -> None:
    assert _agent_session_recording_enabled({"PUDDLE_LIVEKIT_AGENT_RECORD": value}) is expected


def test_agent_session_recording_rejects_invalid_env_value() -> None:
    with pytest.raises(ValueError, match="PUDDLE_LIVEKIT_AGENT_RECORD"):
        _agent_session_recording_enabled({"PUDDLE_LIVEKIT_AGENT_RECORD": "sometimes"})


async def test_livekit_session_speak_uses_agent_session_say() -> None:
    session = FakeSession()
    voice = LiveKitSessionVoiceAgent(session)

    await voice.speak("Welcome to the interview.", mode="scripted")

    assert voice.last_spoken == "Welcome to the interview."
    assert session.say_calls == [
        (
            ("Welcome to the interview.",),
            {"allow_interruptions": True, "add_to_chat_ctx": False},
        )
    ]
    session.handle.wait_for_playout.assert_awaited_once()


async def test_livekit_session_listen_returns_next_final_transcript() -> None:
    session = FakeSession()
    voice = LiveKitSessionVoiceAgent(session)

    listen_task = asyncio.create_task(voice.listen())
    session.handlers["user_input_transcribed"](
        SimpleNamespace(transcript="still typing", is_final=False)
    )
    assert not listen_task.done()

    session.handlers["user_input_transcribed"](
        SimpleNamespace(transcript="I rewrote the scheduler.", is_final=True)
    )
    result = await listen_task

    assert isinstance(result, ListenResult)
    assert result.transcript == "I rewrote the scheduler."
    assert result.end_of_turn is True


async def test_livekit_session_listen_survives_participant_reconnect() -> None:
    session = FakeSession()
    room = FakeRoom()
    voice = LiveKitSessionVoiceAgent(session, participant_reconnect_grace_seconds=1.0)
    voice._link_participant(room, "candidate-1")

    listen_task = asyncio.create_task(voice.listen())
    room.handlers["participant_disconnected"](SimpleNamespace(identity="candidate-1"))
    await asyncio.sleep(0)
    assert not listen_task.done()

    room.handlers["participant_connected"](SimpleNamespace(identity="candidate-1"))
    session.handlers["user_input_transcribed"](
        SimpleNamespace(transcript="The scheduler used backpressure.", is_final=True)
    )
    result = await listen_task

    assert result.transcript == "The scheduler used backpressure."


async def test_livekit_session_listen_fails_after_reconnect_grace() -> None:
    session = FakeSession()
    room = FakeRoom()
    voice = LiveKitSessionVoiceAgent(session, participant_reconnect_grace_seconds=0.01)
    voice._link_participant(room, "candidate-1")

    room.handlers["participant_disconnected"](SimpleNamespace(identity="candidate-1"))
    with pytest.raises(ParticipantDisconnectedError):
        await voice.listen()


async def test_livekit_session_interrupt_and_close_delegate_to_session() -> None:
    session = FakeSession()
    room = FakeRoom()
    voice = LiveKitSessionVoiceAgent(session)
    voice._link_participant(room, "candidate-1")

    await voice.interrupt()
    await voice.aclose()

    session.interrupt.assert_awaited_once_with(force=True)
    session.aclose.assert_awaited_once()
    assert "user_input_transcribed" not in session.handlers
    assert room.handlers == {}
