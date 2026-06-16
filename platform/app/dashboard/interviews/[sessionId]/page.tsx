import Link from "next/link";
import { notFound } from "next/navigation";
import {
  dashboardOrgId,
  getRealInterview,
  type RealInterviewDetail,
} from "../../backend-data";
import { requireDashboardUser } from "../../auth";
import {
  EmptyState,
  SectionPanel,
  StatusPill,
  cx,
  formatDateTime,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../dashboard-ui";

export function generateStaticParams() {
  return [];
}

export default async function InterviewSessionPage({ params }: { readonly params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const { user, organizationId } = await requireDashboardUser();
  const orgId = dashboardOrgId({ organizationId, userId: user.id });
  let realInterview: RealInterviewDetail | null = null;

  try {
    realInterview = await getRealInterview(sessionId, { orgId });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Unable to load real interview detail", error);
    }
  }

  if (!realInterview) {
    notFound();
  }

  return <RealInterviewDetailView realInterview={realInterview} />;
}

function RealInterviewDetailView({
  realInterview,
}: {
  readonly realInterview: RealInterviewDetail;
}) {
  const recommendation = realPacketRecommendation(realInterview);
  const isHistoricalFireflies = realInterview.external_source === "fireflies";
  const transcriptTurns = [...realInterview.transcript_turns].sort(
    (first, second) => first.turnIndex - second.turnIndex,
  );
  const candidateLabel = realInterview.candidate_email?.trim() || "Candidate";
  const completedAt = realInterview.started_at ?? realInterview.scheduled_at;
  const videoArtifact = realInterview.artifacts.find((artifact) => artifact.kind === "composite_video");
  const audioArtifact = realInterview.artifacts.find((artifact) => artifact.kind === "candidate_audio");
  const playbackArtifact = videoArtifact ?? audioArtifact;

  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
      <header className="rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={formatBackendStatus(realInterview.status, "Unknown")} />
              <StatusPill status={recommendation} />
              {isHistoricalFireflies ? <StatusPill status="Historical Fireflies import" /> : null}
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Interview review</span>
            </div>
            <h1 className="mt-2 break-words text-2xl font-semibold text-slate-950 sm:text-3xl">
              {candidateLabel}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Review the recording, transcript, and recommendation for this interview.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/dashboard/review-queue" className={primaryButtonClass}>
              Review queue
            </Link>
            <Link href="/dashboard/roles" className={secondaryButtonClass}>
              Roles
            </Link>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Interview packet summary">
        <SummaryCard
          label="Status"
          value={formatBackendStatus(realInterview.status, "Unknown")}
          detail={realInterview.signed_off_at ? `Reviewed ${formatDateTime(realInterview.signed_off_at)}` : "Awaiting review"}
        />
        <SummaryCard
          label="Recording"
          value={playbackArtifact ? formatBackendStatus(playbackArtifact.status, "Available") : "Missing"}
          detail={playbackArtifact ? artifactKindLabel(playbackArtifact.kind) : "No playable media attached"}
        />
        <SummaryCard label="Score" value={formatCategoryScoreSummary(realInterview.category_scores)} detail={recommendation} />
        <SummaryCard
          label="Started"
          value={formatNullableDate(completedAt)}
          detail={realInterview.ended_at ? `Ended ${formatDateTime(realInterview.ended_at)}` : "End time unavailable"}
        />
      </section>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
        <main className="grid min-w-0 gap-5">
          <SectionPanel
            title="Video and audio review"
            eyebrow="Recording"
            action={
              <div className="flex flex-wrap gap-2">
                <StatusPill status={videoArtifact ? formatBackendStatus(videoArtifact.status, "Video") : "Video missing"} />
                <StatusPill status={audioArtifact ? formatBackendStatus(audioArtifact.status, "Audio") : "Audio missing"} />
              </div>
            }
          >
            {realInterview.compositeVideoUrl ? (
              <video className="aspect-video w-full rounded-md bg-slate-950" controls src={realInterview.compositeVideoUrl} />
            ) : realInterview.candidateAudioUrl ? (
              <div className="grid min-h-56 place-items-center rounded-md bg-slate-950 px-4 py-8">
                <div className="w-full max-w-xl">
                  <div className="mb-4 text-center text-sm font-semibold text-white">Audio recording</div>
                  <audio className="w-full" controls src={realInterview.candidateAudioUrl} />
                </div>
              </div>
            ) : (
              <EmptyState title="Playable media unavailable" detail="The interview packet has no available playback URL yet." />
            )}
          </SectionPanel>

          <SectionPanel title="Review packet" eyebrow="Summary">
            <dl className="grid gap-3 sm:grid-cols-2">
              <PacketMetaRow label="Candidate" value={candidateLabel} />
              <PacketMetaRow label="Reviewer" value={realInterview.reviewer_email ?? "Unassigned"} />
              <PacketMetaRow label="Integrity" value={formatUnknownCollection(realInterview.integrity_flags, "flags")} />
              {isHistoricalFireflies ? <PacketMetaRow label="Source" value="Fireflies historical import" /> : null}
              {realInterview.error_message ? <PacketMetaRow label="Error" value={realInterview.error_message} /> : null}
            </dl>
          </SectionPanel>

          <SectionPanel title="Artifacts" eyebrow="Packet contents">
            {realInterview.artifacts.length ? (
              <div className="grid gap-3">
                {realInterview.artifacts.map((artifact) => (
                  <div key={`${artifact.kind}-${artifact.storagePath}`} className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-950">{artifactKindLabel(artifact.kind)}</div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">
                          {formatArtifactDetail(artifact.contentType, artifact.sizeBytes, artifact.durationSeconds)}
                        </div>
                      </div>
                      <StatusPill status={formatBackendStatus(artifact.status, "Unknown")} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Artifacts not created yet" detail="Recording and transcript artifacts appear here as the session moves through the lifecycle." />
            )}
          </SectionPanel>
        </main>

        <aside aria-label="Transcript" className="grid min-w-0 gap-5 xl:content-start">
          <SectionPanel title="Transcript" eyebrow="Evidence">
            {transcriptTurns.length ? (
              <div className="grid gap-3 xl:max-h-[calc(100svh-12rem)] xl:overflow-y-auto xl:pr-1">
                {transcriptTurns.map((turn) => (
                  <article
                    key={`${turn.turnIndex}-${turn.speaker}-${turn.occurredAt}`}
                    className={cx(
                      "rounded-md border px-3 py-3",
                      turn.speaker === "candidate" ? "border-cyan-200 bg-cyan-50/40" : "border-slate-200 bg-slate-50",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-500">
                        {formatOffset(turn.offsetMs) ?? formatDateTime(turn.occurredAt)}
                      </span>
                      <StatusPill status={formatSpeaker(turn.speaker)} />
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{turn.text}</p>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="Transcript unavailable" detail="Transcript turns appear here after recording finalization and post-processing complete." />
            )}
          </SectionPanel>
        </aside>
      </div>
    </div>
  );
}

function formatBackendStatus(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }

  const normalized = trimmed.replace(/[_-]+/g, " ").toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatNullableDate(value: string | null): string {
  return value ? formatDateTime(value) : "Not set";
}

function scoreValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return scoreValue(record.score ?? record.value ?? record.rating);
  }

  return null;
}

function formatScoreLabel(value: string): string {
  const normalized = value.replace(/[_-]+/g, " ").trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatCategoryScoreSummary(categoryScores: unknown): string {
  if (!categoryScores) {
    return "Scores pending";
  }
  if (Array.isArray(categoryScores)) {
    return categoryScores.length ? `${categoryScores.length} scores` : "Scores pending";
  }
  if (typeof categoryScores !== "object") {
    return "Scorecard ready";
  }

  const scores = Object.entries(categoryScores as Record<string, unknown>)
    .map(([key, value]) => {
      const score = scoreValue(value);
      return score ? `${formatScoreLabel(key)} ${score}` : null;
    })
    .filter((value): value is string => Boolean(value));

  if (!scores.length) {
    return "Scorecard ready";
  }

  const visibleScores = scores.slice(0, 2).join(" / ");
  return scores.length > 2 ? `${visibleScores} +${scores.length - 2}` : visibleScores;
}

function realPacketRecommendation(interview: RealInterviewDetail): string {
  if (interview.meets_bare_minimum === true) {
    return "Meets bar";
  }
  if (interview.meets_bare_minimum === false) {
    return "Below bar";
  }
  return "Pending";
}

function formatUnknownCollection(value: unknown, label: string): string {
  if (!value) {
    return `No ${label}`;
  }
  if (Array.isArray(value)) {
    return value.length ? `${value.length} ${label}` : `No ${label}`;
  }
  if (typeof value === "object") {
    const count = Object.keys(value as Record<string, unknown>).length;
    return count ? `${count} ${label}` : `No ${label}`;
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return `No ${label}`;
}

function formatBytes(value: number | null): string {
  if (value === null) {
    return "Size pending";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(value: number | null): string {
  if (value === null) {
    return "Duration pending";
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatArtifactDetail(contentType: string, sizeBytes: number | null, durationSeconds: number | null): string {
  return [contentType, formatBytes(sizeBytes), formatDuration(durationSeconds)].join(" / ");
}

function formatOffset(value: number | null): string | null {
  if (value === null) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatSpeaker(value: "agent" | "candidate"): string {
  return value === "agent" ? "Interviewer" : "Candidate";
}

function artifactKindLabel(value: string): string {
  switch (value) {
    case "composite_video":
      return "Video";
    case "candidate_audio":
      return "Audio";
    case "transcript":
      return "Transcript";
    default:
      return formatScoreLabel(value);
  }
}

function PacketMetaRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm leading-6 text-slate-700">{value}</dd>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-2 truncate text-xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{detail}</div>
    </div>
  );
}
