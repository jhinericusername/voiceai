"""Construct the real LiveKit AgentSession for the cascaded voice loop."""

from __future__ import annotations

from typing import Any


def build_agent_session(  # pragma: no cover - vendor wiring
    deepgram_api_key: str, cartesia_api_key: str
) -> Any:
    """Build an AgentSession: Deepgram STT (Nova-3), Cartesia TTS (Sonic-2),
    Silero VAD, multilingual semantic turn detection. No LLM - the Interview
    Controller supplies every spoken word verbatim via session.say().
    """
    from livekit.agents import AgentSession
    from livekit.plugins import cartesia, deepgram, silero
    from livekit.plugins.turn_detector.multilingual import MultilingualModel

    return AgentSession(
        stt=deepgram.STT(model="nova-3", language="en-US", api_key=deepgram_api_key),
        tts=cartesia.TTS(model="sonic-2", api_key=cartesia_api_key),
        vad=silero.VAD.load(),
        turn_handling={
            "turn_detection": MultilingualModel(),
            "endpointing": {"min_delay": 0.6, "max_delay": 3.0},
        },
    )
