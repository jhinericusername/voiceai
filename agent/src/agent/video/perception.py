"""The Video Perception Pipeline — wires the VLM, the turn-hint tracker, the
audit log, and the `integrity_events.jsonl` artifact.

Decoupled from the interview loop: a VLM failure never interrupts the
interview; integrity signals are simply marked unavailable for the session.
Integrity signals are advisory — logged and surfaced for human review, never
fed to the Scorer and never an auto-reject.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from agent.audit_log import AuditLogWriter
from agent.video.sampler import SampledFrame
from agent.video.turn_hint import TurnHintTracker


class VideoPerceptionPipeline:
    """Processes sampled frames into integrity events, audit entries, hints."""

    def __init__(
        self,
        vlm: Any,
        session_id: str,
        integrity_events_path: Path,
        audit_log: AuditLogWriter,
    ) -> None:
        self._vlm = vlm
        self._session_id = session_id
        self._integrity_events_path = integrity_events_path
        self._integrity_events_path.parent.mkdir(parents=True, exist_ok=True)
        self._audit_log = audit_log
        self.turn_hint = TurnHintTracker()
        self.signals_available = True
        self._flags: list[str] = []

    def process_frame(self, frame: SampledFrame) -> None:
        """Analyze one frame; log integrity events; update the turn hint.

        Swallows VLM failures — video is non-critical — and marks signals
        unavailable for the remainder of the session.
        """
        try:
            observation = self._vlm.analyze(frame, session_id=self._session_id)
        except Exception:  # noqa: BLE001 — video failure must not stop the call
            self.signals_available = False
            self._audit_log.write(
                "integrity_unavailable",
                {"session_id": self._session_id, "reason": "vlm_failure"},
            )
            return

        for event in observation.integrity_events:
            with self._integrity_events_path.open("a", encoding="utf-8") as handle:
                handle.write(event.model_dump_json() + "\n")
            self._flags.append(event.signal)
            self._audit_log.write(
                "integrity_signal",
                {
                    "session_id": self._session_id,
                    "signal": event.signal,
                    "frame_timestamp_seconds": event.frame_timestamp_seconds,
                },
            )
        self.turn_hint.observe(
            still_formulating=observation.turn_hint,
            timestamp_seconds=frame.timestamp_seconds,
        )

    def integrity_flags(self) -> list[str]:
        """All distinct integrity signals seen this session, for the assessment."""
        return sorted(set(self._flags))
