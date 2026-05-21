"""Gemini Flash VLM integrity analysis — non-scoring side signals only.

The VLM detects integrity concerns (reading off-screen, multiple faces,
candidate absent) and a turn-taking hint. Output is NEVER a scoring input and
NEVER an auto-reject — it is logged and surfaced to a human reviewer.
NO facial identification or emotion analysis is performed.
"""

from __future__ import annotations

import json
from typing import Any

from google.genai import types
from pydantic import BaseModel, ConfigDict

from agent.config import MODELS
from agent.domain.types import IntegrityEvent
from agent.video.sampler import SampledFrame

_VLM_INSTRUCTIONS = (
    "You inspect ONE webcam frame from a candidate during a remote interview. "
    "Report only these observations. Do NOT identify the person, do NOT infer "
    "emotion, mood, or demeanor. Return STRICT JSON only matching: "
    '{"reading_off_screen": bool, "multiple_faces": bool, '
    '"candidate_absent": bool, "still_formulating": bool}. '
    "reading_off_screen: gaze persistently directed off-screen as if reading. "
    "multiple_faces: more than one face visible. "
    "candidate_absent: no face visible. "
    "still_formulating: the person looks mid-thought, not finished speaking."
)

# Maps the VLM's boolean flags to the IntegritySignal literals.
_SIGNAL_FLAGS = {
    "reading_off_screen": "reading_off_screen",
    "multiple_faces": "multiple_faces",
    "candidate_absent": "candidate_absent",
}


class VlmObservation(BaseModel):
    """One frame's VLM result: integrity events plus the turn hint."""

    model_config = ConfigDict(frozen=True)

    integrity_events: list[IntegrityEvent]
    turn_hint: bool


def _extract_json(text: str) -> dict[str, Any]:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"no JSON object in VLM output: {text!r}")
    return json.loads(text[start : end + 1])


class IntegrityVLM:
    """Runs Gemini Flash over a sampled frame for integrity + turn signals."""

    def __init__(self, client: Any) -> None:
        self._client = client

    def analyze(
        self, frame: SampledFrame, session_id: str = ""
    ) -> VlmObservation:
        """Analyze one frame; return integrity events and the turn hint."""
        response = self._client.models.generate_content(
            model=MODELS.vlm_model,
            contents=[
                _VLM_INSTRUCTIONS,
                types.Part.from_bytes(
                    data=frame.image_bytes, mime_type="image/jpeg"
                ),
            ],
        )
        flags = _extract_json(response.text)
        events: list[IntegrityEvent] = []
        for flag, signal in _SIGNAL_FLAGS.items():
            if flags.get(flag):
                events.append(
                    IntegrityEvent(
                        session_id=session_id,
                        signal=signal,  # type: ignore[arg-type]
                        confidence=1.0,
                        frame_timestamp_seconds=frame.timestamp_seconds,
                    )
                )
        return VlmObservation(
            integrity_events=events,
            turn_hint=bool(flags.get("still_formulating")),
        )
