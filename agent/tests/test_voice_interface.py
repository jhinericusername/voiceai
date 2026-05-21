from unittest.mock import AsyncMock, MagicMock

from agent.voice.cascaded import CascadedVoiceAgent
from agent.voice.interface import ListenResult, VoiceAgent, VoiceMode


def test_voice_mode_values() -> None:
    assert set(VoiceMode.__args__) == {"scripted", "clarifying", "repair", "closing"}


async def test_cascaded_speak_records_last_utterance() -> None:
    stt = MagicMock()
    tts = MagicMock()
    tts.synthesize = AsyncMock()
    room_output = MagicMock()
    room_output.play = AsyncMock()
    agent = CascadedVoiceAgent(stt=stt, tts=tts, room_output=room_output)
    await agent.speak("Welcome to the interview.", mode="scripted")
    assert agent.last_spoken == "Welcome to the interview."
    tts.synthesize.assert_awaited_once_with("Welcome to the interview.")


async def test_cascaded_speak_uses_verbatim_text_unchanged() -> None:
    tts = MagicMock()
    tts.synthesize = AsyncMock(return_value=b"audio")
    room_output = MagicMock()
    room_output.play = AsyncMock()
    agent = CascadedVoiceAgent(stt=MagicMock(), tts=tts, room_output=room_output)
    scripted = "Can you tell me about a technically complex problem you solved?"
    await agent.speak(scripted, mode="scripted")
    # The text passed to TTS is byte-identical to the controller's text.
    assert tts.synthesize.await_args.args[0] == scripted


async def test_cascaded_listen_returns_transcript_and_turn_flag() -> None:
    stt = MagicMock()
    stt.next_turn = AsyncMock(
        return_value={"text": "I rewrote the scheduler.", "end_of_turn": True}
    )
    agent = CascadedVoiceAgent(stt=stt, tts=MagicMock(), room_output=MagicMock())
    result = await agent.listen()
    assert isinstance(result, ListenResult)
    assert result.transcript == "I rewrote the scheduler."
    assert result.end_of_turn is True


async def test_cascaded_set_mode_and_interrupt() -> None:
    tts = MagicMock()
    tts.synthesize = AsyncMock()
    room_output = MagicMock()
    room_output.play = AsyncMock()
    room_output.stop = AsyncMock()
    agent = CascadedVoiceAgent(stt=MagicMock(), tts=tts, room_output=room_output)
    agent.set_mode("repair")
    assert agent.mode == "repair"
    await agent.interrupt()
    room_output.stop.assert_awaited_once()


def test_voice_agent_is_the_abstract_contract() -> None:
    # CascadedVoiceAgent satisfies the VoiceAgent protocol.
    assert issubclass(CascadedVoiceAgent, VoiceAgent)
