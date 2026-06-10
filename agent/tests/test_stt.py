from unittest.mock import MagicMock

from agent.voice.stt import DeepgramSTT, SttTranscript


def test_stt_transcript_holds_text_and_finality() -> None:
    t = SttTranscript(text="hello there", is_final=True, unreliable=False)
    assert t.text == "hello there"
    assert t.is_final is True


async def test_deepgram_stt_collects_final_transcript() -> None:
    plugin = MagicMock()
    # The Deepgram plugin yields interim then final events for one turn.
    events = [
        {"type": "interim", "text": "I rewrote"},
        {"type": "interim", "text": "I rewrote the"},
        {"type": "final", "text": "I rewrote the scheduler."},
    ]

    async def fake_stream():
        for ev in events:
            yield ev

    plugin.stream = MagicMock(return_value=fake_stream())
    stt = DeepgramSTT(plugin=plugin)
    result = await stt.next_turn()
    assert result["text"] == "I rewrote the scheduler."
    assert result["end_of_turn"] is True


async def test_deepgram_stt_marks_low_confidence_as_unreliable() -> None:
    plugin = MagicMock()
    events = [{"type": "final", "text": "??? garbled", "confidence": 0.21}]

    async def fake_stream():
        for ev in events:
            yield ev

    plugin.stream = MagicMock(return_value=fake_stream())
    stt = DeepgramSTT(plugin=plugin, min_confidence=0.5)
    transcript = await stt.next_final_transcript()
    assert transcript.unreliable is True
    assert transcript.text == "??? garbled"


def test_build_deepgram_stt_sets_explicit_interview_config(monkeypatch) -> None:  # noqa: ANN001
    captured = {}

    import livekit.plugins.deepgram as deepgram

    monkeypatch.setattr(deepgram, "STT", lambda **kwargs: captured.update(kwargs) or object())

    from agent.voice.stt import build_deepgram_stt

    build_deepgram_stt("dg-key")

    assert captured["model"] == "nova-3"
    assert captured["language"] == "en-US"
    assert captured["interim_results"] is True
    assert captured["smart_format"] is True
    assert captured["no_delay"] is True
    assert captured["endpointing_ms"] == 200
    assert captured["filler_words"] is False
