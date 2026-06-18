"""Adaptive LLM-driven job candidate for the eval harness.

Simulates a job candidate responding to interviewer questions.  The caller
injects a sync ``anthropic.Anthropic``-shaped client so no live network call
is made in unit tests.
"""
from __future__ import annotations

from typing import Any

_SYSTEM_TEMPLATE = """\
You are a job candidate in a screening interview.
Candidate background: {persona}
Answer the interviewer's CURRENT question concretely and briefly.
Do NOT volunteer answers to questions you weren't asked.\
"""

_MAX_TOKENS = 300


class AdaptiveCandidate:
    """Stateful fake candidate that answers interviewer questions via an LLM.

    Keeps a rolling message history so the LLM has context across turns.
    """

    def __init__(self, client: Any, persona: str, model: str) -> None:  # client: Anthropic-shaped
        self._client = client
        self._persona = persona
        self._model = model
        self._history: list[dict[str, str]] = []

    def reply(self, agent_utterance: str) -> str:
        """Respond to the interviewer's current utterance.

        Appends *agent_utterance* as a ``user`` message, calls the LLM with
        the full rolling history, appends the reply as an ``assistant``
        message, and returns the reply text.
        """
        self._history.append({"role": "user", "content": agent_utterance})

        response = self._client.messages.create(
            model=self._model,
            max_tokens=_MAX_TOKENS,
            system=_SYSTEM_TEMPLATE.format(persona=self._persona),
            messages=self._history,
        )
        text: str = "".join(block.text for block in response.content)

        self._history.append({"role": "assistant", "content": text})
        return text
