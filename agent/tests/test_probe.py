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


def _request(category: str = "problem_solving", probes_used: int = 0,
             max_probes: int = 2) -> ProbeRequest:
    return ProbeRequest(
        category_assessment=CategoryAssessment(
            category=category, provisional_score=2, confidence=0.4,
            evidence_quotes=["I fixed a bug"],
            missing_or_ambiguous=["the impact and level of recognition"],
        ),
        transcript=[
            TranscriptTurn(
                turn_index=0, speaker="candidate", text="I fixed a bug.", question_id="q1"
            ),
        ],
        probes_used=probes_used,
        max_probes=max_probes,
    )


def test_scripted_probe_is_returned_when_pool_has_capacity() -> None:
    """Prakul's pattern: 99% of the time, probes come from the scripted pool."""
    client = _fake_anthropic("LLM-generated probe (should NOT be returned)")
    gen = ProbeGenerator(client=client, rubric=RUBRIC)
    probe = gen.generate(_request(category="problem_solving", probes_used=0))
    # q1 (problem_solving) has scripted_probes; index 0 starts with "Got it..."
    assert probe.startswith("Got it. Got it. Got it.")
    client.messages.create.assert_not_called()


def test_scripted_probe_index_advances_with_probes_used() -> None:
    client = _fake_anthropic("LLM-generated probe")
    gen = ProbeGenerator(client=client, rubric=RUBRIC)
    probe1 = gen.generate(_request(category="problem_solving", probes_used=0,
                                   max_probes=3))
    probe2 = gen.generate(_request(category="problem_solving", probes_used=1,
                                   max_probes=3))
    assert probe1 != probe2
    client.messages.create.assert_not_called()


def test_llm_fallback_when_pool_exhausted_but_budget_remains() -> None:
    """If the candidate has burned more probes than the scripted pool covers,
    the LLM tail-fallback drafts a targeted question."""
    client = _fake_anthropic("What was the measurable impact of that fix?")
    gen = ProbeGenerator(client=client, rubric=RUBRIC)
    # q1's scripted_probes has 3 items; probes_used=3 means pool exhausted.
    # Raise max_probes above pool size so budget isn't exhausted.
    probe = gen.generate(_request(category="problem_solving", probes_used=3,
                                  max_probes=5))
    assert probe == "What was the measurable impact of that fix?"
    sent = client.messages.create.call_args.kwargs["messages"][0]["content"]
    assert "the impact and level of recognition" in sent


def test_llm_used_when_category_has_no_scripted_probes() -> None:
    """Categories whose question has an empty scripted_probes pool (e.g.,
    agency / Q2) always go to the LLM."""
    client = _fake_anthropic("Was the outcome material?")
    gen = ProbeGenerator(client=client, rubric=RUBRIC)
    probe = gen.generate(_request(category="agency", probes_used=0))
    assert probe == "Was the outcome material?"
    client.messages.create.assert_called_once()


def test_probe_generator_refuses_when_budget_exhausted() -> None:
    client = _fake_anthropic("should not be called")
    gen = ProbeGenerator(client=client, rubric=RUBRIC)
    request = _request(probes_used=2, max_probes=2)
    with pytest.raises(ValueError, match="probe budget"):
        gen.generate(request)
    client.messages.create.assert_not_called()
