"""Tests for GuardrailMonitor — TDD: tests written before implementation."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

from agent.controller.realtime.guardrail_monitor import GuardrailMonitor


def _fake_client(block_text: str) -> MagicMock:
    """Return a MagicMock Anthropic client whose messages.create returns a single block."""
    client = MagicMock()
    block = MagicMock()
    block.text = block_text
    response = MagicMock()
    response.content = [block]
    client.messages.create.return_value = response
    return client


def test_fabrication_payload_returns_violation() -> None:
    """A fabrication JSON response yields violation=True with kind 'fabrication'."""
    payload = {"violation": True, "kind": "fabrication", "correction": "Don't claim the team is 50 people."}
    client = _fake_client(json.dumps(payload))
    monitor = GuardrailMonitor(client=client, model="claude-haiku-4-5")

    verdict = monitor.check_turn("We have a team of 50 engineers working on this.")

    assert verdict.violation is True
    assert verdict.kind == "fabrication"
    assert verdict.correction != ""


def test_clean_payload_returns_no_violation() -> None:
    """A clean JSON response yields violation=False."""
    payload = {"violation": False, "kind": "none", "correction": ""}
    client = _fake_client(json.dumps(payload))
    monitor = GuardrailMonitor(client=client, model="claude-haiku-4-5")

    verdict = monitor.check_turn("Tell me about a time you solved a hard problem.")

    assert verdict.violation is False
    assert verdict.kind == "none"
    assert verdict.correction == ""


def test_malformed_json_fails_open() -> None:
    """Malformed JSON response from the model yields fail-open: violation=False."""
    client = _fake_client("not json at all")
    monitor = GuardrailMonitor(client=client, model="claude-haiku-4-5")

    verdict = monitor.check_turn("Some interviewer text.")

    assert verdict.violation is False
    assert verdict.kind == "none"
    assert verdict.correction == ""


def test_network_error_fails_open() -> None:
    """A network exception during the API call yields fail-open: violation=False."""
    client = MagicMock()
    client.messages.create.side_effect = ConnectionError("network unreachable")
    monitor = GuardrailMonitor(client=client, model="claude-haiku-4-5")

    verdict = monitor.check_turn("Some interviewer text.")

    assert verdict.violation is False
    assert verdict.kind == "none"
    assert verdict.correction == ""
