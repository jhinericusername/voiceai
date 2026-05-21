"""The agent event log — every spoken utterance with its reason code.

Each utterance is validated into an `AgentEvent` and appended to
`agent_events.jsonl`; the in-memory list backs end-of-interview finalization.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import ValidationError

from agent.domain.types import AgentEvent


class EventLog:
    """Records validated `AgentEvent`s to a JSONL file and an in-memory list."""

    def __init__(self, session_id: str, path: Path) -> None:
        self._session_id = session_id
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._events: list[AgentEvent] = []

    def record_utterance(
        self,
        utterance: str,
        reason_code: str,
        question_id: str | None,
        category: str | None = None,
        missing_element: str | None = None,
    ) -> AgentEvent:
        """Validate and append one agent utterance event.

        Raises `ValueError` if `reason_code` is not a known reason code.
        """
        try:
            event = AgentEvent(
                session_id=self._session_id,
                utterance=utterance,
                reason_code=reason_code,  # type: ignore[arg-type]
                question_id=question_id,
                category=category,
                missing_element=missing_element,
            )
        except ValidationError as exc:
            raise ValueError(f"invalid reason_code or event: {exc}") from exc
        self._events.append(event)
        with self._path.open("a", encoding="utf-8") as handle:
            handle.write(event.model_dump_json() + "\n")
        return event

    def events(self) -> list[AgentEvent]:
        """Return all recorded agent events, in order."""
        return list(self._events)
