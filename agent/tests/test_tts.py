from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.voice.tts import CartesiaTTS


async def test_tts_synthesize_returns_audio_bytes() -> None:
    plugin = MagicMock()
    plugin.synthesize = AsyncMock(return_value=b"\x00\x01audio")
    tts = CartesiaTTS(plugin=plugin)
    audio = await tts.synthesize("Welcome to the interview.")
    assert audio == b"\x00\x01audio"
    plugin.synthesize.assert_awaited_once_with("Welcome to the interview.")


async def test_tts_synthesize_passes_text_unchanged() -> None:
    plugin = MagicMock()
    plugin.synthesize = AsyncMock(return_value=b"x")
    tts = CartesiaTTS(plugin=plugin)
    verbatim = "Can you tell me about the time you hacked a non-computer system?"
    await tts.synthesize(verbatim)
    assert plugin.synthesize.await_args.args[0] == verbatim


async def test_tts_synthesize_collects_livekit_chunked_stream() -> None:
    class Stream:
        async def __aenter__(self):  # noqa: ANN204
            return self

        async def __aexit__(self, exc_type, exc, tb) -> None:  # noqa: ANN001
            return None

        async def collect(self):  # noqa: ANN201
            return MagicMock(data=b"\x00\x01audio")

    plugin = MagicMock()
    plugin.synthesize.return_value = Stream()
    tts = CartesiaTTS(plugin=plugin)

    audio = await tts.synthesize("Welcome to the interview.")

    assert audio == b"\x00\x01audio"
    plugin.synthesize.assert_called_once_with("Welcome to the interview.")


async def test_tts_synthesize_rejects_empty_text() -> None:
    tts = CartesiaTTS(plugin=MagicMock())
    with pytest.raises(ValueError, match="empty"):
        await tts.synthesize("")


def test_build_cartesia_tts_uses_sonic3_with_pacing(monkeypatch) -> None:  # noqa: ANN001
    captured = {}

    import livekit.plugins.cartesia as cartesia

    monkeypatch.setattr(cartesia, "TTS", lambda **kwargs: captured.update(kwargs) or object())
    monkeypatch.delenv("CARTESIA_VOICE_ID", raising=False)

    from agent.voice.tts import build_cartesia_tts

    build_cartesia_tts("ct-key")

    assert captured["model"] == "sonic-3"
    assert captured["language"] == "en"
    assert captured["speed"] == 1.05
    assert captured["text_pacing"] is True
    assert "voice" not in captured  # no CARTESIA_VOICE_ID set
