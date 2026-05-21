from pathlib import Path
from unittest.mock import MagicMock

import pytest

from agent.domain.types import TranscriptTurn
from agent.rubric_loader import load_rubric
from agent.scoring.io_types import CategoryAssessment
from agent.scoring.probe import ProbeGenerator, ProbeRequest

RUBRIC = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")


def _fake_anthropic(text: str) -> MagicMock:
    client = MagicMock()
    block = MagicMock()
    block.text = text
    response = MagicMock()
    response.content = [block]
    client.messages.create.return_value = response
    return client


def _request() -> ProbeRequest:
    return ProbeRequest(
        category_assessment=CategoryAssessment(
            category="problem_solving", provisional_score=2, confidence=0.4,
            evidence_quotes=["I fixed a bug"],
            missing_or_ambiguous=["the impact and level of recognition"],
        ),
        transcript=[
            TranscriptTurn(turn_index=0, speaker="candidate", text="I fixed a bug.", question_id="q1"),
        ],
        probes_used=0,
        max_probes=2,
    )


def test_probe_generator_returns_followup_text() -> None:
    client = _fake_anthropic("What was the measurable impact of that fix?")
    gen = ProbeGenerator(client=client, rubric=RUBRIC)
    probe = gen.generate(_request())
    assert probe == "What was the measurable impact of that fix?"


def test_probe_prompt_includes_missing_element() -> None:
    client = _fake_anthropic("follow up")
    gen = ProbeGenerator(client=client, rubric=RUBRIC)
    gen.generate(_request())
    sent = client.messages.create.call_args.kwargs["messages"][0]["content"]
    assert "the impact and level of recognition" in sent


def test_probe_generator_refuses_when_budget_exhausted() -> None:
    client = _fake_anthropic("should not be called")
    gen = ProbeGenerator(client=client, rubric=RUBRIC)
    request = _request().model_copy(update={"probes_used": 2})
    with pytest.raises(ValueError, match="probe budget"):
        gen.generate(request)
    client.messages.create.assert_not_called()
