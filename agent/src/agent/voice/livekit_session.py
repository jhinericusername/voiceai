"""LiveKit Agents production VoiceAgent adapter.

This wraps the real LiveKit `AgentSession` room I/O. The controller still owns
all interview text; LiveKit handles the media plumbing, STT, and TTS playback.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import time
from collections.abc import Callable, Mapping
from typing import Any

from agent.voice.interface import ListenResult, VoiceAgent, VoiceMode

logger = logging.getLogger(__name__)

_INSTRUCTIONS = (
    "You are a media transport for Puddle's scripted interview controller. "
    "Do not generate autonomous replies. The controller supplies every word."
)
_DEFAULT_RECONNECT_GRACE_SECONDS = 300.0
_AGENT_RECORD_ENV = "PUDDLE_LIVEKIT_AGENT_RECORD"


def _agent_session_recording_enabled(env: Mapping[str, str] = os.environ) -> bool:
    value = env.get(_AGENT_RECORD_ENV)
    if value is None or value.strip() == "":
        return False

    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False

    raise ValueError(
        f"{_AGENT_RECORD_ENV} must be a boolean value like true/false, got {value!r}"
    )


class ParticipantDisconnectedError(RuntimeError):
    """Raised when the linked participant does not reconnect within the grace window."""


ParticipantStateCallback = Callable[[], None]


class LiveKitSessionVoiceAgent(VoiceAgent):
    """VoiceAgent backed by LiveKit AgentSession and RoomIO."""

    def __init__(
        self,
        session: Any,
        *,
        participant_reconnect_grace_seconds: float = _DEFAULT_RECONNECT_GRACE_SECONDS,
    ) -> None:
        self._session = session
        self._mode: VoiceMode = "scripted"
        self._last_spoken: str | None = None
        self._transcripts: asyncio.Queue[str] = asyncio.Queue()
        self._accepting_transcripts = False
        self._participant_reconnect_grace_seconds = participant_reconnect_grace_seconds
        self._participant_identity: str | None = None
        self._participant_connected = True
        self._participant_state_changed = asyncio.Event()
        self._on_disconnect_callback: ParticipantStateCallback | None = None
        self._on_reconnect_callback: ParticipantStateCallback | None = None
        self._on_reconnect_grace_expired_callback: ParticipantStateCallback | None = None
        self._room: Any | None = None
        self._closed = False
        self._session.on("user_input_transcribed", self._on_user_input_transcribed)
        self._session.on("agent_state_changed", self._on_agent_state_changed)
        self._session.on("user_state_changed", self._on_user_state_changed)
        self._session.on("speech_created", self._on_speech_created)
        self._session.on("error", self._on_session_error)
        self._session.on("close", self._on_session_close)

    @classmethod
    async def start(
        cls,
        job: Any,
        *,
        stt: Any,
        tts: Any,
        participant_identity: str | None = None,
    ) -> LiveKitSessionVoiceAgent:
        """Start LiveKit room I/O and link to the interview participant."""
        from livekit.agents import Agent, AgentSession, room_io

        session = AgentSession(stt=stt, tts=tts, llm=None)
        voice = cls(
            session,
            participant_reconnect_grace_seconds=float(
                os.environ.get(
                    "PUDDLE_PARTICIPANT_RECONNECT_GRACE_SECONDS",
                    _DEFAULT_RECONNECT_GRACE_SECONDS,
                )
            ),
        )
        room_options_kwargs: dict[str, Any] = {
            "text_input": False,
            "audio_input": True,
            "audio_output": True,
            "text_output": True,
            "close_on_disconnect": False,
        }
        if participant_identity is not None:
            room_options_kwargs["participant_identity"] = participant_identity

        logger.info("starting LiveKit AgentSession room I/O", extra={"room": job.room.name})
        await session.start(
            Agent(instructions=_INSTRUCTIONS),
            room=job.room,
            room_options=room_io.RoomOptions(**room_options_kwargs),
            record=_agent_session_recording_enabled(),
        )

        if participant_identity:
            participant = await job.wait_for_participant(identity=participant_identity)
        else:
            participant = await job.wait_for_participant()
        session.room_io.set_participant(participant.identity)
        voice._link_participant(job.room, participant.identity)
        logger.info(
            "linked LiveKit participant",
            extra={"room": job.room.name, "participant": participant.identity},
        )
        return voice

    @property
    def mode(self) -> VoiceMode:
        """The current voice mode."""
        return self._mode

    @property
    def last_spoken(self) -> str | None:
        """The exact last utterance sent to LiveKit TTS."""
        return self._last_spoken

    async def speak(self, text: str, mode: VoiceMode) -> None:
        """Speak controller-supplied text through the LiveKit room output."""
        self._mode = mode
        self._last_spoken = text
        logger.info("speaking utterance", extra={"mode": mode, "characters": len(text)})
        handle = self._session.say(text, allow_interruptions=False, add_to_chat_ctx=False)
        await handle.wait_for_playout()
        logger.info("finished utterance playout", extra={"mode": mode, "characters": len(text)})

    async def listen(self) -> ListenResult:
        """Wait for the next final candidate transcript from LiveKit STT."""
        logger.info(
            "waiting for final candidate transcript",
            extra={"participant": self._participant_identity},
        )
        self._drain_transcripts()
        self._accepting_transcripts = True
        try:
            while True:
                if self._closed:
                    raise RuntimeError("LiveKit agent session closed while waiting for transcript")
                if not self._participant_connected:
                    await self._wait_for_participant_reconnect()

                transcript_task = asyncio.create_task(self._transcripts.get())
                state_task = asyncio.create_task(self._participant_state_changed.wait())
                pending: set[asyncio.Task[Any]] = {transcript_task, state_task}
                try:
                    done, pending = await asyncio.wait(
                        pending,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                finally:
                    for task in pending:
                        task.cancel()

                if transcript_task in done:
                    transcript = transcript_task.result()
                    logger.info(
                        "received final candidate transcript",
                        extra={
                            "participant": self._participant_identity,
                            "characters": len(transcript),
                        },
                    )
                    return ListenResult(transcript=transcript, end_of_turn=True)

                self._participant_state_changed.clear()
        finally:
            self._accepting_transcripts = False
            self._drain_transcripts()

    def _drain_transcripts(self) -> None:
        while True:
            try:
                self._transcripts.get_nowait()
            except asyncio.QueueEmpty:
                return

    async def interrupt(self) -> None:
        """Interrupt current LiveKit speech playback."""
        await self._session.interrupt(force=True)

    def set_mode(self, mode: VoiceMode) -> None:
        """Set the voice mode without changing any spoken content."""
        self._mode = mode

    def set_participant_state_handlers(
        self,
        *,
        on_disconnect: ParticipantStateCallback | None = None,
        on_reconnect: ParticipantStateCallback | None = None,
        on_reconnect_grace_expired: ParticipantStateCallback | None = None,
    ) -> None:
        """Register controller hooks for participant disconnect lifecycle."""
        self._on_disconnect_callback = on_disconnect
        self._on_reconnect_callback = on_reconnect
        self._on_reconnect_grace_expired_callback = on_reconnect_grace_expired

    async def aclose(self) -> None:
        """Unsubscribe and close the underlying LiveKit session."""
        self._session.off("user_input_transcribed", self._on_user_input_transcribed)
        self._session.off("agent_state_changed", self._on_agent_state_changed)
        self._session.off("user_state_changed", self._on_user_state_changed)
        self._session.off("speech_created", self._on_speech_created)
        self._session.off("error", self._on_session_error)
        self._session.off("close", self._on_session_close)
        if self._room is not None:
            with contextlib.suppress(Exception):
                self._room.off("participant_disconnected", self._on_participant_disconnected)
            with contextlib.suppress(Exception):
                self._room.off("participant_connected", self._on_participant_connected)
        await self._session.aclose()

    def _on_user_input_transcribed(self, event: Any) -> None:
        transcript = str(getattr(event, "transcript", "")).strip()
        is_final = bool(getattr(event, "is_final", False))
        logger.info(
            "candidate transcript event",
            extra={
                "participant": self._participant_identity,
                "final": is_final,
                "characters": len(transcript),
                "accepting": self._accepting_transcripts,
            },
        )
        if is_final and transcript and self._accepting_transcripts:
            self._transcripts.put_nowait(transcript)

    def _link_participant(self, room: Any, participant_identity: str) -> None:
        self._room = room
        self._participant_identity = participant_identity
        self._participant_connected = True
        room.on("participant_disconnected", self._on_participant_disconnected)
        room.on("participant_connected", self._on_participant_connected)

    async def _wait_for_participant_reconnect(self) -> None:
        started_at = time.monotonic()
        logger.info(
            "waiting for participant reconnect",
            extra={
                "participant": self._participant_identity,
                "grace_seconds": self._participant_reconnect_grace_seconds,
            },
        )
        while not self._participant_connected:
            if self._closed:
                raise RuntimeError("LiveKit agent session closed while waiting for reconnect")
            remaining = self._participant_reconnect_grace_seconds - (time.monotonic() - started_at)
            if remaining <= 0:
                self._notify_reconnect_grace_expired()
                raise ParticipantDisconnectedError(
                    f"participant {self._participant_identity} did not reconnect"
                )
            self._participant_state_changed.clear()
            try:
                await asyncio.wait_for(self._participant_state_changed.wait(), timeout=remaining)
            except TimeoutError as exc:
                self._notify_reconnect_grace_expired()
                raise ParticipantDisconnectedError(
                    f"participant {self._participant_identity} did not reconnect"
                ) from exc
        logger.info("participant reconnected", extra={"participant": self._participant_identity})

    def _notify_reconnect_grace_expired(self) -> None:
        if self._on_reconnect_grace_expired_callback is not None:
            self._on_reconnect_grace_expired_callback()

    def _on_participant_disconnected(self, participant: Any) -> None:
        if getattr(participant, "identity", None) != self._participant_identity:
            return
        self._participant_connected = False
        self._participant_state_changed.set()
        if self._on_disconnect_callback is not None:
            self._on_disconnect_callback()
        logger.info("participant disconnected", extra={"participant": self._participant_identity})

    def _on_participant_connected(self, participant: Any) -> None:
        if getattr(participant, "identity", None) != self._participant_identity:
            return
        self._participant_connected = True
        room_io = getattr(self._session, "room_io", None)
        if room_io is not None:
            room_io.set_participant(self._participant_identity)
        self._participant_state_changed.set()
        if self._on_reconnect_callback is not None:
            self._on_reconnect_callback()
        logger.info("participant connected", extra={"participant": self._participant_identity})

    def _on_agent_state_changed(self, event: Any) -> None:
        logger.info(
            "agent state changed",
            extra={
                "old_state": getattr(event, "old_state", None),
                "new_state": getattr(event, "new_state", None),
            },
        )

    def _on_user_state_changed(self, event: Any) -> None:
        logger.info(
            "user state changed",
            extra={
                "old_state": getattr(event, "old_state", None),
                "new_state": getattr(event, "new_state", None),
            },
        )

    def _on_speech_created(self, event: Any) -> None:
        logger.info("speech created", extra={"source": getattr(event, "source", None)})

    def _on_session_error(self, event: Any) -> None:
        error = getattr(event, "error", None)
        logger.error(
            "LiveKit agent session error",
            extra={"error": str(error), "source": str(getattr(event, "source", ""))},
        )

    def _on_session_close(self, event: Any) -> None:
        self._closed = True
        self._participant_state_changed.set()
        logger.info(
            "LiveKit agent session closed",
            extra={
                "reason": getattr(event, "reason", None),
                "error": str(getattr(event, "error", "")),
            },
        )
