"""The `VoiceAgent` abstraction — the swap point for a future S2S model.

A cascaded STT+turn-detection+TTS implementation satisfies this in v1; a
speech-to-speech model can later be wrapped behind the identical interface.
"""

from __future__ import annotations

import abc
from typing import Literal

from pydantic import BaseModel, ConfigDict

VoiceMode = Literal["scripted", "clarifying", "repair", "closing"]


class ListenResult(BaseModel):
    """One listening result: the transcript so far and whether the turn ended."""

    model_config = ConfigDict(frozen=True)

    transcript: str
    end_of_turn: bool


class VoiceAgent(abc.ABC):
    """Hear the candidate and speak — under full Interview Controller control.

    The controller supplies every word spoken; this layer never generates text.
    """

    @abc.abstractmethod
    async def speak(self, text: str, mode: VoiceMode) -> None:
        """Speak exactly `text`. The text is never paraphrased or altered."""

    @abc.abstractmethod
    async def listen(self) -> ListenResult:
        """Return the current transcript and an end-of-turn signal."""

    @abc.abstractmethod
    async def interrupt(self) -> None:
        """Stop any in-progress speech immediately (candidate barge-in)."""

    @abc.abstractmethod
    def set_mode(self, mode: VoiceMode) -> None:
        """Set the voice mode — adjusts pacing/turn sensitivity, not content."""
