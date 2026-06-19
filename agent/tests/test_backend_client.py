import asyncio
import json
import urllib.error
import urllib.request
from typing import Any

import pytest

from agent.worker.backend_client import (
    BackendClient,
    PendingPost,
    UrlLibBackendTransport,
    backend_base_url,
    backend_headers,
)


class FakeTransport:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.failures = 0

    async def post(self, path: str, payload: dict[str, Any]) -> None:
        self.calls.append((path, payload))
        if self.failures > 0:
            self.failures -= 1
            raise OSError("temporary backend failure")


class PlannedTransport:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.fail_all = False
        self.path_failures: dict[str, int] = {}

    async def post(self, path: str, payload: dict[str, Any]) -> None:
        self.calls.append((path, payload))
        if self.fail_all:
            raise OSError("temporary backend failure")
        if self.path_failures.get(path, 0) > 0:
            self.path_failures[path] -= 1
            raise OSError("temporary backend failure")


class FakeResponse:
    def __init__(self, status: int = 200) -> None:
        self.status = status

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None


async def test_post_transcript_turn_posts_original_payload() -> None:
    transport = FakeTransport()
    client = BackendClient(session_id="sess_123", transport=transport)
    payload = {"role": "candidate", "text": "I would shard by tenant."}

    await client.post_transcript_turn(payload)

    assert transport.calls == [
        ("/internal/sessions/sess_123/transcript-turns", payload),
    ]


async def test_failed_post_agent_event_buffers_pending_post_and_flush_clears_it() -> None:
    transport = FakeTransport()
    transport.failures = 1
    client = BackendClient(session_id="sess_123", transport=transport)
    payload = {"type": "checkpoint", "message": "candidate asked for clarification"}

    await client.post_agent_event(payload)

    assert client.pending == [
        PendingPost("/internal/sessions/sess_123/agent-events", payload),
    ]

    await client.flush()

    assert transport.calls == [
        ("/internal/sessions/sess_123/agent-events", payload),
        ("/internal/sessions/sess_123/agent-events", payload),
    ]
    assert client.pending == []


async def test_pending_returns_payload_snapshots_not_mutable_internal_payloads() -> None:
    transport = FakeTransport()
    transport.failures = 1
    client = BackendClient(session_id="sess_123", transport=transport)

    await client.post_agent_event({"sequence": 1})

    pending = client.pending
    pending[0].payload["sequence"] = 99

    assert client.pending == [
        PendingPost("/internal/sessions/sess_123/agent-events", {"sequence": 1}),
    ]


async def test_flush_retains_all_pending_posts_when_retries_fail() -> None:
    transport = PlannedTransport()
    transport.fail_all = True
    client = BackendClient(session_id="sess_123", transport=transport)

    await client.post_agent_event({"sequence": 1})
    await client.post_score_checkpoint({"sequence": 2})

    await asyncio.wait_for(client.flush(), timeout=0.5)

    assert transport.calls == [
        ("/internal/sessions/sess_123/agent-events", {"sequence": 1}),
        ("/internal/sessions/sess_123/score-checkpoints", {"sequence": 2}),
        ("/internal/sessions/sess_123/agent-events", {"sequence": 1}),
        ("/internal/sessions/sess_123/score-checkpoints", {"sequence": 2}),
    ]
    assert client.pending == [
        PendingPost("/internal/sessions/sess_123/agent-events", {"sequence": 1}),
        PendingPost("/internal/sessions/sess_123/score-checkpoints", {"sequence": 2}),
    ]


async def test_flush_removes_successes_and_keeps_failed_posts_ordered() -> None:
    transport = PlannedTransport()
    transport.fail_all = True
    client = BackendClient(session_id="sess_123", transport=transport)

    await client.post_agent_event({"sequence": 1})
    await client.post_score_checkpoint({"sequence": 2})
    await client.post_finalization({"sequence": 3})

    transport.fail_all = False
    transport.path_failures = {
        "/internal/sessions/sess_123/score-checkpoints": 1,
        "/internal/sessions/sess_123/finalize": 1,
    }

    await asyncio.wait_for(client.flush(), timeout=0.5)

    assert transport.calls == [
        ("/internal/sessions/sess_123/agent-events", {"sequence": 1}),
        ("/internal/sessions/sess_123/score-checkpoints", {"sequence": 2}),
        ("/internal/sessions/sess_123/finalize", {"sequence": 3}),
        ("/internal/sessions/sess_123/agent-events", {"sequence": 1}),
        ("/internal/sessions/sess_123/score-checkpoints", {"sequence": 2}),
        ("/internal/sessions/sess_123/finalize", {"sequence": 3}),
    ]
    assert client.pending == [
        PendingPost("/internal/sessions/sess_123/score-checkpoints", {"sequence": 2}),
        PendingPost("/internal/sessions/sess_123/finalize", {"sequence": 3}),
    ]


async def test_bounded_flush_returns_promptly_and_keeps_unflushed_posts_pending() -> None:
    class SlowRetryTransport:
        def __init__(self) -> None:
            self.calls: list[tuple[str, dict[str, Any]]] = []
            self.retry_slowly = False
            self.cancelled = False

        async def post(self, path: str, payload: dict[str, Any]) -> None:
            self.calls.append((path, payload))
            if not self.retry_slowly:
                raise OSError("temporary backend failure")
            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                self.cancelled = True
                raise

    transport = SlowRetryTransport()
    client = BackendClient(session_id="sess_123", transport=transport)

    await client.post_agent_event({"sequence": 1})
    await client.post_score_checkpoint({"sequence": 2})
    transport.retry_slowly = True

    started_at = asyncio.get_running_loop().time()
    await client.flush(timeout_seconds=0.01)
    elapsed = asyncio.get_running_loop().time() - started_at

    assert elapsed < 0.2
    assert transport.cancelled is True
    assert client.pending == [
        PendingPost("/internal/sessions/sess_123/agent-events", {"sequence": 1}),
        PendingPost("/internal/sessions/sess_123/score-checkpoints", {"sequence": 2}),
    ]


async def test_flush_waits_for_in_flight_posts_before_returning() -> None:
    class SlowTransport:
        def __init__(self) -> None:
            self.started = asyncio.Event()
            self.allow_finish = asyncio.Event()
            self.calls: list[tuple[str, dict[str, Any]]] = []

        async def post(self, path: str, payload: dict[str, Any]) -> None:
            self.calls.append((path, payload))
            self.started.set()
            await self.allow_finish.wait()

    transport = SlowTransport()
    client = BackendClient(session_id="sess_123", transport=transport)
    post_task = asyncio.create_task(client.post_transcript_turn({"turnIndex": 1}))
    await transport.started.wait()

    async def unblock_post() -> None:
        await asyncio.sleep(0.01)
        transport.allow_finish.set()

    flush_task = asyncio.create_task(client.flush(timeout_seconds=0.2))
    await asyncio.sleep(0)

    assert not flush_task.done()

    unblock_task = asyncio.create_task(unblock_post())
    await flush_task
    await unblock_task

    assert post_task.done()
    assert client.pending == []
    assert transport.calls == [
        ("/internal/sessions/sess_123/transcript-turns", {"turnIndex": 1}),
    ]


async def test_pending_queue_drops_oldest_item_when_full() -> None:
    transport = FakeTransport()
    transport.failures = 3
    client = BackendClient(session_id="sess_123", transport=transport, max_pending=2)

    await client.post_agent_event({"sequence": 1})
    await client.post_score_checkpoint({"sequence": 2})
    await client.post_finalization({"sequence": 3})

    assert client.pending == [
        PendingPost("/internal/sessions/sess_123/score-checkpoints", {"sequence": 2}),
        PendingPost("/internal/sessions/sess_123/finalize", {"sequence": 3}),
    ]


async def test_zero_max_pending_drops_failed_posts_immediately() -> None:
    transport = FakeTransport()
    transport.failures = 1
    client = BackendClient(session_id="sess_123", transport=transport, max_pending=0)

    await client.post_agent_event({"sequence": 1})

    assert client.pending == []


async def test_negative_max_pending_is_clamped_to_zero() -> None:
    transport = FakeTransport()
    transport.failures = 1
    client = BackendClient(session_id="sess_123", transport=transport, max_pending=-1)

    await client.post_agent_event({"sequence": 1})

    assert client.pending == []


def test_backend_base_url_defaults_and_strips_trailing_slash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("PUDDLE_BACKEND_BASE_URL", raising=False)
    assert backend_base_url() == "http://localhost:8080"

    monkeypatch.setenv("PUDDLE_BACKEND_BASE_URL", "https://backend.test///")
    assert backend_base_url() == "https://backend.test"


def test_backend_headers_include_content_type_and_optional_auth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("PUDDLE_BACKEND_INTERNAL_TOKEN", raising=False)
    assert backend_headers() == {"content-type": "application/json"}

    monkeypatch.setenv("PUDDLE_BACKEND_INTERNAL_TOKEN", "  internal-token  ")
    assert backend_headers() == {
        "content-type": "application/json",
        "authorization": "Bearer internal-token",
    }


async def test_urllib_transport_builds_backend_request(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}
    payload = {"answer": 42}

    def fake_urlopen(request: urllib.request.Request, timeout: int) -> FakeResponse:
        captured["request"] = request
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setenv("PUDDLE_BACKEND_BASE_URL", "https://backend.test/")
    monkeypatch.setenv("PUDDLE_BACKEND_INTERNAL_TOKEN", "internal-token")
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    await UrlLibBackendTransport().post("/internal/test", payload)

    request = captured["request"]
    headers = {key.lower(): value for key, value in request.header_items()}
    assert request.full_url == "https://backend.test/internal/test"
    assert json.loads(request.data.decode("utf-8")) == payload
    assert headers["content-type"] == "application/json"
    assert headers["authorization"] == "Bearer internal-token"
    assert request.get_method() == "POST"
    assert captured["timeout"] == 5


async def test_urllib_transport_raises_for_response_status_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_urlopen(request: urllib.request.Request, timeout: int) -> FakeResponse:
        return FakeResponse(status=500)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    with pytest.raises(RuntimeError, match="backend returned status 500"):
        await UrlLibBackendTransport().post("/internal/test", {"answer": 42})


async def test_post_transcript_turn_retries_then_logs(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Transient failure on first attempt: retry succeeds on second — exactly 2 calls made."""
    calls: dict[str, int] = {"n": 0}

    async def _flaky(path: str, payload: dict[str, Any]) -> None:
        calls["n"] += 1
        if calls["n"] < 2:
            raise RuntimeError("transient")

    client = BackendClient(session_id="s")
    monkeypatch.setattr(client._transport, "post", _flaky)
    await client.post_transcript_turn({"turnIndex": 0, "speaker": "agent", "text": "hi"})
    assert calls["n"] == 2  # retried once, then succeeded
    assert client.pending == []  # nothing buffered — retry succeeded


async def test_post_transcript_turn_always_fails_logs_and_does_not_raise(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """All retry attempts exhausted: logs a warning, never raises, may buffer."""
    calls: dict[str, int] = {"n": 0}

    async def _always_fail(path: str, payload: dict[str, Any]) -> None:
        calls["n"] += 1
        raise RuntimeError("persistent")

    import logging

    client = BackendClient(session_id="s")
    monkeypatch.setattr(client._transport, "post", _always_fail)
    with caplog.at_level(logging.WARNING, logger="agent.worker.backend_client"):
        # must not raise
        await client.post_transcript_turn({"turnIndex": 0, "speaker": "agent", "text": "hi"})
    assert calls["n"] == 3  # all _TRANSCRIPT_RETRY_ATTEMPTS attempts were made
    assert any("transcript-turn post failed" in r.message for r in caplog.records)


async def test_urllib_transport_propagates_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    http_error = urllib.error.HTTPError(
        url="https://backend.test/internal/test",
        code=503,
        msg="service unavailable",
        hdrs=None,
        fp=None,
    )

    def fake_urlopen(request: urllib.request.Request, timeout: int) -> FakeResponse:
        raise http_error

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    with pytest.raises(urllib.error.HTTPError) as exc_info:
        await UrlLibBackendTransport().post("/internal/test", {"answer": 42})

    assert exc_info.value is http_error
