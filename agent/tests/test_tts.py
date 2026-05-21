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


async def test_tts_synthesize_rejects_empty_text() -> None:
    tts = CartesiaTTS(plugin=MagicMock())
    with pytest.raises(ValueError, match="empty"):
        await tts.synthesize("")
