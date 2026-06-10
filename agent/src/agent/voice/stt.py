"""Deepgram Nova-3 streaming STT adapter for the cascaded Voice I/O layer."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class SttTranscript(BaseModel):
    """A finalized STT transcript with a reliability flag."""

    model_config = ConfigDict(frozen=True)

    text: str
    is_final: bool
    unreliable: bool


def build_deepgram_stt(api_key: str) -> Any:  # pragma: no cover — vendor wiring
    """Construct the LiveKit Deepgram plugin tuned for an English interview.

    Defaults are made explicit: nova-3 + en-US, interim results for
    responsiveness, smart_format for clean numbers/dates, no_delay so finals
    aren't held back, a 200ms endpoint so one answer coalesces into fewer
    segments, and filler_words off (no semantic EOU model in this pipeline)."""
    from livekit.plugins import deepgram

    return deepgram.STT(
        model="nova-3",
        language="en-US",
        api_key=api_key,
        interim_results=True,
        punctuate=True,
        smart_format=True,
        no_delay=True,
        endpointing_ms=200,
        filler_words=False,
    )


class DeepgramSTT:
    """Wraps the Deepgram streaming plugin into the `stt` shape Voice I/O needs.

    `next_turn` returns the dict `CascadedVoiceAgent.listen` expects;
    `next_final_transcript` returns a typed `SttTranscript` with reliability.
    """

    def __init__(self, plugin: Any, min_confidence: float = 0.5) -> None:
        self._plugin = plugin
        self._min_confidence = min_confidence

    async def next_final_transcript(self) -> SttTranscript:
        """Consume the stream until a final event; return it typed."""
        text = ""
        confidence = 1.0
        async for event in self._plugin.stream():
            text = event["text"]
            if event["type"] == "final":
                confidence = float(event.get("confidence", 1.0))
                break
        return SttTranscript(
            text=text,
            is_final=True,
            unreliable=confidence < self._min_confidence,
        )

    async def next_turn(self) -> dict[str, Any]:
        """Return `{text, end_of_turn}` for `CascadedVoiceAgent.listen`."""
        transcript = await self.next_final_transcript()
        return {"text": transcript.text, "end_of_turn": True}
