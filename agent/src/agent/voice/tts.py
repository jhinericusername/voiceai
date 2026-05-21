"""Cartesia Sonic-3 low-latency TTS adapter for the cascaded Voice I/O layer."""

from __future__ import annotations

from typing import Any


def build_cartesia_tts(api_key: str) -> Any:  # pragma: no cover — vendor wiring
    """Construct the LiveKit Cartesia plugin configured for Sonic-3."""
    from livekit.plugins import cartesia

    return cartesia.TTS(model="sonic-3", api_key=api_key)


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
        return await self._plugin.synthesize(text)
