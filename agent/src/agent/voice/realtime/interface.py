"""RealtimeSession protocol, event types, and FakeRealtimeSession test double."""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict


class InputTranscript(BaseModel):
    """Candidate turn (final transcript)."""

    model_config = ConfigDict(frozen=True)

    text: str


class OutputTranscript(BaseModel):
    """Agent turn (final transcript)."""

    model_config = ConfigDict(frozen=True)

    text: str


class ToolCall(BaseModel):
    """Tool invocation requested by the agent."""

    model_config = ConfigDict(frozen=True)

    call_id: str
    name: str
    arguments: dict  # type: ignore[type-arg]  # JSON-compatible; no bare Any needed here


RealtimeEvent = InputTranscript | OutputTranscript | ToolCall


@runtime_checkable
class RealtimeSession(Protocol):
    """Transport-seam contract shared by every realtime adapter and the runner."""

    async def start(self, *, instructions: str, tools: list[dict]) -> None:  # type: ignore[type-arg]
        """Initialise the session with a system prompt and tool schemas."""
        ...

    def events(self) -> AsyncIterator[RealtimeEvent]:
        """Yield events until the session ends."""
        ...

    async def respond_to_tool(self, call_id: str, output: str) -> None:
        """Return a tool result to the session."""
        ...

    async def inject_message(self, text: str) -> None:
        """Send an out-of-band steering message."""
        ...

    async def aclose(self) -> None:
        """Shut down the session and release resources."""
        ...


class FakeRealtimeSession:
    """Test double: replays a scripted event list and records interactions."""

    def __init__(self, scripted: list[RealtimeEvent]) -> None:
        self._scripted = list(scripted)
        self.started_with: tuple[str, list[dict]] | None = None  # type: ignore[type-arg]
        self.tool_responses: list[tuple[str, str]] = []
        self.injections: list[str] = []
        self.closed: bool = False

    async def start(self, *, instructions: str, tools: list[dict]) -> None:  # type: ignore[type-arg]
        self.started_with = (instructions, tools)

    async def events(self) -> AsyncIterator[RealtimeEvent]:  # type: ignore[override]
        for ev in self._scripted:
            yield ev

    async def respond_to_tool(self, call_id: str, output: str) -> None:
        self.tool_responses.append((call_id, output))

    async def inject_message(self, text: str) -> None:
        self.injections.append(text)

    async def aclose(self) -> None:
        self.closed = True
