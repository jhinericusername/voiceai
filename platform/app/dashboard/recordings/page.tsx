import Link from "next/link";
import {
  dashboardOrgId,
  getRoomRecordings,
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
  const recordings = await getRoomRecordings({ orgId });
  const historicalFirefliesCount = recordings.filter(isHistoricalFirefliesRecording).length;

  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
      <header className="puddle-dashboard-hero-card overflow-hidden rounded-md border border-cyan-200 bg-white/94 px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={`${recordings.length} recordings`} />
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
                    {candidateLabel(recording)}
                  </span>
                  <span className="mt-1 block truncate text-xs text-slate-500">
                    {roomLabel(recording)}
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

function candidateLabel(recording: RealRoomRecordingListItem): string {
  const metadataName = sourceMetadataString(recording.source_metadata, [
    "ashby",
    "selected",
    "candidateName",
  ]);
  return metadataName || recording.candidate_email?.trim() || "Candidate";
}

function roomLabel(recording: RealRoomRecordingListItem): string {
  const duration = formatDuration(recording.composite_video_duration_seconds);
  const room = recording.room_name?.trim() || (isHistoricalFirefliesRecording(recording) ? "Fireflies recording" : "Puddle room");
  return duration ? `${room} · ${duration}` : room;
}

function isHistoricalFirefliesRecording(recording: RealRoomRecordingListItem): boolean {
  return recording.external_source === "fireflies" || recording.egress_id?.startsWith("fireflies:") === true;
}

function recordingSourceLabel(recording: RealRoomRecordingListItem): string {
  return isHistoricalFirefliesRecording(recording) ? "Historical Fireflies" : "Puddle room";
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
