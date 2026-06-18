import asyncio
import threading
import time as time_module
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.controller import emit as emit_module
from agent.controller import interview as interview_module
from agent.controller.event_log import EventLog
from agent.controller.interview import InterviewRunner, _emit_best_effort
from agent.controller.states import InterviewState
from agent.rubric_loader import load_rubric
from agent.scoring.io_types import CategoryAssessment, ScorerOutput
from agent.voice.interface import ListenResult
from agent.worker.backend_client import BackendClient, PendingPost

RUBRIC = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")


def _bare_rubric(num_questions: int = 1):  # noqa: ANN201
    """A single-question rubric stripped of the rich extracted script — no
    opener/closer block, no acknowledgments, no per-question transition_in.

    Tests that assert exact emitted transcripts (turn indices, reason codes,
    payload shapes) use this so they exercise emission *mechanics* without
    coupling to Prakul's script content — the opener (`Hello. How are you?`),
    the `Awesome. Cool.` transition-ins, the acks, and the logistics closer all
    have their own dedicated tests. With the block fields cleared, `_speak_opener`
    falls back to `_INTRO_TEXT`, `_speak_closer` to `_CLOSING_TEXT`, and each
    question speaks its bare `verbatim_text`."""
    questions = [
        q.model_copy(update={"transition_in": "", "pre_question": None})
        for q in RUBRIC.questions[:num_questions]
    ]
    return RUBRIC.model_copy(
        update={
            "questions": questions,
            "opener": None,
            "closer": None,
            "style": None,
        }
    )


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
    voice.user_is_speaking = MagicMock(return_value=False)
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
    # Verbatim is spoken — possibly prefixed with transition_in ("Awesome.
    # Cool.") or a pre_question framing (Q2's YC ask). Each base question's
    # verbatim must appear as a substring of some controller utterance.
    for question in RUBRIC.questions:
        assert any(question.verbatim_text in u for u in spoken), (
            f"{question.question_id} verbatim not found in any spoken utterance"
        )
    assert assessment.session_id == "s1"
    assert len(assessment.category_scores) == 4


async def test_runner_emits_streaming_artifacts(tmp_path: Path) -> None:
    rubric = _bare_rubric()
    voice = _simulated_voice()
    scorer = MagicMock()
    scorer.score.side_effect = lambda si: _confident(si.target_categories[0])
    transcript_payloads: list[dict[str, object]] = []
    event_payloads: list[dict[str, object]] = []
    score_payloads: list[dict[str, object]] = []

    async def emit_transcript(payload: dict[str, object]) -> None:
        transcript_payloads.append(payload)

    async def emit_event(payload: dict[str, object]) -> None:
        event_payloads.append(payload)

    async def emit_score(payload: dict[str, object]) -> None:
        score_payloads.append(payload)

    event_log = EventLog(session_id="s-artifacts", path=tmp_path / "events.jsonl")
    runner = InterviewRunner(
        rubric=rubric,
        voice=voice,
        scorer=scorer,
        probe_generator=MagicMock(),
        event_log=event_log,
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
        emit_transcript_turn=emit_transcript,
        emit_agent_event=emit_event,
        emit_score_checkpoint=emit_score,
        candidate_transcript_source="test-stt:local",
    )

    await runner.run(session_id="s-artifacts")

    assert [
        (payload["turnIndex"], payload["speaker"], payload["text"])
        for payload in transcript_payloads
    ] == [
        (0, "agent", interview_module._INTRO_TEXT),
        (1, "agent", rubric.questions[0].verbatim_text),
        (2, "candidate", "A full answer."),
        (3, "agent", interview_module._CLOSING_TEXT),
    ]
    assert [
        (payload["sequence"], payload["turnIndex"], payload["reasonCode"])
        for payload in event_payloads
    ] == [
        (0, 0, "INTRO"),
        (1, 1, "SCRIPTED_QUESTION"),
        (2, 3, "CLOSING"),
    ]
    candidate_payload = next(
        payload for payload in transcript_payloads if payload["speaker"] == "candidate"
    )
    assert candidate_payload == {
        "turnIndex": 2,
        "speaker": "candidate",
        "text": "A full answer.",
        "questionId": "q1",
        "source": "test-stt:local",
    }
    assert score_payloads[0] == {
        "sequence": 0,
        "questionId": "q1",
        "model": interview_module.MODELS.scorer_model,
        "assessments": [
            {
                "category": rubric.questions[0].rubric_categories[0],
                "provisionalScore": 3,
                "confidence": 0.95,
                "evidenceQuotes": ["q"],
                "missingOrAmbiguous": [],
            }
        ],
    }


async def test_runner_continues_when_artifact_emitters_fail(
    tmp_path: Path,
    caplog,
) -> None:  # noqa: ANN001
    rubric = _bare_rubric()
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
                        category=category,
                        provisional_score=2,
                        confidence=0.3,
                        evidence_quotes=[],
                        missing_or_ambiguous=["impact unclear"],
                    )
                ]
            )
        return _confident(category)

    scorer.score.side_effect = score
    probe_gen = MagicMock()
    probe_gen.generate.return_value = "What was the measurable impact?"
    transcript_payloads: list[dict[str, object]] = []
    event_payloads: list[dict[str, object]] = []
    score_payloads: list[dict[str, object]] = []

    async def emit_transcript(payload: dict[str, object]) -> None:
        transcript_payloads.append(payload)
        raise RuntimeError("transcript unavailable")

    async def emit_event(payload: dict[str, object]) -> None:
        event_payloads.append(payload)
        raise RuntimeError("event unavailable")

    async def emit_score(payload: dict[str, object]) -> None:
        score_payloads.append(payload)
        raise RuntimeError("score unavailable")

    event_log = EventLog(session_id="s-emit-fails", path=tmp_path / "events.jsonl")
    runner = InterviewRunner(
        rubric=rubric,
        voice=voice,
        scorer=scorer,
        probe_generator=probe_gen,
        event_log=event_log,
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
        emit_transcript_turn=emit_transcript,
        emit_agent_event=emit_event,
        emit_score_checkpoint=emit_score,
    )

    assessment = await runner.run(session_id="s-emit-fails")

    assert assessment.session_id == "s-emit-fails"
    assert [payload["sequence"] for payload in event_payloads] == [0, 1, 2, 3]
    assert [payload["sequence"] for payload in score_payloads] == [0, 1]
    assert [payload["turnIndex"] for payload in transcript_payloads] == [
        0,
        1,
        2,
        3,
        4,
        5,
    ]
    assert "artifact emission failed" in caplog.text


async def test_runner_times_out_slow_artifact_emitters(
    tmp_path: Path,
    monkeypatch,
    caplog,
) -> None:  # noqa: ANN001
    monkeypatch.setattr(
        emit_module, "_ARTIFACT_EMIT_TIMEOUT_SECONDS", 0.01, raising=False
    )
    rubric = RUBRIC.model_copy(update={"questions": [RUBRIC.questions[0]]})
    voice = _simulated_voice()
    scorer = MagicMock()
    scorer.score.side_effect = lambda si: _confident(si.target_categories[0])

    async def slow_emit(_payload: dict[str, object]) -> None:
        await asyncio.sleep(60)

    event_log = EventLog(session_id="s-emit-timeout", path=tmp_path / "events.jsonl")
    runner = InterviewRunner(
        rubric=rubric,
        voice=voice,
        scorer=scorer,
        probe_generator=MagicMock(),
        event_log=event_log,
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
        emit_transcript_turn=slow_emit,
        emit_agent_event=slow_emit,
        emit_score_checkpoint=slow_emit,
    )

    assessment = await asyncio.wait_for(
        runner.run(session_id="s-emit-timeout"), timeout=1.0
    )

    assert assessment.session_id == "s-emit-timeout"
    assert "artifact emission timed out" in caplog.text


async def test_emit_best_effort_timeout_does_not_cancel_slow_backend_post(
    monkeypatch,
) -> None:  # noqa: ANN001
    monkeypatch.setattr(
        emit_module, "_ARTIFACT_EMIT_TIMEOUT_SECONDS", 0.01, raising=False
    )

    class SlowFailingTransport:
        def __init__(self) -> None:
            self.cancelled = False

        async def post(self, _path: str, _payload: dict[str, object]) -> None:
            try:
                await asyncio.sleep(0.05)
            except asyncio.CancelledError:
                self.cancelled = True
                raise
            raise OSError("late backend failure")

    transport = SlowFailingTransport()
    client = BackendClient(session_id="sess-slow", transport=transport)
    payload = {"turnIndex": 1, "speaker": "candidate"}

    await _emit_best_effort("transcript_turn", client.post_transcript_turn, payload)

    for _ in range(20):
        if client.pending:
            break
        await asyncio.sleep(0.01)

    assert transport.cancelled is False
    assert client.pending == [
        PendingPost("/internal/sessions/sess-slow/transcript-turns", payload),
    ]


async def test_runner_probes_when_scorer_low_confidence(tmp_path: Path) -> None:
    rubric = _bare_rubric()
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
    transcript_payloads: list[dict[str, object]] = []
    event_payloads: list[dict[str, object]] = []
    score_payloads: list[dict[str, object]] = []

    async def emit_transcript(payload: dict[str, object]) -> None:
        transcript_payloads.append(payload)

    async def emit_event(payload: dict[str, object]) -> None:
        event_payloads.append(payload)

    async def emit_score(payload: dict[str, object]) -> None:
        score_payloads.append(payload)

    event_log = EventLog(session_id="s2", path=tmp_path / "events.jsonl")
    runner = InterviewRunner(
        rubric=rubric,
        voice=voice,
        scorer=scorer,
        probe_generator=probe_gen,
        event_log=event_log,
        clock_now=iter([float(i) for i in range(0, 8000, 5)]).__next__,
        emit_transcript_turn=emit_transcript,
        emit_agent_event=emit_event,
        emit_score_checkpoint=emit_score,
    )
    await runner.run(session_id="s2")

    spoken = [c.args[0] for c in voice.speak.await_args_list]
    assert "What was the measurable impact?" in spoken
    reason_codes = [e.reason_code for e in event_log.events()]
    assert "PROBE_LOW_CONFIDENCE" in reason_codes
    assert "SCRIPTED_QUESTION" in reason_codes
    assert reason_codes[0] == "INTRO"
    assert reason_codes[-1] == "CLOSING"
    assert [payload["sequence"] for payload in score_payloads] == [0, 1]
    assert [
        (payload["turnIndex"], payload["speaker"], payload["text"])
        for payload in transcript_payloads
    ] == [
        (0, "agent", interview_module._INTRO_TEXT),
        (1, "agent", rubric.questions[0].verbatim_text),
        (2, "candidate", "A full answer."),
        (3, "agent", "What was the measurable impact?"),
        (4, "candidate", "A full answer."),
        (5, "agent", interview_module._CLOSING_TEXT),
    ]
    assert [
        (payload["sequence"], payload["turnIndex"], payload["reasonCode"])
        for payload in event_payloads
    ] == [
        (0, 0, "INTRO"),
        (1, 1, "SCRIPTED_QUESTION"),
        (2, 3, "PROBE_LOW_CONFIDENCE"),
        (3, 5, "CLOSING"),
    ]


async def test_runner_prompts_after_silent_candidate_turn(
    tmp_path: Path,
    monkeypatch,
) -> None:  # noqa: ANN001
    monkeypatch.setattr(interview_module, "_LISTEN_INITIAL_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(interview_module, "_LISTEN_REPAIR_TIMEOUT_SECONDS", 0.01)
    # Bare rubric isolates question-level audio repair — no opener listens, no
    # transition-in prefix, no logistics closer to perturb the emitted turns.
    rubric = _bare_rubric()
    voice = MagicMock()
    voice.speak = AsyncMock()
    voice.user_is_speaking = MagicMock(return_value=False)
    listen_calls = {"count": 0}

    async def listen() -> ListenResult:
        listen_calls["count"] += 1
        if listen_calls["count"] == 1:
            await asyncio.sleep(60)
        return ListenResult(transcript="A full answer.", end_of_turn=True)

    voice.listen = listen
    scorer = MagicMock()
    scorer.score.side_effect = lambda si: _confident(si.target_categories[0])
    transcript_payloads: list[dict[str, object]] = []
    event_payloads: list[dict[str, object]] = []

    async def emit_transcript(payload: dict[str, object]) -> None:
        transcript_payloads.append(payload)

    async def emit_event(payload: dict[str, object]) -> None:
        event_payloads.append(payload)

    event_log = EventLog(session_id="s-silent", path=tmp_path / "events.jsonl")
    runner = InterviewRunner(
        rubric=rubric,
        voice=voice,
        scorer=scorer,
        probe_generator=MagicMock(),
        event_log=event_log,
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
        emit_transcript_turn=emit_transcript,
        emit_agent_event=emit_event,
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
    assert [
        (payload["turnIndex"], payload["speaker"], payload["text"])
        for payload in transcript_payloads
    ] == [
        (0, "agent", interview_module._INTRO_TEXT),
        (1, "agent", rubric.questions[0].verbatim_text),
        (2, "agent", "I'm listening. Please answer out loud when you're ready."),
        (3, "candidate", "A full answer."),
        (4, "agent", interview_module._CLOSING_TEXT),
    ]
    assert [
        (payload["sequence"], payload["turnIndex"], payload["reasonCode"])
        for payload in event_payloads
    ] == [
        (0, 0, "INTRO"),
        (1, 1, "SCRIPTED_QUESTION"),
        (2, 2, "AUDIO_REPAIR"),
        (3, 4, "CLOSING"),
    ]


async def test_runner_times_out_after_finite_silence_repair_attempts(
    tmp_path: Path,
    monkeypatch,
) -> None:  # noqa: ANN001
    monkeypatch.setattr(interview_module, "_LISTEN_INITIAL_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(interview_module, "_LISTEN_REPAIR_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(interview_module, "_LISTEN_MAX_REPAIR_ATTEMPTS", 2)
    rubric = _bare_rubric()
    voice = MagicMock()
    voice.speak = AsyncMock()
    # A silent candidate is not speaking — without this, the MagicMock's truthy
    # default makes _candidate_is_speaking() perpetually extend instead of
    # exhausting repair attempts.
    voice.user_is_speaking = MagicMock(return_value=False)

    async def listen() -> ListenResult:
        await asyncio.sleep(60)
        return ListenResult(transcript="never reached", end_of_turn=True)

    voice.listen = listen
    event_log = EventLog(session_id="s-silence-timeout", path=tmp_path / "events.jsonl")
    runner = InterviewRunner(
        rubric=rubric,
        voice=voice,
        scorer=MagicMock(),
        probe_generator=MagicMock(),
        event_log=event_log,
        clock_now=lambda: 0.0,
    )

    with pytest.raises(interview_module.CandidateSilenceTimeoutError):
        await asyncio.wait_for(runner._listen("q1"), timeout=0.5)

    assert runner.state_machine.state == InterviewState.INCOMPLETE
    assert voice.speak.await_count == 2
    assert [event.reason_code for event in event_log.events()] == [
        "AUDIO_REPAIR",
        "AUDIO_REPAIR",
    ]


async def test_runner_does_not_nag_while_candidate_is_speaking(
    tmp_path: Path,
    monkeypatch,
) -> None:  # noqa: ANN001
    monkeypatch.setattr(interview_module, "_LISTEN_INITIAL_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(interview_module, "_LISTEN_REPAIR_TIMEOUT_SECONDS", 0.01)
    rubric = RUBRIC.model_copy(
        update={"questions": [RUBRIC.questions[0]], "opener": None}
    )
    voice = MagicMock()
    voice.speak = AsyncMock()
    voice.user_is_speaking = MagicMock(return_value=True)  # candidate mid-answer
    listen_calls = {"count": 0}

    async def listen() -> ListenResult:
        listen_calls["count"] += 1
        if listen_calls["count"] == 1:
            await asyncio.sleep(60)  # first wait times out
        return ListenResult(transcript="A full answer.", end_of_turn=True)

    voice.listen = listen
    scorer = MagicMock()
    scorer.score.side_effect = lambda si: _confident(si.target_categories[0])
    event_log = EventLog(session_id="s-speaking", path=tmp_path / "events.jsonl")
    runner = InterviewRunner(
        rubric=rubric, voice=voice, scorer=scorer,
        probe_generator=MagicMock(), event_log=event_log,
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
    )

    await runner.run(session_id="s-speaking")

    spoken = [c.args[0] for c in voice.speak.await_args_list]
    assert "I'm listening. Please answer out loud when you're ready." not in spoken
    assert "AUDIO_REPAIR" not in [e.reason_code for e in event_log.events()]


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


async def test_ack_is_spoken_while_scoring_runs(tmp_path: Path) -> None:
    """The controller must NOT await scoring before acknowledging the answer.

    The fake scorer (running in a worker thread) blocks until the ack has been
    spoken; if the controller serialized score-then-speak this would time out.
    """
    rubric = RUBRIC.model_copy(update={"questions": [RUBRIC.questions[0]]})
    acks = set(RUBRIC.style.acknowledgments)
    ack_spoken = threading.Event()

    voice = _simulated_voice()

    async def speak(text: str, mode: str = "scripted") -> None:  # noqa: ARG001
        if text in acks:
            ack_spoken.set()

    voice.speak = AsyncMock(side_effect=speak)

    def blocking_score(si):  # noqa: ANN001
        assert ack_spoken.wait(timeout=5.0), "ack not spoken while scoring ran"
        return _confident(si.target_categories[0])

    scorer = MagicMock()
    scorer.score.side_effect = blocking_score
    runner = InterviewRunner(
        rubric=rubric,
        voice=voice,
        scorer=scorer,
        probe_generator=MagicMock(),
        event_log=EventLog(session_id="s-conc", path=tmp_path / "events.jsonl"),
        clock_now=time_module.monotonic,
    )

    assessment = await asyncio.wait_for(runner.run(session_id="s-conc"), timeout=30)
    assert assessment.session_id == "s-conc"


async def test_each_candidate_answer_is_acknowledged_immediately(
    tmp_path: Path,
) -> None:
    """After every question-loop candidate turn, the next agent utterance is an
    acknowledgment from the rubric pool."""
    rubric = RUBRIC.model_copy(update={"questions": [RUBRIC.questions[0]]})
    voice = _simulated_voice()
    scorer = MagicMock()
    scorer.score.side_effect = lambda si: _confident(si.target_categories[0])
    runner = InterviewRunner(
        rubric=rubric,
        voice=voice,
        scorer=scorer,
        probe_generator=MagicMock(),
        event_log=EventLog(session_id="s-ack", path=tmp_path / "events.jsonl"),
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
    )
    await runner.run(session_id="s-ack")

    turns = runner.transcript_turns()
    acks = set(RUBRIC.style.acknowledgments)
    question_answer_indices = [
        i
        for i, t in enumerate(turns)
        if t.speaker == "candidate" and t.question_id not in (None, "opener")
    ]
    assert question_answer_indices, "no question answers captured"
    for i in question_answer_indices:
        following_agent = next((t for t in turns[i + 1 :] if t.speaker == "agent"), None)
        assert following_agent is not None
        assert following_agent.text in acks, (
            f"expected ack right after answer turn {i}, got: {following_agent.text!r}"
        )


async def test_probe_generation_runs_in_worker_thread(tmp_path: Path) -> None:
    """probe_generator.generate must not run on the event loop thread."""
    rubric = RUBRIC.model_copy(update={"questions": [RUBRIC.questions[0]]})
    voice = _simulated_voice()
    seen_threads: list[str] = []
    calls = {"n": 0}

    def score(si):  # noqa: ANN001
        calls["n"] += 1
        category = si.target_categories[0]
        if calls["n"] == 1:  # force one probe
            return ScorerOutput(
                assessments=[
                    CategoryAssessment(
                        category=category, provisional_score=2, confidence=0.2,
                        evidence_quotes=[], missing_or_ambiguous=["depth unclear"],
                    )
                ]
            )
        return _confident(category)

    def generate(req):  # noqa: ANN001
        seen_threads.append(threading.current_thread().name)
        return "Can you walk me through the hardest part?"

    scorer = MagicMock()
    scorer.score.side_effect = score
    probe_generator = MagicMock()
    probe_generator.generate.side_effect = generate
    runner = InterviewRunner(
        rubric=rubric,
        voice=voice,
        scorer=scorer,
        probe_generator=probe_generator,
        event_log=EventLog(session_id="s-probe-thread", path=tmp_path / "events.jsonl"),
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
    )
    await runner.run(session_id="s-probe-thread")

    assert probe_generator.generate.called
    main_thread = threading.main_thread().name
    assert all(name != main_thread for name in seen_threads), (
        "probe generation ran on the event loop thread"
    )


async def test_ack_latency_budget_with_slow_scorer(tmp_path: Path) -> None:
    """Latency budget: with a 500 ms scorer, the ack must start within 300 ms
    of the answer landing — the candidate never waits on the LLM."""
    rubric = RUBRIC.model_copy(update={"questions": [RUBRIC.questions[0]]})
    acks = set(RUBRIC.style.acknowledgments)
    answer_returned_at: list[float] = []
    ack_started_at: list[float] = []

    voice = _simulated_voice()

    async def listen() -> ListenResult:
        answer_returned_at.append(time_module.monotonic())
        return ListenResult(transcript="A full answer.", end_of_turn=True)

    async def speak(text: str, mode: str = "scripted") -> None:  # noqa: ARG001
        if text in acks:
            ack_started_at.append(time_module.monotonic())

    voice.listen = AsyncMock(side_effect=listen)
    voice.speak = AsyncMock(side_effect=speak)

    def slow_score(si):  # noqa: ANN001
        time_module.sleep(0.5)
        return _confident(si.target_categories[0])

    scorer = MagicMock()
    scorer.score.side_effect = slow_score
    runner = InterviewRunner(
        rubric=rubric,
        voice=voice,
        scorer=scorer,
        probe_generator=MagicMock(),
        event_log=EventLog(session_id="s-budget", path=tmp_path / "events.jsonl"),
        clock_now=time_module.monotonic,
    )
    await asyncio.wait_for(runner.run(session_id="s-budget"), timeout=30)

    assert ack_started_at, "no ack observed"
    # The last listen before the first ack is the question answer (earlier
    # listens are opener turns, which are never acked).
    preceding_answers = [t for t in answer_returned_at if t < ack_started_at[0]]
    gap = ack_started_at[0] - preceding_answers[-1]
    # generous CI bound; the point is it's not 500ms+ (serialized scoring)
    assert gap < 0.3, f"ack started {gap:.3f}s after the answer"
