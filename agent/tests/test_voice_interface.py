from agent.voice.interface import ListenResult, VoiceAgent, VoiceMode


def test_voice_mode_values() -> None:
    assert set(VoiceMode.__args__) == {"scripted", "clarifying", "repair", "closing"}


def test_listen_result_holds_transcript_and_turn_flag() -> None:
    r = ListenResult(transcript="hello", end_of_turn=True)
    assert r.transcript == "hello"
    assert r.end_of_turn is True


def test_voice_agent_is_abstract() -> None:
    import pytest

    with pytest.raises(TypeError):
        VoiceAgent()  # type: ignore[abstract]
