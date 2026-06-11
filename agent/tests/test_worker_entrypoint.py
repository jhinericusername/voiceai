import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.domain.types import Assessment, CategoryScore, TranscriptTurn
from agent.worker.entrypoint import InterviewJobContext, build_session_context

_META = (
    '{"session_id": "sess1", "org_id": "org1", '
    '"script_version": "pilot-v1", "candidate_email": "c@example.com"}'
)


def _fake_ctx(metadata: str | None, room_name: str = "interview-sess1") -> MagicMock:
    ctx = MagicMock()
    ctx.metadata = None  # force the job.job.metadata fallback path
    ctx.job.metadata = metadata
    ctx.room.name = room_name
    return ctx


def test_build_session_context_reads_job_metadata() -> None:
    ctx = build_session_context(_fake_ctx(_META))
    assert isinstance(ctx, InterviewJobContext)
    assert ctx.session_id == "sess1"
    assert ctx.org_id == "org1"
    assert ctx.script_version == "pilot-v1"
    assert ctx.room_name == "interview-sess1"


def test_build_session_context_extracts_livekit_job_metadata() -> None:
    job = SimpleNamespace(
        job=SimpleNamespace(
            metadata=(
                '{"session_id": "sess1", "org_id": "org1", '
                '"script_version": "pilot-v1", "candidate_email": "c@example.com"}'
            )
        ),
        room=SimpleNamespace(name="interview-sess1"),
    )
    ctx = build_session_context(job)
    assert isinstance(ctx, InterviewJobContext)
    assert ctx.session_id == "sess1"
    assert ctx.org_id == "org1"
    assert ctx.script_version == "pilot-v1"
    assert ctx.room_name == "interview-sess1"


def test_build_session_context_rejects_missing_session_id() -> None:
    ctx = _fake_ctx('{"org_id": "org1", "script_version": "pilot-v1"}')
    with pytest.raises(ValueError, match="session_id"):
        build_session_context(ctx)


def test_build_session_context_rejects_empty_metadata() -> None:
    with pytest.raises(ValueError):
        build_session_context(_fake_ctx(None))


async def test_entrypoint_connects_and_waits_for_participant() -> None:
    job = MagicMock()
    job.room.name = "interview-sess1"
    job.metadata = (
        '{"session_id": "sess1", "org_id": "org1", '
        '"script_version": "pilot-v1", "candidate_email": "c@example.com"}'
    )
    job.connect = AsyncMock()
    job.wait_for_participant = AsyncMock(return_value=MagicMock())
    ran: dict[str, object] = {}

    async def fake_run(ctx, participant):  # noqa: ANN001
        ran["session_id"] = ctx.session_id
        ran["participant"] = participant

    from agent.worker import entrypoint as ep

    await ep.entrypoint(job, _run_interview=fake_run)
    job.connect.assert_awaited_once()
    job.wait_for_participant.assert_awaited_once()
    assert ran["session_id"] == "sess1"


async def test_default_run_interview_posts_finalization_after_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agent.worker import entrypoint as ep

    class FakeEvent:
        def model_dump(self, mode: str) -> dict[str, object]:
            assert mode == "json"
            return {
                "session_id": "sess-finalize",
                "utterance": "Hello",
                "reason_code": "INTRO",
                "question_id": None,
                "category": None,
                "missing_element": None,
            }

    class FakeEventLog:
        def __init__(self, session_id, path):  # noqa: ANN001
            self.session_id = session_id
            self.path = path
            self._events = [FakeEvent()]

        def events(self) -> list[FakeEvent]:
            return list(self._events)

    class FakeRunner:
        def __init__(self, **kwargs):  # noqa: ANN003
            self.event_log = kwargs["event_log"]

        async def run(self, session_id: str) -> Assessment:
            assert session_id == "sess-finalize"
            return Assessment(
                session_id=session_id,
                script_version="pilot-v1",
                category_scores=[
                    CategoryScore(
                        category="communication",
                        score=3,
                        confidence=0.9,
                        evidence_quotes=["clear answer"],
                        rationale="Strong signal.",
                        low_confidence=False,
                    )
                ],
                meets_bare_minimum=True,
                integrity_flags=["reading_off_screen"],
            )

        def transcript_turns(self) -> list[TranscriptTurn]:
            return [
                TranscriptTurn(
                    turn_index=0,
                    speaker="agent",
                    question_id=None,
                    text="Hello",
                ),
                TranscriptTurn(
                    turn_index=1,
                    speaker="candidate",
                    question_id="q1",
                    text="A full answer.",
                ),
            ]

    posted = AsyncMock()
    monkeypatch.setitem(
        sys.modules,
        "anthropic",
        SimpleNamespace(Anthropic=lambda: object()),
    )
    monkeypatch.setattr("agent.controller.event_log.EventLog", FakeEventLog)
    monkeypatch.setattr("agent.controller.interview.InterviewRunner", FakeRunner)
    monkeypatch.setattr("agent.rubric_loader.load_rubric", lambda path: object())
    monkeypatch.setattr("agent.scoring.probe.ProbeGenerator", lambda **kwargs: object())
    monkeypatch.setattr("agent.scoring.scorer.Scorer", lambda **kwargs: object())
    monkeypatch.setattr(
        "agent.worker.backend_status.post_interview_finalization",
        posted,
        raising=False,
    )
    ctx = InterviewJobContext(
        session_id="sess-finalize",
        org_id="org1",
        script_version="pilot-v1",
        candidate_email="c@example.com",
        room_name="interview-sess-finalize",
    )

    await ep._default_run_interview(ctx, MagicMock())

    posted.assert_awaited_once()
    assert posted.await_args.args[0] == "sess-finalize"
    payload = posted.await_args.args[1]
    assert payload == {
        "sessionId": "sess-finalize",
        "orgId": "org1",
        "scriptVersion": "pilot-v1",
        "transcriptTurns": [
            {
                "turnIndex": 0,
                "speaker": "agent",
                "questionId": None,
                "text": "Hello",
            },
            {
                "turnIndex": 1,
                "speaker": "candidate",
                "questionId": "q1",
                "text": "A full answer.",
            },
        ],
        "assessment": {
            "categoryScores": [
                {
                    "category": "communication",
                    "score": 3,
                    "confidence": 0.9,
                    "evidenceQuotes": ["clear answer"],
                    "rationale": "Strong signal.",
                    "lowConfidence": False,
                }
            ],
            "meetsBareMinimum": True,
            "integrityFlags": ["reading_off_screen"],
        },
        "agentEvents": [
            {
                "session_id": "sess-finalize",
                "utterance": "Hello",
                "reason_code": "INTRO",
                "question_id": None,
                "category": None,
                "missing_element": None,
            }
        ],
    }


async def test_default_run_interview_skips_finalization_when_participant_disconnects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from agent.voice.livekit_session import ParticipantDisconnectedError
    from agent.worker import entrypoint as ep

    class FakeEventLog:
        def __init__(self, session_id, path):  # noqa: ANN001
            self.session_id = session_id
            self.path = path

        def events(self) -> list[object]:
            return []

    class FakeRunner:
        def __init__(self, **kwargs):  # noqa: ANN003
            pass

        async def run(self, session_id: str) -> Assessment:
            raise ParticipantDisconnectedError

    posted = AsyncMock()
    monkeypatch.setitem(
        sys.modules,
        "anthropic",
        SimpleNamespace(Anthropic=lambda: object()),
    )
    monkeypatch.setattr("agent.controller.event_log.EventLog", FakeEventLog)
    monkeypatch.setattr("agent.controller.interview.InterviewRunner", FakeRunner)
    monkeypatch.setattr("agent.rubric_loader.load_rubric", lambda path: object())
    monkeypatch.setattr("agent.scoring.probe.ProbeGenerator", lambda **kwargs: object())
    monkeypatch.setattr("agent.scoring.scorer.Scorer", lambda **kwargs: object())
    monkeypatch.setattr(
        "agent.worker.backend_status.post_interview_finalization",
        posted,
        raising=False,
    )
    ctx = InterviewJobContext(
        session_id="sess-disconnect",
        org_id="org1",
        script_version="pilot-v1",
        candidate_email="c@example.com",
        room_name="interview-sess-disconnect",
    )

    await ep._default_run_interview(ctx, MagicMock())

    posted.assert_not_awaited()
