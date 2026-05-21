"""Append-only, hash-chained audit log writer.

Each entry stores a SHA-256 hash over its own content plus the previous
entry's hash, making silent edits or deletions detectable by `verify`.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _canonical(entry: dict[str, Any]) -> str:
    """Stable JSON string of an entry without its own `entry_hash`."""
    payload = {k: v for k, v in entry.items() if k != "entry_hash"}
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _hash_entry(entry: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical(entry).encode("utf-8")).hexdigest()


class AuditLogWriter:
    """Appends hash-chained entries to a JSONL audit log file."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def _last_hash(self) -> str | None:
        if not self._path.exists() or self._path.stat().st_size == 0:
            return None
        last_line = self._path.read_text().strip().splitlines()[-1]
        return json.loads(last_line)["entry_hash"]

    def write(self, event_type: str, payload: dict[str, Any]) -> None:
        """Append one entry, chaining it to the prior entry's hash."""
        entry: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event_type": event_type,
            "payload": payload,
            "prev_hash": self._last_hash(),
        }
        entry["entry_hash"] = _hash_entry(entry)
        with self._path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, separators=(",", ":")) + "\n")

    @staticmethod
    def verify(path: Path) -> bool:
        """Return True if the hash chain is intact and untampered."""
        if not path.exists() or path.stat().st_size == 0:
            return True
        prev: str | None = None
        for line in path.read_text().strip().splitlines():
            entry = json.loads(line)
            if entry["prev_hash"] != prev:
                return False
            if _hash_entry(entry) != entry["entry_hash"]:
                return False
            prev = entry["entry_hash"]
        return True
