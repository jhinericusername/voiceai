"""Cascaded Voice I/O: streaming STT + turn detection + TTS behind `VoiceAgent`."""

from __future__ import annotations

from typing import Any

from agent.voice.interface import ListenResult, VoiceAgent, VoiceMode


class CascadedVoiceAgent(VoiceAgent):
    """v1 Voice I/O — streaming STT, semantic turn detection, low-latency TTS.

    Speaks only controller-supplied text. `stt`, `tts`, and `room_output` are
    injected so the worker wires concrete LiveKit plugins and tests use fakes.
    """

    def __init__(self, stt: Any, tts: Any, room_output: Any) -> None:
        self._stt = stt
        self._tts = tts
        self._room_output = room_output
        self._mode: VoiceMode = "scripted"
        self._last_spoken: str | None = None

    @property
    def mode(self) -> VoiceMode:
        """The current voice mode."""
        return self._mode

    @property
    def last_spoken(self) -> str | None:
        """The exact last utterance sent to TTS — for verbatim-fidelity checks."""
        return self._last_spoken

    async def speak(self, text: str, mode: VoiceMode) -> None:
        """Synthesize and play `text` verbatim through the room output track."""
        self._mode = mode
        self._last_spoken = text
        audio = await self._tts.synthesize(text)
        await self._room_output.play(audio)

    async def listen(self) -> ListenResult:
        """Pull the next STT turn result, including the end-of-turn flag."""
        turn = await self._stt.next_turn()
        return ListenResult(
            transcript=turn["text"], end_of_turn=bool(turn["end_of_turn"])
        )

    async def interrupt(self) -> None:
        """Stop in-progress playback so the candidate can barge in."""
        await self._room_output.stop()

    def set_mode(self, mode: VoiceMode) -> None:
        """Set the voice mode without changing any spoken content."""
        self._mode = mode
