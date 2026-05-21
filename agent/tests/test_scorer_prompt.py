from pathlib import Path

from agent.domain.types import TranscriptTurn
from agent.rubric_loader import load_rubric
from agent.scoring.io_types import ScorerInput
from agent.scoring.prompt import build_scorer_messages

RUBRIC = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")


def test_system_block_contains_rubric_and_is_cacheable() -> None:
    si = ScorerInput(
        script_version="pilot-v1", question_id="q1",
        target_categories=["problem_solving"],
        transcript=[TranscriptTurn(turn_index=0, speaker="agent", text="q1", question_id="q1")],
    )
    system, messages = build_scorer_messages(RUBRIC, si)
    # System is a list of content blocks; the rubric block is cache-flagged.
    assert isinstance(system, list)
    rubric_block = system[-1]
    assert rubric_block["cache_control"] == {"type": "ephemeral"}
    assert "Problem Solving" in rubric_block["text"]
    assert "Front page on Hacker News." in rubric_block["text"]


def test_user_message_contains_transcript_and_target_categories() -> None:
    si = ScorerInput(
        script_version="pilot-v1", question_id="q1",
        target_categories=["problem_solving"],
        transcript=[
            TranscriptTurn(turn_index=0, speaker="agent", text="Tell me.", question_id="q1"),
            TranscriptTurn(
                turn_index=1, speaker="candidate", text="I rewrote it.", question_id="q1"
            ),
        ],
    )
    _system, messages = build_scorer_messages(RUBRIC, si)
    user_text = messages[0]["content"]
    assert "I rewrote it." in user_text
    assert "problem_solving" in user_text
