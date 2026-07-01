"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealRoomRecordingListItem } from "../backend-data";
import { StatusPill, formatDateTime } from "../dashboard-ui";
import { RECORDINGS_PAGE_SIZE } from "./recordings-pagination";

export function RecordingsList({
  initialRecordings,
  initialHasMore,
}: {
  readonly initialRecordings: readonly RealRoomRecordingListItem[];
  readonly initialHasMore: boolean;
}) {
  const [recordings, setRecordings] = useState(() => [...initialRecordings]);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextOffset, setNextOffset] = useState(initialRecordings.length);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const scrollRegionRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMoreRecordings = useCallback(async () => {
    if (!hasMore || isLoading) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/dashboard/recordings?limit=${RECORDINGS_PAGE_SIZE}&offset=${nextOffset}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        readonly recordings?: readonly RealRoomRecordingListItem[];
        readonly hasMore?: boolean;
        readonly nextOffset?: number;
        readonly error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Unable to load recordings.");
      }

      const nextRecordings = payload.recordings ?? [];
      setRecordings((currentRecordings) => [...currentRecordings, ...nextRecordings]);
      setHasMore(Boolean(payload.hasMore));
      setNextOffset(
        typeof payload.nextOffset === "number" && Number.isFinite(payload.nextOffset)
          ? payload.nextOffset
          : nextOffset + nextRecordings.length,
      );
    } catch {
      setError("Unable to load more recordings.");
    } finally {
      setIsLoading(false);
    }
  }, [hasMore, isLoading, nextOffset]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreRecordings();
        }
      },
      {
        root: scrollRegionRef.current,
        rootMargin: "160px 0px",
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMoreRecordings]);

  return (
    <div
      ref={scrollRegionRef}
      data-recordings-scroll-region
      className="grid max-h-[calc(100svh-18rem)] gap-2 overflow-y-auto pr-1"
      aria-label="Recordings"
    >
      <div className="sticky top-0 z-10 hidden grid-cols-[minmax(180px,1.5fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(110px,0.7fr)_minmax(110px,0.7fr)_minmax(110px,0.7fr)] gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 md:grid">
        <span>Meeting</span>
        <span>Source</span>
        <span>Started</span>
        <span>Recording</span>
        <span>Video</span>
        <span>Transcript</span>
      </div>
      {recordings.map((recording) => (
        <Link
          key={recording.session_id}
          href={`/dashboard/interviews/${encodeURIComponent(recording.session_id)}`}
          className="grid min-w-0 gap-3 rounded-md border border-slate-200 bg-white/88 px-3 py-3 text-sm transition hover:-translate-y-px hover:border-cyan-200 hover:bg-cyan-50/40 hover:shadow-[0_10px_24px_rgba(8,145,178,0.08)] md:grid-cols-[minmax(180px,1.5fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(110px,0.7fr)_minmax(110px,0.7fr)_minmax(110px,0.7fr)] md:items-center"
        >
          <span className="min-w-0">
            <span className="block truncate font-semibold text-slate-950">
              {recordingPrimaryLabel(recording)}
            </span>
            <span className="mt-1 block truncate text-xs text-slate-500">
              {recordingSecondaryLabel(recording)}
            </span>
          </span>
          <span>
            <StatusPill status={recordingSourceLabel(recording)} />
          </span>
          <span className="text-slate-600">{formatRecordingStartedAt(recording)}</span>
          <span>
            <StatusPill status={formatBackendStatus(recording.recording_status, "Unknown")} />
          </span>
          <span>
            <StatusPill status={formatBackendStatus(recording.composite_video_status, "Missing")} />
          </span>
          <span className="text-slate-600">
            {recording.transcript_turn_count} {recording.transcript_turn_count === 1 ? "turn" : "turns"}
          </span>
        </Link>
      ))}
      {hasMore ? <div ref={sentinelRef} aria-hidden="true" className="h-1" /> : null}
      {isLoading ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium text-slate-600" role="status">
          Loading more recordings...
        </div>
      ) : null}
      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800">
          <span>{error}</span>
          <button
            type="button"
            className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 transition hover:bg-rose-100"
            onClick={() => void loadMoreRecordings()}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

type CandidateDisplayRecord = Pick<RealRoomRecordingListItem, "candidate_email" | "source_metadata">;

function candidateLabel(record: CandidateDisplayRecord): string {
  const metadataName = sourceMetadataString(record.source_metadata, [
    "ashby",
    "selected",
    "candidateName",
  ]);
  return metadataName || record.candidate_email?.trim() || "Candidate";
}

function roomLabel(recording: RealRoomRecordingListItem): string {
  const duration = formatDuration(recording.composite_video_duration_seconds);
  const room = isHistoricalFirefliesRecording(recording)
    ? firefliesRecordingTitle(recording)
    : recording.room_name?.trim() || "Puddle room";
  return duration ? `${room} · ${duration}` : room;
}

function recordingPrimaryLabel(recording: RealRoomRecordingListItem): string {
  return isHistoricalFirefliesRecording(recording)
    ? roomLabel(recording)
    : candidateLabel(recording);
}

function recordingSecondaryLabel(recording: RealRoomRecordingListItem): string {
  const candidate = candidateLabel(recording);
  return isHistoricalFirefliesRecording(recording)
    ? candidate
    : roomLabel(recording);
}

function firefliesRecordingTitle(recording: RealRoomRecordingListItem): string {
  const metadataTitle = firefliesMetadataTitle(recording.source_metadata);
  if (metadataTitle) {
    return metadataTitle;
  }

  const roomName = recording.room_name?.trim();
  if (roomName && !isSyntheticFirefliesRoomName(roomName) && !isUrlLikeLabel(roomName)) {
    return roomName;
  }

  return "Fireflies recording";
}

function firefliesMetadataTitle(value: unknown): string {
  return (
    sourceMetadataDisplayTitle(value, ["fireflies", "title"]) ||
    sourceMetadataDisplayTitle(value, ["fireflies", "eventTitle"]) ||
    sourceMetadataDisplayTitle(value, ["fireflies", "meetingTitle"]) ||
    sourceMetadataEventTitle(value, ["fireflies", "event"]) ||
    sourceMetadataDisplayTitle(value, ["metadata", "eventTitle"]) ||
    sourceMetadataDisplayTitle(value, ["metadata", "meetingTitle"]) ||
    sourceMetadataDisplayTitle(value, ["metadata", "title"]) ||
    sourceMetadataEventTitle(value, ["metadata", "event"]) ||
    sourceMetadataDisplayTitle(value, ["transcript", "title"]) ||
    sourceMetadataDisplayTitle(value, ["transcript", "meetingTitle"]) ||
    sourceMetadataDisplayTitle(value, ["summary", "title"]) ||
    sourceMetadataDisplayTitle(value, ["summary", "meetingTitle"]) ||
    sourceMetadataDisplayTitle(value, ["ingestion", "title"]) ||
    sourceMetadataDisplayTitle(value, ["ingestion", "meetingTitle"]) ||
    sourceMetadataDisplayTitle(value, ["title"]) ||
    sourceMetadataDisplayTitle(value, ["meetingTitle"]) ||
    sourceMetadataDisplayTitle(value, ["eventTitle"]) ||
    sourceMetadataEventTitle(value, ["event"])
  );
}

function formatRecordingStartedAt(recording: RealRoomRecordingListItem): string {
  const startedAt = recordingStartedAt(recording);
  if (!startedAt) {
    return "Not set";
  }

  const dateOnlyStartedAt = dateOnlyFirefliesStartedAt(recording, startedAt);
  return dateOnlyStartedAt ? formatDateOnlyLabel(dateOnlyStartedAt) : formatDateTime(startedAt);
}

function recordingStartedAt(recording: RealRoomRecordingListItem): string | null {
  const metadataStartedAt = exactFirefliesMetadataStartedAt(recording);
  return metadataStartedAt || (recording.recording_started_at ?? recording.started_at ?? recording.scheduled_at);
}

function exactFirefliesMetadataStartedAt(recording: RealRoomRecordingListItem): string {
  if (!isHistoricalFirefliesRecording(recording)) {
    return "";
  }

  return (
    sourceMetadataString(recording.source_metadata, ["fireflies", "meetingStartedAt"]) ||
    sourceMetadataString(recording.source_metadata, ["fireflies", "meeting_start"]) ||
    sourceMetadataString(recording.source_metadata, ["fireflies", "startTime"]) ||
    sourceMetadataString(recording.source_metadata, ["fireflies", "started_at"]) ||
    sourceMetadataString(recording.source_metadata, ["meetingStartedAt"]) ||
    sourceMetadataString(recording.source_metadata, ["meeting_start"]) ||
    sourceMetadataString(recording.source_metadata, ["startTime"]) ||
    sourceMetadataString(recording.source_metadata, ["started_at"]) ||
    sourceMetadataString(recording.source_metadata, ["metadata", "meetingStartedAt"]) ||
    sourceMetadataString(recording.source_metadata, ["metadata", "meeting_start"]) ||
    sourceMetadataString(recording.source_metadata, ["metadata", "startTime"]) ||
    sourceMetadataString(recording.source_metadata, ["metadata", "started_at"]) ||
    sourceMetadataString(recording.source_metadata, ["transcript", "meetingStartTime"])
  );
}

function dateOnlyFirefliesStartedAt(recording: RealRoomRecordingListItem, startedAt: string): string {
  if (!isHistoricalFirefliesRecording(recording)) {
    return "";
  }

  const exactStartedAt = exactFirefliesMetadataStartedAt(recording);
  if (exactStartedAt) {
    return "";
  }

  const startedAtDate = dateOnlyIsoPart(startedAt);
  if (!startedAtDate || (!isDateOnlyValue(startedAt) && !isUtcMidnight(startedAt))) {
    return "";
  }

  const normalizedDateOnlyStartedAt = sourceMetadataString(recording.source_metadata, [
    "fireflies",
    "dateOnlyStartedAt",
  ]);
  if (dateOnlyIsoPart(normalizedDateOnlyStartedAt) === startedAtDate) {
    return startedAtDate;
  }

  const metadataDate =
    sourceMetadataString(recording.source_metadata, ["fireflies", "meetingDate"]) ||
    sourceMetadataString(recording.source_metadata, ["transcript", "date"]);
  return dateOnlyIsoPart(metadataDate) === startedAtDate ? startedAtDate : "";
}

function isSyntheticFirefliesRoomName(value: string): boolean {
  return /^fireflies-[A-Za-z0-9_-]+$/.test(value);
}

function isUrlLikeLabel(value: string): boolean {
  return /^(?:https?|wss?):\/\//i.test(value);
}

function isHistoricalFirefliesRecording(recording: RealRoomRecordingListItem): boolean {
  return recording.external_source === "fireflies" || recording.egress_id?.startsWith("fireflies:") === true;
}

function recordingSourceLabel(recording: RealRoomRecordingListItem): string {
  return isHistoricalFirefliesRecording(recording) ? "Historical Fireflies" : "Puddle room";
}

function sourceMetadataDisplayTitle(value: unknown, path: readonly string[]): string {
  return displayTitleString(sourceMetadataValue(value, path));
}

function sourceMetadataEventTitle(value: unknown, path: readonly string[]): string {
  const event = sourceMetadataValue(value, path);
  const parsed = parsedRecord(event);
  if (!parsed) {
    return "";
  }
  return (
    firstDisplayTitle(parsed, ["title", "summary", "name", "subject"]) ||
    ""
  );
}

function sourceMetadataString(value: unknown, path: readonly string[]): string {
  const current = sourceMetadataValue(value, path);
  return typeof current === "string" ? current.trim() : "";
}

function sourceMetadataValue(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function firstDisplayTitle(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const title = displayTitleString(record[key]);
    if (title) {
      return title;
    }
  }
  return "";
}

function displayTitleString(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title || isUrlLikeLabel(title)) {
    return "";
  }
  return title;
}

function parsedRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim().startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isDateOnlyValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function isUtcMidnight(value: string): boolean {
  const date = new Date(value);
  return (
    Number.isFinite(date.getTime()) &&
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

function dateOnlyIsoPart(value: string): string {
  const trimmed = value.trim();
  const dateOnlyMatch = /^(\d{4}-\d{2}-\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    return dateOnlyMatch[1];
  }

  const date = new Date(trimmed);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function formatDateOnlyLabel(value: string): string {
  const isoDate = dateOnlyIsoPart(value);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00.000Z`));
}

function formatDuration(value: number | string | null): string {
  const seconds = typeof value === "string" ? Number(value) : value;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }

  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (minutes <= 0) {
    return `${remainder}s`;
  }
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

function formatBackendStatus(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }

  const normalized = trimmed.replace(/[_-]+/g, " ").toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
