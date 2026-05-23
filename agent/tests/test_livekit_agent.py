import asyncio

from agent.voice.interface import ListenResult
from agent.voice.livekit_agent import _TranscriptInbox


async def test_inbox_delivers_final_transcripts_in_order() -> None:
    inbox = _TranscriptInbox()
    inbox.push("I rewrote the scheduler.")
    inbox.push("It cut latency in half.")
    first = await inbox.next_turn()
    second = await inbox.next_turn()
    assert isinstance(first, ListenResult)
    assert first.transcript == "I rewrote the scheduler."
    assert first.end_of_turn is True
    assert second.transcript == "It cut latency in half."


async def test_inbox_next_turn_waits_for_a_transcript() -> None:
    inbox = _TranscriptInbox()
    task = asyncio.create_task(inbox.next_turn())
    await asyncio.sleep(0)
    assert not task.done()
    inbox.push("a late answer")
    result = await task
    assert result.transcript == "a late answer"
