import pytest

from agent.worker import backend_status


async def test_interview_finalization_retries_transient_backend_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    def fake_post(session_id: str, payload: dict[str, object]) -> None:
        calls.append(session_id)
        if len(calls) == 1:
            raise RuntimeError("backend unavailable")
        assert payload == {"ok": True}

    monkeypatch.setattr(backend_status, "_post_interview_finalization_sync", fake_post)

    await backend_status.post_interview_finalization(
        "sess1",
        {"ok": True},
        attempts=2,
        retry_delays_seconds=(),
    )

    assert calls == ["sess1", "sess1"]


async def test_interview_finalization_raises_after_retry_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    def fake_post(session_id: str, payload: dict[str, object]) -> None:
        calls.append(session_id)
        raise RuntimeError("backend unavailable")

    monkeypatch.setattr(backend_status, "_post_interview_finalization_sync", fake_post)

    with pytest.raises(RuntimeError, match="backend unavailable"):
        await backend_status.post_interview_finalization(
            "sess1",
            {"ok": True},
            attempts=3,
            retry_delays_seconds=(),
        )

    assert calls == ["sess1", "sess1", "sess1"]
