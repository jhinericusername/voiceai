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
