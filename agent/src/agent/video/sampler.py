"""Sample the candidate video track down to ~1-2 fps for the VLM.

The VLM is expensive; sampling decouples the perception pipeline from the
incoming frame rate. Sampling is deterministic — one frame per interval.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class SampledFrame(BaseModel):
    """One frame selected for VLM analysis."""

    model_config = ConfigDict(frozen=True)

    image_bytes: bytes
    timestamp_seconds: float


class FrameSampler:
    """Down-samples an incoming video frame stream to a fixed target fps."""

    def __init__(self, target_fps: float) -> None:
        if target_fps <= 0:
            raise ValueError("target_fps must be positive")
        self._interval = 1.0 / target_fps
        self._next_due = 0.0

    def offer(
        self, image_bytes: bytes, timestamp_seconds: float
    ) -> SampledFrame | None:
        """Offer a frame; return a `SampledFrame` if it should be kept, else None.

        The first frame is always kept; subsequent frames are kept once a full
        sampling interval has elapsed since the last kept frame.
        """
        if timestamp_seconds + 1e-9 < self._next_due:
            return None
        self._next_due = timestamp_seconds + self._interval
        return SampledFrame(
            image_bytes=image_bytes, timestamp_seconds=timestamp_seconds
        )
