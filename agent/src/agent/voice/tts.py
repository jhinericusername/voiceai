"""Cartesia Sonic-3 low-latency TTS adapter for the cascaded Voice I/O layer."""

from __future__ import annotations

import inspect
import os
from typing import Any

# "Corey - Supportive Buddy" — warm, emotive male library voice picked in the
# 2026-06-11 A/B bench (the plugin's own default is "Katie", a female voice,
# which clashed with the "my name is Prakul" script). Replaced by the cloned
# Prakul voice via CARTESIA_VOICE_ID once his audio arrives.
DEFAULT_VOICE_ID = "630ed21c-2c5c-41cf-9d82-10a7fd668370"


def build_cartesia_tts(api_key: str) -> Any:
    """Construct the LiveKit Cartesia plugin configured for Sonic-3.

    If `CARTESIA_VOICE_ID` is set (e.g. the cloned Prakul voice), it wins;
    otherwise the bench-picked library voice. Delivery stays at the model's
    natural prosody — the speed=1.05 + text_pacing combo was A/B'd out as the
    prime suspect for audible artifacts."""
    from livekit.plugins import cartesia

    voice_id = os.environ.get("CARTESIA_VOICE_ID", "").strip() or DEFAULT_VOICE_ID
    return cartesia.TTS(
        model="sonic-3",
        api_key=api_key,
        language="en",
        voice=voice_id,
    )


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
