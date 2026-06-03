"""Construct the real LiveKit AgentSession for the cascaded voice loop."""

from __future__ import annotations

import os
from typing import Any


def build_agent_session(  # pragma: no cover - vendor wiring
    deepgram_api_key: str, cartesia_api_key: str
) -> Any:
    """Build an AgentSession: Deepgram STT (Nova-3), Cartesia TTS (Sonic-2),
    Silero VAD turn detection. No LLM - the Interview Controller supplies every
    spoken word verbatim via session.say().

    If CARTESIA_VOICE_ID is set, Cartesia synthesizes with that cloned voice;
    otherwise the Cartesia default voice is used (graceful degradation).

    Turn detection is VAD-only. The MultilingualModel requires a worker-level
    inference executor (configured via WorkerOptions.prewarm_fnc) that we have
    not wired; without it the first end-of-turn prediction fails with
    "no inference executor". See docs/KNOWN_ISSUES.md issue #2.
    """
    from livekit.agents import AgentSession
    from livekit.plugins import cartesia, deepgram, silero

    tts_kwargs: dict[str, Any] = {"model": "sonic-2", "api_key": cartesia_api_key}
    voice_id = os.environ.get("CARTESIA_VOICE_ID", "").strip()
    if voice_id:
        tts_kwargs["voice"] = voice_id

    return AgentSession(
        stt=deepgram.STT(model="nova-3", language="en-US", api_key=deepgram_api_key),
        tts=cartesia.TTS(**tts_kwargs),
        vad=silero.VAD.load(),
        turn_handling={
            "turn_detection": "vad",
            "endpointing": {"min_delay": 0.6, "max_delay": 3.0},
        },
    )
