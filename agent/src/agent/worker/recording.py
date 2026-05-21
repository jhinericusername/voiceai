"""LiveKit Egress recording — start a composite + per-track recording, then
finalize it as a first-class workflow with retries and an explicit status.
"""

from __future__ import annotations

import asyncio
from enum import Enum
from typing import Any


class RecordingStatus(str, Enum):
    """Terminal status of the recording finalization workflow."""

    COMPLETE = "complete"
    FAILED = "failed"
    PENDING = "pending"


def build_egress_request(
    room_name: str, org_id: str, session_id: str
) -> dict[str, str]:
    """Build the Egress request: composite + per-track outputs at spec paths.

    Mirrors `backend/src/storage/layout.ts` `storagePaths(...).media`.
    """
    root = f"/{org_id}/interviews/{session_id}/media"
    return {
        "room_name": room_name,
        "composite": f"{root}/composite.mp4",
        "candidate_video": f"{root}/candidate_video.mp4",
        "candidate_audio": f"{root}/candidate_audio.m4a",
        "agent_audio": f"{root}/agent_audio.m4a",
    }


class EgressRecorder:
    """Drives a LiveKit Egress recording and its finalization workflow."""

    def __init__(
        self, client: Any, room_name: str, org_id: str, session_id: str
    ) -> None:
        self._client = client
        self._request = build_egress_request(room_name, org_id, session_id)
        self._egress_id: str | None = None

    @property
    def egress_id(self) -> str | None:
        """The Egress id returned by `start`, or None before start."""
        return self._egress_id

    async def start(self) -> str:
        """Start the recording; return and store the Egress id."""
        result = await self._client.start_egress(self._request)
        self._egress_id = result["egress_id"]
        return self._egress_id

    async def finalize(
        self, max_attempts: int = 5, delay_seconds: float = 3.0
    ) -> RecordingStatus:
        """Poll Egress until complete; retry on transient states.

        Returns COMPLETE, FAILED, or PENDING — never assumes success.
        """
        last_status: str | None = None
        for attempt in range(max_attempts):
            result = await self._client.get_egress(self._egress_id)
            last_status = result["status"]
            if last_status == "EGRESS_COMPLETE":
                return RecordingStatus.COMPLETE
            if attempt + 1 < max_attempts:
                await asyncio.sleep(delay_seconds)
        if last_status == "EGRESS_FAILED":
            return RecordingStatus.FAILED
        return RecordingStatus.PENDING
