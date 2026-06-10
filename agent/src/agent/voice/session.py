"""Construct the production LiveKit AgentSession for the cascaded voice loop.

One builder, used by the worker via LiveKitSessionVoiceAgent.start(). The
controller supplies every spoken word verbatim via session.say(); there is no
LLM. Turn-taking uses Silero VAD endpointing.
"""

from __future__ import annotations

from typing import Any


def build_agent_session(*, stt: Any, tts: Any, vad: Any) -> Any:  # pragma: no cover - vendor wiring
    """Build the production AgentSession: cascaded STT/TTS, no LLM, VAD-based
    turn detection. `vad` is the prewarmed Silero model from the worker."""
    from livekit.agents import AgentSession

    return AgentSession(
        stt=stt,
        tts=tts,
        llm=None,
        vad=vad,
        turn_detection="vad",
        min_endpointing_delay=0.5,
        max_endpointing_delay=3.0,
    )
