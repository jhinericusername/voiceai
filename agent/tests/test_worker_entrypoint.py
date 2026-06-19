from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

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


async def test_entrypoint_connects_waits_and_closes_injected_participant() -> None:
    job = MagicMock()
    job.room.name = "interview-sess1"
    job.metadata = (
        '{"session_id": "sess1", "org_id": "org1", '
        '"script_version": "pilot-v1", "candidate_email": "c@example.com"}'
    )
    job.connect = AsyncMock()
    participant = SimpleNamespace(aclose=AsyncMock())
    job.wait_for_participant = AsyncMock(return_value=participant)
    ran: dict[str, object] = {}

    async def fake_run(ctx, participant):  # noqa: ANN001
        ran["session_id"] = ctx.session_id
        ran["participant"] = participant

    from agent.worker import entrypoint as ep

    await ep.entrypoint(job, _run_interview=fake_run)
    job.connect.assert_awaited_once()
    job.wait_for_participant.assert_awaited_once()
    assert ran["session_id"] == "sess1"
    assert ran["participant"] is participant
    participant.aclose.assert_awaited_once()


async def test_entrypoint_closes_injected_participant_after_runner_failure() -> None:
    job = MagicMock()
    job.room.name = "interview-sess1"
    job.metadata = (
        '{"session_id": "sess1", "org_id": "org1", '
        '"script_version": "pilot-v1", "candidate_email": "c@example.com"}'
    )
    job.connect = AsyncMock()
    participant = SimpleNamespace(aclose=AsyncMock())
    job.wait_for_participant = AsyncMock(return_value=participant)
    failure = RuntimeError("runner failed")

    async def fake_run(_ctx, _participant):  # noqa: ANN001
        raise failure

    from agent.worker import entrypoint as ep

    with pytest.raises(RuntimeError) as exc_info:
        await ep.entrypoint(job, _run_interview=fake_run)

    assert exc_info.value is failure
    job.connect.assert_awaited_once()
    job.wait_for_participant.assert_awaited_once()
    participant.aclose.assert_awaited_once()


async def test_default_run_interview_posts_completed_finalization(monkeypatch) -> None:
    from agent.worker import entrypoint as ep

    calls: list[str] = []
    clients: list[object] = []
    runner_init: dict[str, object] = {}

    class FakeBackendClient:
        def __init__(self, session_id: str) -> None:
            self.session_id = session_id
            self.finalization_payloads: list[dict[str, object]] = []
            clients.append(self)

        async def post_transcript_turn(self, payload: dict[str, object]) -> None:
            calls.append("transcript")
            assert payload["turnIndex"] == 0

        async def post_agent_event(self, payload: dict[str, object]) -> None:
            calls.append("agent_event")
            assert payload["sequence"] == 0

        async def post_score_checkpoint(self, payload: dict[str, object]) -> None:
            calls.append("score")
            assert payload["sequence"] == 0

        async def post_finalization(self, payload: dict[str, object]) -> None:
            calls.append(f"finalize:{payload['completionReason']}")
            self.finalization_payloads.append(payload)

        async def flush(self, timeout_seconds: float | None = None) -> None:
            calls.append(f"flush:{timeout_seconds}")

    class FakeEventLog:
        def events(self) -> list[object]:
            return [object(), object()]

    class FakeRunner:
        def __init__(self, **kwargs: object) -> None:
            runner_init.update(kwargs)
            self.transcript = ["agent turn", "candidate turn", "closing turn"]
            self.event_log = FakeEventLog()
            self._score_checkpoint_sequence = 2

        async def run(self, session_id: str) -> object:
            assert session_id == "sess-completed"
            await runner_init["emit_transcript_turn"]({"turnIndex": 0})
            return SimpleNamespace(
                script_version="pilot-v1",
                integrity_flags=["reading_off_screen"],
            )

    monkeypatch.setattr(ep, "BackendClient", FakeBackendClient)
    monkeypatch.setattr(ep, "InterviewRunner", FakeRunner)
    monkeypatch.setattr(ep, "load_rubric", lambda _path: SimpleNamespace(script_version="pilot-v1"))
    monkeypatch.setattr(ep, "Scorer", lambda **_kwargs: object())
    monkeypatch.setattr(ep, "ProbeGenerator", lambda **_kwargs: object())
    monkeypatch.setattr(ep, "EventLog", lambda **_kwargs: FakeEventLog())
    monkeypatch.setattr(ep.anthropic, "Anthropic", lambda: object())

    ctx = InterviewJobContext(
        session_id="sess-completed",
        org_id="org1",
        script_version="pilot-v1",
        candidate_email="c@example.com",
        room_name="interview-sess-completed",
    )

    await ep._default_run_interview(ctx, voice=object())

    backend = clients[0]
    assert backend.session_id == "sess-completed"
    assert runner_init["emit_transcript_turn"] == backend.post_transcript_turn
    assert runner_init["emit_agent_event"] == backend.post_agent_event
    assert runner_init["emit_score_checkpoint"] == backend.post_score_checkpoint
    assert runner_init["candidate_transcript_source"] == "deepgram:nova-3"
    assert calls == [
        "transcript",
        f"flush:{ep._BACKEND_FLUSH_TIMEOUT_SECONDS}",
        "finalize:completed",
        f"flush:{ep._BACKEND_FLUSH_TIMEOUT_SECONDS}",
    ]
    assert backend.finalization_payloads == [
        {
            "completionReason": "completed",
            "scriptVersion": "pilot-v1",
            "finalTurnCount": 3,
            "integrityFlags": ["reading_off_screen"],
            "agentEventCount": 2,
            "scoreCheckpointCount": 2,
        }
    ]


async def test_default_run_interview_posts_disconnected_finalization(monkeypatch) -> None:
    from agent.worker import entrypoint as ep

    calls: list[str] = []
    clients: list[object] = []

    class FakeBackendClient:
        def __init__(self, session_id: str) -> None:
            self.session_id = session_id
            self.finalization_payloads: list[dict[str, object]] = []
            clients.append(self)

        async def post_transcript_turn(self, payload: dict[str, object]) -> None:
            calls.append("transcript")
            assert payload["turnIndex"] == 0

        async def post_agent_event(self, _payload: dict[str, object]) -> None:
            calls.append("agent_event")

        async def post_score_checkpoint(self, _payload: dict[str, object]) -> None:
            calls.append("score")

        async def post_finalization(self, payload: dict[str, object]) -> None:
            calls.append(f"finalize:{payload['completionReason']}")
            self.finalization_payloads.append(payload)

        async def flush(self, timeout_seconds: float | None = None) -> None:
            calls.append(f"flush:{timeout_seconds}")

    class FakeEventLog:
        def events(self) -> list[object]:
            return [object()]

    class FakeRunner:
        def __init__(self, **kwargs: object) -> None:
            self._emit_transcript_turn = kwargs["emit_transcript_turn"]
            self.transcript = ["agent turn"]
            self.event_log = FakeEventLog()

        async def run(self, session_id: str) -> object:
            assert session_id == "sess-disconnected"
            await self._emit_transcript_turn({"turnIndex": 0})
            raise ep.ParticipantDisconnectedError("candidate left")

    monkeypatch.setattr(ep, "BackendClient", FakeBackendClient)
    monkeypatch.setattr(ep, "InterviewRunner", FakeRunner)
    monkeypatch.setattr(ep, "load_rubric", lambda _path: SimpleNamespace(script_version="pilot-v1"))
    monkeypatch.setattr(ep, "Scorer", lambda **_kwargs: object())
    monkeypatch.setattr(ep, "ProbeGenerator", lambda **_kwargs: object())
    monkeypatch.setattr(ep, "EventLog", lambda **_kwargs: FakeEventLog())
    monkeypatch.setattr(ep.anthropic, "Anthropic", lambda: object())

    ctx = InterviewJobContext(
        session_id="sess-disconnected",
        org_id="org1",
        script_version="pilot-v1",
        candidate_email="c@example.com",
        room_name="interview-sess-disconnected",
    )

    await ep._default_run_interview(ctx, voice=object())

    backend = clients[0]
    assert calls == [
        "transcript",
        f"flush:{ep._BACKEND_FLUSH_TIMEOUT_SECONDS}",
        "finalize:candidate_disconnected",
        f"flush:{ep._BACKEND_FLUSH_TIMEOUT_SECONDS}",
    ]
    assert backend.finalization_payloads == [
        {
            "completionReason": "candidate_disconnected",
            "scriptVersion": "pilot-v1",
            "finalTurnCount": 1,
            "integrityFlags": [],
            "agentEventCount": 1,
        }
    ]


async def test_default_run_interview_posts_agent_error_finalization_and_reraises(
    monkeypatch,
) -> None:  # noqa: ANN001
    from agent.worker import entrypoint as ep

    calls: list[str] = []
    clients: list[object] = []
    failure = RuntimeError("runner exploded")

    class FakeBackendClient:
        def __init__(self, session_id: str) -> None:
            self.session_id = session_id
            self.finalization_payloads: list[dict[str, object]] = []
            clients.append(self)

        async def post_transcript_turn(self, payload: dict[str, object]) -> None:
            calls.append("transcript")
            assert payload["turnIndex"] == 0

        async def post_agent_event(self, _payload: dict[str, object]) -> None:
            calls.append("agent_event")

        async def post_score_checkpoint(self, _payload: dict[str, object]) -> None:
            calls.append("score")

        async def post_finalization(self, payload: dict[str, object]) -> None:
            calls.append(f"finalize:{payload['completionReason']}")
            self.finalization_payloads.append(payload)

        async def flush(self, timeout_seconds: float | None = None) -> None:
            calls.append(f"flush:{timeout_seconds}")

    class FakeEventLog:
        def events(self) -> list[object]:
            return [object(), object()]

    class FakeRunner:
        def __init__(self, **kwargs: object) -> None:
            self._emit_transcript_turn = kwargs["emit_transcript_turn"]
            self.transcript = ["agent turn", "candidate turn"]
            self.event_log = FakeEventLog()

        async def run(self, session_id: str) -> object:
            assert session_id == "sess-agent-error"
            await self._emit_transcript_turn({"turnIndex": 0})
            raise failure

    monkeypatch.setattr(ep, "BackendClient", FakeBackendClient)
    monkeypatch.setattr(ep, "InterviewRunner", FakeRunner)
    monkeypatch.setattr(ep, "load_rubric", lambda _path: SimpleNamespace(script_version="pilot-v1"))
    monkeypatch.setattr(ep, "Scorer", lambda **_kwargs: object())
    monkeypatch.setattr(ep, "ProbeGenerator", lambda **_kwargs: object())
    monkeypatch.setattr(ep, "EventLog", lambda **_kwargs: FakeEventLog())
    monkeypatch.setattr(ep.anthropic, "Anthropic", lambda: object())

    ctx = InterviewJobContext(
        session_id="sess-agent-error",
        org_id="org1",
        script_version="pilot-v1",
        candidate_email="c@example.com",
        room_name="interview-sess-agent-error",
    )

    with pytest.raises(RuntimeError) as exc_info:
        await ep._default_run_interview(ctx, voice=object())

    assert exc_info.value is failure
    backend = clients[0]
    assert calls == [
        "transcript",
        f"flush:{ep._BACKEND_FLUSH_TIMEOUT_SECONDS}",
        "finalize:agent_error",
        f"flush:{ep._BACKEND_FLUSH_TIMEOUT_SECONDS}",
    ]
    assert backend.finalization_payloads == [
        {
            "completionReason": "agent_error",
            "scriptVersion": "pilot-v1",
            "finalTurnCount": 2,
            "integrityFlags": ["agent_error"],
            "agentEventCount": 2,
        }
    ]


async def test_default_run_interview_posts_timeout_finalization_and_returns(
    monkeypatch,
) -> None:  # noqa: ANN001
    from agent.worker import entrypoint as ep

    calls: list[str] = []
    clients: list[object] = []

    class FakeBackendClient:
        def __init__(self, session_id: str) -> None:
            self.session_id = session_id
            self.finalization_payloads: list[dict[str, object]] = []
            clients.append(self)

        async def post_transcript_turn(self, payload: dict[str, object]) -> None:
            calls.append("transcript")
            assert payload["turnIndex"] == 0

        async def post_agent_event(self, _payload: dict[str, object]) -> None:
            calls.append("agent_event")

        async def post_score_checkpoint(self, _payload: dict[str, object]) -> None:
            calls.append("score")

        async def post_finalization(self, payload: dict[str, object]) -> None:
            calls.append(f"finalize:{payload['completionReason']}")
            self.finalization_payloads.append(payload)

        async def flush(self, timeout_seconds: float | None = None) -> None:
            calls.append(f"flush:{timeout_seconds}")

    class FakeEventLog:
        def events(self) -> list[object]:
            return [object()]

    class FakeRunner:
        def __init__(self, **kwargs: object) -> None:
            self._emit_transcript_turn = kwargs["emit_transcript_turn"]
            self.transcript = ["agent turn"]
            self.event_log = FakeEventLog()

        async def run(self, session_id: str) -> object:
            assert session_id == "sess-timeout"
            await self._emit_transcript_turn({"turnIndex": 0})
            raise ep.CandidateSilenceTimeoutError("candidate remained silent")

    monkeypatch.setattr(ep, "BackendClient", FakeBackendClient)
    monkeypatch.setattr(ep, "InterviewRunner", FakeRunner)
    monkeypatch.setattr(ep, "load_rubric", lambda _path: SimpleNamespace(script_version="pilot-v1"))
    monkeypatch.setattr(ep, "Scorer", lambda **_kwargs: object())
    monkeypatch.setattr(ep, "ProbeGenerator", lambda **_kwargs: object())
    monkeypatch.setattr(ep, "EventLog", lambda **_kwargs: FakeEventLog())
    monkeypatch.setattr(ep.anthropic, "Anthropic", lambda: object())

    ctx = InterviewJobContext(
        session_id="sess-timeout",
        org_id="org1",
        script_version="pilot-v1",
        candidate_email="c@example.com",
        room_name="interview-sess-timeout",
    )

    await ep._default_run_interview(ctx, voice=object())

    backend = clients[0]
    assert calls == [
        "transcript",
        f"flush:{ep._BACKEND_FLUSH_TIMEOUT_SECONDS}",
        "finalize:timeout",
        f"flush:{ep._BACKEND_FLUSH_TIMEOUT_SECONDS}",
    ]
    assert backend.finalization_payloads == [
        {
            "completionReason": "timeout",
            "scriptVersion": "pilot-v1",
            "finalTurnCount": 1,
            "integrityFlags": ["timeout"],
            "agentEventCount": 1,
        }
    ]


async def test_entrypoint_closes_voice_after_realtime_run(monkeypatch) -> None:
    from agent.worker import entrypoint as ep

    job = MagicMock()
    job.room.name = "interview-sess1"
    job.metadata = (
        '{"session_id": "sess1", "org_id": "org1", '
        '"script_version": "pilot-v1", "candidate_email": "c@example.com"}'
    )
    voice = SimpleNamespace(aclose=AsyncMock())
    ran: dict[str, object] = {}

    async def fake_build_realtime(_job):  # noqa: ANN001
        return voice

    async def fake_run(ctx, run_voice):  # noqa: ANN001
        ran["session_id"] = ctx.session_id
        ran["voice"] = run_voice

    monkeypatch.setattr(ep, "_build_realtime_session", fake_build_realtime)
    monkeypatch.setattr(ep, "_realtime_run_interview", fake_run)

    await ep.entrypoint(job)

    assert ran == {"session_id": "sess1", "voice": voice}
    voice.aclose.assert_awaited_once()


async def test_entrypoint_closes_realtime_voice_after_runner_failure(monkeypatch) -> None:
    from agent.worker import entrypoint as ep

    job = MagicMock()
    job.room.name = "interview-sess1"
    job.metadata = (
        '{"session_id": "sess1", "org_id": "org1", '
        '"script_version": "pilot-v1", "candidate_email": "c@example.com"}'
    )
    voice = SimpleNamespace(aclose=AsyncMock())
    failure = RuntimeError("realtime runner failed")

    async def fake_build_realtime(_job):  # noqa: ANN001
        return voice

    async def fake_run(_ctx, _run_voice):  # noqa: ANN001
        raise failure

    monkeypatch.setattr(ep, "_build_realtime_session", fake_build_realtime)
    monkeypatch.setattr(ep, "_realtime_run_interview", fake_run)

    with pytest.raises(RuntimeError) as exc_info:
        await ep.entrypoint(job)

    assert exc_info.value is failure
    voice.aclose.assert_awaited_once()


# ---------------------------------------------------------------------------
# Task 12: REALTIME flag-select tests
# ---------------------------------------------------------------------------


def _make_job(session_id: str = "sess1") -> MagicMock:
    job = MagicMock()
    job.room.name = f"interview-{session_id}"
    job.metadata = (
        f'{{"session_id": "{session_id}", "org_id": "org1", '
        f'"script_version": "pilot-v1", "candidate_email": "c@example.com"}}'
    )
    return job


async def test_entrypoint_always_selects_realtime_path(monkeypatch) -> None:
    """Entrypoint always selects _build_realtime_session + _realtime_run_interview."""
    from agent.worker import entrypoint as ep

    fake_voice = SimpleNamespace(aclose=AsyncMock())
    realtime_ran: list[tuple[object, object]] = []
    default_ran: list[object] = []

    async def fake_build_realtime(_job):  # noqa: ANN001
        return fake_voice

    async def fake_realtime_run(ctx, voice):  # noqa: ANN001
        realtime_ran.append((ctx, voice))

    async def fake_default_run(ctx, voice):  # noqa: ANN001
        default_ran.append((ctx, voice))

    monkeypatch.setattr(ep, "_build_realtime_session", fake_build_realtime)
    monkeypatch.setattr(ep, "_realtime_run_interview", fake_realtime_run)
    monkeypatch.setattr(ep, "_default_run_interview", fake_default_run)

    await ep.entrypoint(_make_job())

    assert len(realtime_ran) == 1
    assert realtime_ran[0][0].session_id == "sess1"
    assert realtime_ran[0][1] is fake_voice
    assert len(default_ran) == 0
    fake_voice.aclose.assert_awaited_once()


async def test_realtime_run_interview_builds_runner_and_finalizes(monkeypatch) -> None:
    """_realtime_run_interview builds RealtimeInterviewRunner and posts finalization."""
    from types import SimpleNamespace

    from agent.worker import entrypoint as ep

    calls: list[str] = []
    clients: list[object] = []
    runner_init: dict[str, object] = {}

    class FakeBackendClient:
        def __init__(self, session_id: str) -> None:
            self.session_id = session_id
            self.finalization_payloads: list[dict[str, object]] = []
            clients.append(self)

        async def post_transcript_turn(self, payload: dict[str, object]) -> None:
            calls.append("transcript")

        async def post_agent_event(self, _payload: dict[str, object]) -> None:
            calls.append("agent_event")

        async def post_score_checkpoint(self, _payload: dict[str, object]) -> None:
            calls.append("score")

        async def post_finalization(self, payload: dict[str, object]) -> None:
            calls.append(f"finalize:{payload['completionReason']}")
            self.finalization_payloads.append(payload)

        async def flush(self, timeout_seconds: float | None = None) -> None:
            calls.append(f"flush:{timeout_seconds}")

    class FakeEventLog:
        def events(self) -> list[object]:
            return [object()]

    class FakeRunner:
        def __init__(self, **kwargs: object) -> None:
            runner_init.update(kwargs)
            self.transcript: list[str] = []
            self.event_log = FakeEventLog()

        async def run(self, session_id: str) -> object:
            assert session_id == "sess-rt"
            return SimpleNamespace(
                script_version="pilot-v1",
                integrity_flags=[],
            )

    fake_voice = object()
    fake_anthropic_client = object()
    fake_guardrail = object()

    monkeypatch.setattr(ep, "BackendClient", FakeBackendClient)
    monkeypatch.setattr(ep, "RealtimeInterviewRunner", FakeRunner)
    monkeypatch.setattr(ep, "GuardrailMonitor", lambda **kw: fake_guardrail)
    monkeypatch.setattr(ep, "Scorer", lambda **_kwargs: object())
    monkeypatch.setattr(ep, "ProbeGenerator", lambda **_kwargs: object())
    monkeypatch.setattr(ep, "EventLog", lambda **_kwargs: FakeEventLog())
    monkeypatch.setattr(ep, "load_rubric", lambda _path: SimpleNamespace(script_version="pilot-v1"))
    monkeypatch.setattr(ep.anthropic, "Anthropic", lambda: fake_anthropic_client)
    monkeypatch.setattr(
        ep,
        "REALTIME",
        SimpleNamespace(model="gpt-realtime", guardrail_model="claude-haiku-4-5"),
    )

    ctx = InterviewJobContext(
        session_id="sess-rt",
        org_id="org1",
        script_version="pilot-v1",
        candidate_email="c@example.com",
        room_name="interview-sess-rt",
    )

    await ep._realtime_run_interview(ctx, voice=fake_voice)

    # Runner was constructed with session=fake_voice
    assert runner_init["session"] is fake_voice
    assert runner_init["guardrail_monitor"] is fake_guardrail
    assert runner_init["candidate_transcript_source"] == "realtime"
    assert runner_init["emit_transcript_turn"] == clients[0].post_transcript_turn
    assert runner_init["emit_agent_event"] == clients[0].post_agent_event

    # Finalization was posted
    assert any(c.startswith("finalize:") for c in calls)
    assert clients[0].finalization_payloads[0]["completionReason"] == "completed"


async def test_realtime_run_interview_posts_disconnected_finalization(monkeypatch) -> None:
    """_realtime_run_interview maps ParticipantDisconnectedError → candidate_disconnected."""
    from types import SimpleNamespace

    from agent.worker import entrypoint as ep

    clients: list[object] = []

    class FakeBackendClient:
        def __init__(self, session_id: str) -> None:
            self.session_id = session_id
            self.finalization_payloads: list[dict[str, object]] = []
            clients.append(self)

        async def post_transcript_turn(self, _p: dict[str, object]) -> None:
            pass

        async def post_agent_event(self, _p: dict[str, object]) -> None:
            pass

        async def post_score_checkpoint(self, _p: dict[str, object]) -> None:
            pass

        async def post_finalization(self, payload: dict[str, object]) -> None:
            self.finalization_payloads.append(payload)

        async def flush(self, timeout_seconds: float | None = None) -> None:
            pass

    class FakeEventLog:
        def events(self) -> list[object]:
            return []

    class FakeRunner:
        def __init__(self, **_kwargs: object) -> None:
            self.transcript: list[str] = []
            self.event_log = FakeEventLog()

        async def run(self, session_id: str) -> object:
            raise ep.ParticipantDisconnectedError("dropped")

    monkeypatch.setattr(ep, "BackendClient", FakeBackendClient)
    monkeypatch.setattr(ep, "RealtimeInterviewRunner", FakeRunner)
    monkeypatch.setattr(ep, "GuardrailMonitor", lambda **kw: object())
    monkeypatch.setattr(ep, "Scorer", lambda **_kwargs: object())
    monkeypatch.setattr(ep, "ProbeGenerator", lambda **_kwargs: object())
    monkeypatch.setattr(ep, "EventLog", lambda **_kwargs: FakeEventLog())
    monkeypatch.setattr(ep, "load_rubric", lambda _path: SimpleNamespace(script_version="pilot-v1"))
    monkeypatch.setattr(ep.anthropic, "Anthropic", lambda: object())
    monkeypatch.setattr(
        ep,
        "REALTIME",
        SimpleNamespace(model="gpt-realtime", guardrail_model="claude-haiku-4-5"),
    )

    ctx = InterviewJobContext(
        session_id="sess-rt-disc",
        org_id="org1",
        script_version="pilot-v1",
        candidate_email="c@example.com",
        room_name="interview-sess-rt-disc",
    )

    await ep._realtime_run_interview(ctx, voice=object())

    assert clients[0].finalization_payloads[0]["completionReason"] == "candidate_disconnected"  # type: ignore[index]


def test_entrypoint_always_runs_realtime(monkeypatch) -> None:
    """After flag removal, RealtimeConfig has no `enabled` attr."""
    monkeypatch.delenv("PUDDLE_USE_REALTIME", raising=False)
    # Importing config must not expose an `enabled` flag anymore.
    from agent.config import RealtimeConfig
    assert not hasattr(RealtimeConfig(), "enabled")
