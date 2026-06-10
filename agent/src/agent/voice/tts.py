"""Cartesia Sonic-3 low-latency TTS adapter for the cascaded Voice I/O layer."""

from __future__ import annotations

import inspect
import os
from typing import Any


def build_cartesia_tts(api_key: str) -> Any:  # pragma: no cover — vendor wiring
    """Construct the LiveKit Cartesia plugin configured for Sonic-3.

    If `CARTESIA_VOICE_ID` is set, the cloned voice is used; otherwise the
    Cartesia default voice (graceful degradation when voice cloning isn't
    configured)."""
    from livekit.plugins import cartesia

    kwargs: dict[str, Any] = {
        "model": "sonic-3",
        "api_key": api_key,
        "language": "en",
        "speed": 1.05,
        "text_pacing": True,
    }
    voice_id = os.environ.get("CARTESIA_VOICE_ID", "").strip()
    if voice_id:
        kwargs["voice"] = voice_id
    return cartesia.TTS(**kwargs)


class CartesiaTTS:
    """Wraps the Cartesia plugin into the `tts` shape Voice I/O needs.

    Synthesizes exactly the text given — never paraphrased — so the controller's
    verbatim base questions are spoken byte-identically.
    """

    def __init__(self, plugin: Any) -> None:
        self._plugin = plugin

    async def synthesize(self, text: str) -> bytes:
        """Synthesize `text` to audio bytes. Raises `ValueError` on empty text."""
        if not text.strip():
            raise ValueError("cannot synthesize empty text")
        result = self._plugin.synthesize(text)
        if inspect.isawaitable(result):
            return await result

        if hasattr(result, "collect"):
            if hasattr(result, "__aenter__"):
                async with result:
                    frame = await result.collect()
            else:
                frame = await result.collect()
            return bytes(frame.data)

        chunks: list[bytes] = []
        async for event in result:
            chunks.append(bytes(event.frame.data))
        return b"".join(chunks)
