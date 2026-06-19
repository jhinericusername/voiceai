"""Best-effort client for durable interview artifact writes."""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol

logger = logging.getLogger(__name__)

# Transcript turns are the sole interview deliverable — retry before buffering.
_TRANSCRIPT_RETRY_ATTEMPTS: int = 3
_TRANSCRIPT_RETRY_BACKOFF_SECONDS: float = 0.1


def backend_base_url() -> str:
    return os.environ.get("PUDDLE_BACKEND_BASE_URL", "http://localhost:8080").rstrip("/")


def backend_headers() -> dict[str, str]:
    headers = {"content-type": "application/json"}
    token = os.environ.get("PUDDLE_BACKEND_INTERNAL_TOKEN", "").strip()
    if token:
        headers["authorization"] = f"Bearer {token}"
    return headers


class BackendTransport(Protocol):
    async def post(self, path: str, payload: dict[str, Any]) -> None: ...


class UrlLibBackendTransport:
    async def post(self, path: str, payload: dict[str, Any]) -> None:
        await asyncio.to_thread(self._post_sync, path, payload)

    def _post_sync(self, path: str, payload: dict[str, Any]) -> None:
        request = urllib.request.Request(
            f"{backend_base_url()}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers=backend_headers(),
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            if response.status >= 400:
                raise RuntimeError(f"backend returned status {response.status}")


@dataclass(frozen=True)
class PendingPost:
    path: str
    payload: dict[str, Any]


class BackendClient:
    def __init__(
        self,
        session_id: str,
        transport: BackendTransport | None = None,
        max_pending: int = 64,
    ) -> None:
        self._session_id = session_id
        self._transport = transport or UrlLibBackendTransport()
        self._max_pending = max(0, max_pending)
        self._pending: list[PendingPost] = []
        self._in_flight_posts: set[asyncio.Task[Any]] = set()

    @property
    def pending(self) -> list[PendingPost]:
        return [
            PendingPost(pending_post.path, copy.deepcopy(pending_post.payload))
            for pending_post in self._pending
        ]

    async def post_transcript_turn(self, payload: dict[str, Any]) -> None:
        """Post a transcript turn with a bounded retry before falling back to buffering.

        Transcript turns are the sole interview deliverable, so a transient hiccup
        gets up to _TRANSCRIPT_RETRY_ATTEMPTS tries (with short exponential backoff)
        before the normal buffer-on-failure path kicks in. The method never raises.
        """
        path = f"/internal/sessions/{self._session_id}/transcript-turns"
        pending_post = PendingPost(path, payload)
        current_task = asyncio.current_task()
        if current_task is not None:
            self._in_flight_posts.add(current_task)
        try:
            last_exc: BaseException | None = None
            for attempt in range(_TRANSCRIPT_RETRY_ATTEMPTS):
                try:
                    await self._transport.post(path, payload)
                    return  # success — skip buffering entirely
                except Exception as exc:
                    last_exc = exc
                    if attempt < _TRANSCRIPT_RETRY_ATTEMPTS - 1:
                        await asyncio.sleep(_TRANSCRIPT_RETRY_BACKOFF_SECONDS * (2**attempt))
            # All retries exhausted — log and fall through to buffer.
            logger.warning(
                "transcript-turn post failed after %d attempts; buffering",
                _TRANSCRIPT_RETRY_ATTEMPTS,
                extra={
                    "session_id": self._session_id,
                    "path": path,
                    "error": str(last_exc),
                    "error_type": type(last_exc).__name__,
                },
                exc_info=last_exc,
            )
            self._append_pending(pending_post)
        finally:
            if current_task is not None:
                self._in_flight_posts.discard(current_task)

    async def post_agent_event(self, payload: dict[str, Any]) -> None:
        await self._post_or_buffer(
            PendingPost(
                f"/internal/sessions/{self._session_id}/agent-events",
                payload,
            )
        )

    async def post_score_checkpoint(self, payload: dict[str, Any]) -> None:
        await self._post_or_buffer(
            PendingPost(
                f"/internal/sessions/{self._session_id}/score-checkpoints",
                payload,
            )
        )

    async def post_finalization(self, payload: dict[str, Any]) -> None:
        await self._post_or_buffer(
            PendingPost(
                f"/internal/sessions/{self._session_id}/finalize",
                payload,
            )
        )

    async def _post_or_buffer(self, pending_post: PendingPost) -> None:
        current_task = asyncio.current_task()
        if current_task is not None:
            self._in_flight_posts.add(current_task)
        try:
            await self._transport.post(pending_post.path, pending_post.payload)
        except Exception as exc:
            logger.warning(
                "backend artifact post failed; buffering",
                extra={
                    "session_id": self._session_id,
                    "path": pending_post.path,
                    "error": str(exc),
                    "error_type": type(exc).__name__,
                },
                exc_info=True,
            )
            self._append_pending(pending_post)
        finally:
            if current_task is not None:
                self._in_flight_posts.discard(current_task)

    async def flush(self, timeout_seconds: float | None = None) -> None:
        if timeout_seconds is None:
            await self._wait_for_in_flight_posts(timeout_seconds=None)
            posts = self._pending
            self._pending = []
            await self._flush_posts(posts)
            return

        if timeout_seconds <= 0:
            return

        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout_seconds
        in_flight_complete = await self._wait_for_in_flight_posts(
            timeout_seconds=timeout_seconds
        )
        if not in_flight_complete:
            return

        remaining_timeout_seconds = deadline - loop.time()
        if remaining_timeout_seconds <= 0:
            return

        posts = self._pending
        self._pending = []
        remaining_posts = list(posts)
        while remaining_posts:
            pending_post = remaining_posts.pop(0)
            remaining_seconds = deadline - loop.time()
            if remaining_seconds <= 0:
                self._append_pending_posts([pending_post, *remaining_posts])
                return
            try:
                await asyncio.wait_for(
                    self._transport.post(pending_post.path, pending_post.payload),
                    timeout=remaining_seconds,
                )
            except TimeoutError:
                logger.warning(
                    "pending backend artifact flush timed out; keeping buffered",
                    extra={
                        "session_id": self._session_id,
                        "path": pending_post.path,
                        "timeout_seconds": timeout_seconds,
                    },
                    exc_info=True,
                )
                self._append_pending_posts([pending_post, *remaining_posts])
                return
            except Exception as exc:
                logger.warning(
                    "pending backend artifact post failed; keeping buffered",
                    extra={
                        "session_id": self._session_id,
                        "path": pending_post.path,
                        "error": str(exc),
                        "error_type": type(exc).__name__,
                    },
                    exc_info=True,
                )
                self._append_pending(pending_post)

    async def _wait_for_in_flight_posts(
        self, timeout_seconds: float | None
    ) -> bool:
        tasks = self._active_in_flight_post_tasks()
        if not tasks:
            return True

        if timeout_seconds is None:
            await asyncio.gather(*tasks, return_exceptions=True)
            return True

        if timeout_seconds <= 0:
            return False

        done, pending = await asyncio.wait(tasks, timeout=timeout_seconds)
        if pending:
            logger.warning(
                "backend artifact flush timed out waiting for in-flight posts",
                extra={
                    "session_id": self._session_id,
                    "timeout_seconds": timeout_seconds,
                    "pending_post_tasks": len(pending),
                    "completed_post_tasks": len(done),
                },
            )
            return False
        return True

    def _active_in_flight_post_tasks(self) -> list[asyncio.Task[Any]]:
        current_task = asyncio.current_task()
        return [
            task
            for task in self._in_flight_posts
            if task is not current_task and not task.done()
        ]

    async def _flush_posts(self, posts: list[PendingPost]) -> None:
        for pending_post in posts:
            try:
                await self._transport.post(pending_post.path, pending_post.payload)
            except Exception as exc:
                logger.warning(
                    "pending backend artifact post failed; keeping buffered",
                    extra={
                        "session_id": self._session_id,
                        "path": pending_post.path,
                        "error": str(exc),
                        "error_type": type(exc).__name__,
                    },
                    exc_info=True,
                )
                self._append_pending(pending_post)

    def _append_pending_posts(self, pending_posts: list[PendingPost]) -> None:
        for pending_post in pending_posts:
            self._append_pending(pending_post)

    def _append_pending(self, pending_post: PendingPost) -> None:
        self._pending.append(pending_post)
        while len(self._pending) > self._max_pending:
            dropped = self._pending.pop(0)
            logger.error(
                "backend artifact pending queue full; dropping oldest post",
                extra={
                    "session_id": self._session_id,
                    "path": dropped.path,
                    "max_pending": self._max_pending,
                },
            )
