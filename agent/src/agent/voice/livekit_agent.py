"""LiveKitVoiceAgent — the VoiceAgent ABC backed by a real AgentSession."""

from __future__ import annotations

import asyncio
from typing import Any

from agent.voice.interface import ListenResult, VoiceAgent, VoiceMode


class _TranscriptInbox:
    """Buffers final candidate transcripts so `listen()` can await one turn."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue[str] = asyncio.Queue()

    def push(self, transcript: str) -> None:
        """Record one finalized candidate turn transcript."""
        self._queue.put_nowait(transcript)

    async def next_turn(self) -> ListenResult:
        """Await the next finalized candidate turn."""
        transcript = await self._queue.get()
        return ListenResult(transcript=transcript, end_of_turn=True)


class LiveKitVoiceAgent(VoiceAgent):  # pragma: no cover — live AgentSession wiring
    """Drives a live `AgentSession`: speaks verbatim text, hears the candidate.

    The session is started by the worker entrypoint (Task 1.6); this adapter
    subscribes to its final-transcript events and exposes the controller-facing
    speak/listen/interrupt/set_mode surface.
    """

    def __init__(self, session: Any) -> None:
        self._session = session
        self._inbox = _TranscriptInbox()
        self._mode: VoiceMode = "scripted"
        # Per Task 1.1 findings §6: sync callback, event payload is a
        # UserInputTranscribedEvent with .transcript and .is_final.
        self._session.on("user_input_transcribed", self._on_transcript)

    def _on_transcript(self, event: Any) -> None:
        if getattr(event, "is_final", False) and event.transcript.strip():
            self._inbox.push(event.transcript)

    async def speak(self, text: str, mode: VoiceMode) -> None:
        self._mode = mode
        # Per Task 1.1 findings §4: say() returns a SpeechHandle; awaiting it
        # blocks until full playout completes.
        handle = self._session.say(text)
        try:
            await handle
        except asyncio.CancelledError:
            handle.interrupt(force=True)  # SpeechHandle.interrupt is sync
            raise

    async def listen(self) -> ListenResult:
        return await self._inbox.next_turn()

    async def interrupt(self) -> None:
        # Per Task 1.1 findings §5: session.interrupt() returns asyncio.Future.
        await self._session.interrupt()

    def set_mode(self, mode: VoiceMode) -> None:
        self._mode = mode
