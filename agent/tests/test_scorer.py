import json
from pathlib import Path
from unittest.mock import MagicMock

from agent.domain.types import TranscriptTurn
from agent.rubric_loader import load_rubric
from agent.scoring.io_types import ScorerInput
from agent.scoring.scorer import Scorer

RUBRIC = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")


def _fake_anthropic(payload: dict) -> MagicMock:
    client = MagicMock()
    block = MagicMock()
    block.text = json.dumps(payload)
    response = MagicMock()
    response.content = [block]
    client.messages.create.return_value = response
    return client


def test_scorer_parses_structured_output() -> None:
    client = _fake_anthropic(
        {
            "assessments": [
                {
                    "category": "problem_solving",
                    "provisional_score": 3,
                    "confidence": 0.82,
                    "evidence_quotes": ["I rewrote the scheduler"],
                    "missing_or_ambiguous": [],
                }
            ]
        }
    )
    scorer = Scorer(client=client, rubric=RUBRIC)
    si = ScorerInput(
        script_version="pilot-v1", question_id="q1",
        target_categories=["problem_solving"],
        transcript=[TranscriptTurn(turn_index=0, speaker="candidate", text="x", question_id="q1")],
    )
    out = scorer.score(si)
    assert out.by_category()["problem_solving"].provisional_score == 3
    assert out.by_category()["problem_solving"].confidence == 0.82


def test_scorer_passes_cacheable_system_to_anthropic() -> None:
    client = _fake_anthropic({"assessments": []})
    scorer = Scorer(client=client, rubric=RUBRIC)
    si = ScorerInput(
        script_version="pilot-v1", question_id="q1", target_categories=["agency"],
        transcript=[TranscriptTurn(turn_index=0, speaker="candidate", text="x", question_id="q1")],
    )
    scorer.score(si)
    kwargs = client.messages.create.call_args.kwargs
    assert kwargs["system"][-1]["cache_control"] == {"type": "ephemeral"}
    assert kwargs["model"]  # model id is supplied from config


def test_scorer_raises_on_non_json_output() -> None:
    client = _fake_anthropic({})
    block = MagicMock()
    block.text = "I cannot answer that."
    client.messages.create.return_value.content = [block]
    scorer = Scorer(client=client, rubric=RUBRIC)
    si = ScorerInput(
        script_version="pilot-v1", question_id="q1", target_categories=["agency"],
        transcript=[TranscriptTurn(turn_index=0, speaker="candidate", text="x", question_id="q1")],
    )
    import pytest

    from agent.scoring.scorer import ScorerParseError

    with pytest.raises(ScorerParseError):
        scorer.score(si)
