from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

from agent.controller.event_log import EventLog
from agent.controller.interview import InterviewRunner
from agent.controller.states import InterviewState
from agent.rubric_loader import load_rubric
from agent.scoring.io_types import CategoryAssessment, ScorerOutput
from agent.voice.interface import ListenResult

RUBRIC = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")


def _confident(category: str) -> ScorerOutput:
    return ScorerOutput(
        assessments=[
            CategoryAssessment(
                category=category, provisional_score=3, confidence=0.95,
                evidence_quotes=["q"], missing_or_ambiguous=[],
            )
        ]
    )


def _simulated_voice() -> MagicMock:
    voice = MagicMock()
    voice.speak = AsyncMock()
    voice.interrupt = AsyncMock()
    voice.set_mode = MagicMock()
    voice.listen = AsyncMock(
        return_value=ListenResult(transcript="A full answer.", end_of_turn=True)
    )
    return voice


async def test_runner_asks_every_base_question_verbatim(tmp_path: Path) -> None:
    voice = _simulated_voice()
    scorer = MagicMock()
    scorer.score.side_effect = lambda si: _confident(si.target_categories[0])
    event_log = EventLog(session_id="s1", path=tmp_path / "events.jsonl")
    runner = InterviewRunner(
        rubric=RUBRIC, voice=voice, scorer=scorer,
        probe_generator=MagicMock(), event_log=event_log,
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
    )
    assessment = await runner.run(session_id="s1")

    spoken = [c.args[0] for c in voice.speak.await_args_list]
    for question in RUBRIC.questions:
        assert question.verbatim_text in spoken  # asked verbatim, unaltered
    assert assessment.session_id == "s1"
    assert len(assessment.category_scores) == 4


async def test_runner_probes_when_scorer_low_confidence(tmp_path: Path) -> None:
    voice = _simulated_voice()
    scorer = MagicMock()
    calls = {"n": 0}

    def score(si):  # noqa: ANN001
        calls["n"] += 1
        category = si.target_categories[0]
        if calls["n"] == 1:
            return ScorerOutput(
                assessments=[
                    CategoryAssessment(
                        category=category, provisional_score=2, confidence=0.3,
                        evidence_quotes=[], missing_or_ambiguous=["impact unclear"],
                    )
                ]
            )
        return _confident(category)

    scorer.score.side_effect = score
    probe_gen = MagicMock()
    probe_gen.generate.return_value = "What was the measurable impact?"
    event_log = EventLog(session_id="s2", path=tmp_path / "events.jsonl")
    runner = InterviewRunner(
        rubric=RUBRIC, voice=voice, scorer=scorer,
        probe_generator=probe_gen, event_log=event_log,
        clock_now=iter([float(i) for i in range(0, 8000, 5)]).__next__,
    )
    await runner.run(session_id="s2")

    spoken = [c.args[0] for c in voice.speak.await_args_list]
    assert "What was the measurable impact?" in spoken
    reason_codes = [e.reason_code for e in event_log.events()]
    assert "PROBE_LOW_CONFIDENCE" in reason_codes
    assert "SCRIPTED_QUESTION" in reason_codes
    assert reason_codes[0] == "INTRO"
    assert reason_codes[-1] == "CLOSING"


async def test_runner_reaches_review_ready_state(tmp_path: Path) -> None:
    voice = _simulated_voice()
    scorer = MagicMock()
    scorer.score.side_effect = lambda si: _confident(si.target_categories[0])
    event_log = EventLog(session_id="s3", path=tmp_path / "events.jsonl")
    runner = InterviewRunner(
        rubric=RUBRIC, voice=voice, scorer=scorer,
        probe_generator=MagicMock(), event_log=event_log,
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
    )
    await runner.run(session_id="s3")
    assert runner.state_machine.state == InterviewState.CLOSING


async def test_runner_includes_perception_integrity_flags(tmp_path: Path) -> None:
    voice = _simulated_voice()
    scorer = MagicMock()
    scorer.score.side_effect = lambda si: _confident(si.target_categories[0])
    event_log = EventLog(session_id="s4", path=tmp_path / "events.jsonl")
    perception = MagicMock()
    perception.integrity_flags.return_value = ["reading_off_screen", "multiple_faces"]
    runner = InterviewRunner(
        rubric=RUBRIC, voice=voice, scorer=scorer,
        probe_generator=MagicMock(), event_log=event_log,
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
        perception=perception,
    )
    assessment = await runner.run(session_id="s4")
    assert sorted(assessment.integrity_flags) == ["multiple_faces", "reading_off_screen"]
