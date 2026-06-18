"""Tests for AdaptiveCandidate — fake LLM job candidate for eval harness."""
from unittest.mock import MagicMock

from agent.eval.realtime.adaptive_candidate import AdaptiveCandidate


def _fake_anthropic(reply_text: str) -> MagicMock:
    client = MagicMock()
    block = MagicMock()
    block.text = reply_text
    response = MagicMock()
    response.content = [block]
    client.messages.create.return_value = response
    return client


def test_reply_returns_canned_text() -> None:
    """reply() returns exactly the text the LLM produced."""
    client = _fake_anthropic("I led a full rewrite of the payment service.")
    candidate = AdaptiveCandidate(
        client=client,
        persona="Senior backend engineer with 8 years at fintech companies.",
        model="claude-sonnet-4-5",
    )
    result = candidate.reply("Tell me about a hard project.")
    assert result == "I led a full rewrite of the payment service."


def test_reply_appends_both_turns_to_history() -> None:
    """After reply(), history contains both the user utterance and assistant reply."""
    client = _fake_anthropic("I led a full rewrite of the payment service.")
    candidate = AdaptiveCandidate(
        client=client,
        persona="Senior backend engineer.",
        model="claude-sonnet-4-5",
    )
    candidate.reply("Tell me about a hard project.")
    history = candidate._history  # noqa: SLF001
    assert len(history) == 2
    assert history[0] == {"role": "user", "content": "Tell me about a hard project."}
    assert history[1] == {
        "role": "assistant",
        "content": "I led a full rewrite of the payment service.",
    }


def test_history_accumulates_across_two_turns() -> None:
    """Two sequential reply() calls produce 4 messages in history."""
    client = _fake_anthropic("Sure, happy to elaborate.")
    candidate = AdaptiveCandidate(
        client=client,
        persona="Senior backend engineer.",
        model="claude-sonnet-4-5",
    )
    candidate.reply("Tell me about a hard project.")
    candidate.reply("Can you elaborate on the impact?")
    assert len(candidate._history) == 4  # noqa: SLF001


def test_create_called_with_model_and_system_prompt() -> None:
    """messages.create receives the injected model and a system prompt
    containing both the persona and the no-volunteering instruction."""
    persona = "Mid-level data scientist with ML pipeline experience."
    client = _fake_anthropic("We used XGBoost on a 10M-row dataset.")
    candidate = AdaptiveCandidate(
        client=client,
        persona=persona,
        model="claude-haiku-4-5",
    )
    candidate.reply("Describe your most complex ML project.")

    call_kwargs = client.messages.create.call_args.kwargs
    assert call_kwargs["model"] == "claude-haiku-4-5"
    system_prompt: str = call_kwargs["system"]
    assert persona in system_prompt
    assert "Do NOT volunteer" in system_prompt
    assert "current" in system_prompt.lower() or "CURRENT" in system_prompt


def test_create_called_with_full_history_as_messages() -> None:
    """messages.create second call receives q1+a1+q2 (3 messages) in history.

    Because _history is a mutable list passed by reference, call_args reflects
    the final state (4 items after the assistant reply is appended).  We
    verify the ordering and content of the first three slots instead of
    asserting the length at snapshot time.
    """
    client = _fake_anthropic("First answer.")
    candidate = AdaptiveCandidate(
        client=client,
        persona="Junior engineer.",
        model="claude-sonnet-4-5",
    )
    candidate.reply("Question one?")

    # Override return value for second call
    block2 = MagicMock()
    block2.text = "Second answer."
    response2 = MagicMock()
    response2.content = [block2]
    client.messages.create.return_value = response2

    candidate.reply("Question two?")

    # After two full turns history is [q1, a1, q2, a2] — 4 items total.
    assert len(candidate._history) == 4  # noqa: SLF001
    assert candidate._history[0] == {"role": "user", "content": "Question one?"}  # noqa: SLF001
    assert candidate._history[1] == {"role": "assistant", "content": "First answer."}  # noqa: SLF001
    assert candidate._history[2] == {"role": "user", "content": "Question two?"}  # noqa: SLF001
    assert candidate._history[3] == {"role": "assistant", "content": "Second answer."}  # noqa: SLF001
    # Verify the second call was made with the model we injected
    assert client.messages.create.call_count == 2
