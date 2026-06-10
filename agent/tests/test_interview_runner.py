import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.controller import interview as interview_module
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


@pytest.fixture
def fake_runner_with_completed_turns(tmp_path: Path) -> InterviewRunner:
    rubric = RUBRIC.model_copy(update={"questions": [RUBRIC.questions[0]]})
    voice = _simulated_voice()
    scorer = MagicMock()
    scorer.score.side_effect = lambda si: _confident(si.target_categories[0])
    event_log = EventLog(session_id="s-transcript", path=tmp_path / "events.jsonl")
    runner = InterviewRunner(
        rubric=rubric,
        voice=voice,
        scorer=scorer,
        probe_generator=MagicMock(),
        event_log=event_log,
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
    )
    asyncio.run(runner.run(session_id="s-transcript"))
    return runner


def test_runner_exposes_transcript_after_turns(
    fake_runner_with_completed_turns: InterviewRunner,
) -> None:
    turns = fake_runner_with_completed_turns.transcript_turns()

    assert turns
    assert turns[0].turn_index == 0
    assert turns[0].speaker in {"agent", "candidate"}


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


async def test_runner_prompts_after_silent_candidate_turn(
    tmp_path: Path,
    monkeypatch,
) -> None:  # noqa: ANN001
    monkeypatch.setattr(interview_module, "_LISTEN_INITIAL_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(interview_module, "_LISTEN_REPAIR_TIMEOUT_SECONDS", 0.01)
    rubric = RUBRIC.model_copy(update={"questions": [RUBRIC.questions[0]]})
    voice = MagicMock()
    voice.speak = AsyncMock()
    listen_calls = {"count": 0}

    async def listen() -> ListenResult:
        listen_calls["count"] += 1
        if listen_calls["count"] == 1:
            await asyncio.sleep(60)
        return ListenResult(transcript="A full answer.", end_of_turn=True)

    voice.listen = listen
    scorer = MagicMock()
    scorer.score.side_effect = lambda si: _confident(si.target_categories[0])
    event_log = EventLog(session_id="s-silent", path=tmp_path / "events.jsonl")
    runner = InterviewRunner(
        rubric=rubric, voice=voice, scorer=scorer,
        probe_generator=MagicMock(), event_log=event_log,
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
    )

    await runner.run(session_id="s-silent")

    spoken = [c.args[0] for c in voice.speak.await_args_list]
    assert "I'm listening. Please answer out loud when you're ready." in spoken
    repair_call = next(
        c
        for c in voice.speak.await_args_list
        if c.args[0] == "I'm listening. Please answer out loud when you're ready."
    )
    assert repair_call.kwargs["mode"] == "repair"
    assert "AUDIO_REPAIR" in [e.reason_code for e in event_log.events()]
    assert listen_calls["count"] == 2


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


async def test_runner_reconnect_callbacks_pause_clock_and_report_events(
    tmp_path: Path,
    monkeypatch,
) -> None:  # noqa: ANN001
    post_event = AsyncMock()
    monkeypatch.setattr(interview_module, "post_session_event", post_event)
    voice = _simulated_voice()
    handlers = {}

    def set_participant_state_handlers(**kwargs):  # noqa: ANN003, ANN202
        handlers.update(kwargs)

    voice.set_participant_state_handlers = set_participant_state_handlers
    now = {"value": 0.0}
    runner = InterviewRunner(
        rubric=RUBRIC,
        voice=voice,
        scorer=MagicMock(),
        probe_generator=MagicMock(),
        event_log=EventLog(session_id="s-reconnect", path=tmp_path / "events.jsonl"),
        clock_now=lambda: now["value"],
    )
    runner._session_id = "s-reconnect"
    runner._clock.start()

    now["value"] = 100.0
    handlers["on_disconnect"]()
    now["value"] = 250.0

    assert runner._clock.elapsed_seconds() == 100.0

    handlers["on_reconnect"]()
    now["value"] = 260.0

    assert runner._clock.elapsed_seconds() == 110.0
    await asyncio.sleep(0)
    event_types = [call.args[1] for call in post_event.await_args_list]
    assert "candidate_disconnect_started" in event_types
    assert "candidate_reconnect_within_grace" in event_types


async def test_runner_reconnect_grace_expiry_marks_incomplete_and_reports_status(
    tmp_path: Path,
    monkeypatch,
) -> None:  # noqa: ANN001
    post_event = AsyncMock()
    monkeypatch.setattr(interview_module, "post_session_event", post_event)
    voice = _simulated_voice()
    handlers = {}

    def set_participant_state_handlers(**kwargs):  # noqa: ANN003, ANN202
        handlers.update(kwargs)

    voice.set_participant_state_handlers = set_participant_state_handlers
    runner = InterviewRunner(
        rubric=RUBRIC,
        voice=voice,
        scorer=MagicMock(),
        probe_generator=MagicMock(),
        event_log=EventLog(session_id="s-expired", path=tmp_path / "events.jsonl"),
        clock_now=lambda: 0.0,
    )
    runner._session_id = "s-expired"
    runner.state_machine.transition(InterviewState.CANDIDATE_JOINED)

    handlers["on_reconnect_grace_expired"]()

    assert runner.state_machine.state == InterviewState.INCOMPLETE
    await asyncio.sleep(0)
    post_event.assert_awaited_with(
        "s-expired",
        "candidate_reconnect_grace_expired",
        {"reconnect_count": 0},
        status="incomplete",
    )
