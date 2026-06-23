"""Regression: generate_reply must not truncate in-flight agent speech.

respond_to_tool / inject_message previously called generate_reply immediately,
which cancels the currently-playing audio and cuts the agent off mid-sentence
(e.g. when the model emits advance_question while still speaking its
acknowledgment). Both paths must now wait for the current speech to play out
first.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

from agent.voice.realtime.livekit_adapter import LiveKitRealtimeSession


def _adapter_with_speaking_session() -> tuple[LiveKitRealtimeSession, list[str]]:
    adapter = LiveKitRealtimeSession.__new__(LiveKitRealtimeSession)
    order: list[str] = []

    speech = MagicMock()
    speech.done.return_value = False

    async def _playout() -> None:
        order.append("playout")

    speech.wait_for_playout.side_effect = _playout

    session = MagicMock()
    session.current_speech = speech
    session.history.copy.return_value = MagicMock(items=[])
    session.generate_reply.side_effect = lambda **kw: order.append("generate")

    adapter._session = session
    return adapter, order


def test_respond_to_tool_finishes_speech_before_next_question() -> None:
    adapter, order = _adapter_with_speaking_session()
    asyncio.run(adapter.respond_to_tool("c0", "next question text"))
    # Acknowledgment plays out fully, THEN the next question is generated.
    assert order == ["playout", "generate"]


def test_inject_message_finishes_speech_before_steering() -> None:
    adapter, order = _adapter_with_speaking_session()
    asyncio.run(adapter.inject_message("(correction)"))
    assert order == ["playout", "generate"]


def test_no_wait_when_speech_already_done() -> None:
    adapter, order = _adapter_with_speaking_session()
    adapter._session.current_speech.done.return_value = True
    asyncio.run(adapter.inject_message("(correction)"))
    # Nothing playing → generate immediately, no playout wait.
    assert order == ["generate"]
    adapter._session.current_speech.wait_for_playout.assert_not_called()
