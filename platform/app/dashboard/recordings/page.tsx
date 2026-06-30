import Link from "next/link";
import {
  dashboardOrgId,
  getRealInterviews,
  getRoomRecordings,
  type RealInterviewListItem,
  type RealRoomRecordingListItem,
} from "../backend-data";
import { requireDashboardUser } from "../auth";
import {
  EmptyState,
  SectionPanel,
  StatusPill,
  formatDateTime,
} from "../dashboard-ui";

export const dynamic = "force-dynamic";

export default async function RecordingsPage() {
  const { user, organizationId } = await requireDashboardUser("/dashboard/recordings");
  const orgId = dashboardOrgId({ organizationId, userId: user.id });
  const [recordings, interviews] = await Promise.all([
    getRoomRecordings({ orgId }),
    getRealInterviews({ orgId }),
  ]);
  const recordingBySessionId = new Map(recordings.map((recording) => [recording.session_id, recording]));
  const nativeSessions = interviews.filter(isNativePuddleSession);
  const nativeRecordedSessionRows = nativeSessions.filter(hasNativeRecordingSignal);
  const nativePendingSessionRows = nativeSessions.filter((session) => !hasNativeRecordingSignal(session));
  const nativeSessionRows = [
    ...nativeRecordedSessionRows,
    ...nativePendingSessionRows,
  ].slice(0, 12);
  const recordingCount = Math.max(recordings.length, nativeRecordedSessionRows.length);
  const historicalFirefliesCount = recordings.filter(isHistoricalFirefliesRecording).length;

  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
      <header className="puddle-dashboard-hero-card overflow-hidden rounded-md border border-cyan-200 bg-white/94 px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={`${recordingCount} recordings`} />
              <StatusPill status={`${nativeSessionRows.length} Puddle sessions`} />
              <StatusPill status={`${historicalFirefliesCount} Fireflies`} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Evidence library</span>
            </div>
            <h1 className="mt-2 break-words text-2xl font-semibold text-slate-950 sm:text-3xl">
              Recordings
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Review imported Fireflies recordings, Puddle room recordings, transcripts, and generated scorecards.
            </p>
          </div>
        </div>
      </header>

      <SectionPanel title="Puddle platform sessions" eyebrow="Native interviews">
        {nativeSessionRows.length ? (
          <div
            data-native-sessions-scroll-region
            className="grid max-h-[calc(100svh-18rem)] gap-2 overflow-y-auto pr-1"
            aria-label="Puddle platform sessions"
          >
            <div className="sticky top-0 z-10 hidden grid-cols-[minmax(180px,1.5fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(110px,0.7fr)_minmax(110px,0.7fr)] gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 md:grid">
              <span>Candidate</span>
              <span>Opened</span>
              <span>Session</span>
              <span>Recording</span>
              <span>Video</span>
            </div>
            {nativeSessionRows.map((session) => {
              const recording = recordingBySessionId.get(session.session_id);
              return (
                <Link
                  key={session.session_id}
                  href={`/dashboard/interviews/${encodeURIComponent(session.session_id)}`}
                  className="grid min-w-0 gap-3 rounded-md border border-slate-200 bg-white/88 px-3 py-3 text-sm transition hover:-translate-y-px hover:border-cyan-200 hover:bg-cyan-50/40 hover:shadow-[0_10px_24px_rgba(8,145,178,0.08)] md:grid-cols-[minmax(180px,1.5fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(110px,0.7fr)_minmax(110px,0.7fr)] md:items-center"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-950">
                      {candidateLabel(session)}
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-500">
                      {sessionRoomLabel(session, recording)}
                    </span>
                  </span>
                  <span className="text-slate-600">
                    {formatNullableDate(session.started_at ?? session.scheduled_at)}
                  </span>
                  <span>
                    <StatusPill status={formatBackendStatus(session.status, "Unknown")} />
                  </span>
                  <span>
                    <StatusPill status={formatBackendStatus(recording?.recording_status ?? session.recording_status, "Missing")} />
                  </span>
                  <span>
                    <StatusPill status={formatBackendStatus(sessionVideoStatus(session, recording), "Missing")} />
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No Puddle sessions yet"
            detail="Native interview sessions created from the Puddle dashboard will appear here as soon as they are scheduled or opened."
          />
        )}
      </SectionPanel>

      <SectionPanel title="Recordings" eyebrow="Completed interviews">
        {recordings.length ? (
          <div
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
                <span className="text-slate-600">{formatNullableDate(recording.started_at ?? recording.recording_started_at)}</span>
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
          </div>
        ) : (
          <EmptyState
            title="No recordings yet"
            detail="Imported Fireflies recordings and completed Puddle room recordings will appear here after recording finalization."
          />
        )}
      </SectionPanel>
    </div>
  );
}

type CandidateDisplayRecord = Pick<RealInterviewListItem, "candidate_email" | "source_metadata">;

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
  const metadataTitle = sourceMetadataString(recording.source_metadata, ["fireflies", "title"]);
  if (metadataTitle) {
    return metadataTitle;
  }

  const roomName = recording.room_name?.trim();
  if (roomName && !isSyntheticFirefliesRoomName(roomName) && !isUrlLikeLabel(roomName)) {
    return roomName;
  }

  return "Fireflies recording";
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

function isNativePuddleSession(session: RealInterviewListItem): boolean {
  return session.external_source !== "fireflies";
}

function hasNativeRecordingSignal(session: RealInterviewListItem): boolean {
  return Boolean(session.recording_status?.trim() || session.egress_id?.trim());
}

function sessionVideoStatus(
  session: RealInterviewListItem,
  recording: RealRoomRecordingListItem | undefined,
): string | null | undefined {
  return recording?.composite_video_status ?? (hasNativeRecordingSignal(session) ? "Open detail" : null);
}

function sessionRoomLabel(
  session: RealInterviewListItem,
  recording: RealRoomRecordingListItem | undefined,
): string {
  const duration = formatDuration(recording?.composite_video_duration_seconds ?? null);
  const room = session.room_name?.trim() || "Puddle room";
  return duration ? `${room} · ${duration}` : room;
}

function sourceMetadataString(value: unknown, path: readonly string[]): string {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return "";
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current.trim() : "";
}

function formatNullableDate(value: string | null): string {
  return value ? formatDateTime(value) : "Not set";
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
