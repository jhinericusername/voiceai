import Link from "next/link";
import { notFound } from "next/navigation";
import { getRealInterview, type RealInterviewDetail } from "../../backend-data";
import { demoSessions, getCandidateById, getRole, getSession } from "../../demo-data";
import {
  EmptyState,
  ScoreBadge,
  SectionPanel,
  StatusPill,
  TableScroller,
  cx,
  formatDateTime,
  primaryButtonClass,
  secondaryButtonClass,
  tableCellClass,
  tableHeaderClass,
} from "../../dashboard-ui";

export function generateStaticParams() {
  return demoSessions.map((session) => ({ sessionId: session.id }));
}

export default async function InterviewSessionPage({ params }: { readonly params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const demoSession = getSession(sessionId);
  let realInterview: RealInterviewDetail | null = null;

  try {
    realInterview = await getRealInterview(sessionId);
  } catch (error) {
    if (!demoSession) {
      throw error;
    }
  }

  if (realInterview) {
    return <RealInterviewSessionView realInterview={realInterview} />;
  }

  const session = demoSession;

  if (!session) {
    notFound();
  }

  const candidate = getCandidateById(session.candidateId);
  const role = getRole(session.roleId);

  if (!candidate || !role) {
    notFound();
  }

  const recommendation = candidate.recommendation ?? "Pending";

  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
      <header className="rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={session.lifecycleStatus} />
              <StatusPill status={candidate.reviewStatus} />
              <StatusPill status={recommendation} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Interview review</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">{candidate.name}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Review the recording, transcript evidence, rubric scores, integrity signals, and recommendation for {role.title}.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/dashboard/review-queue" className={primaryButtonClass}>
              Review queue
            </Link>
            <Link href={`/dashboard/roles/${role.id}`} className={secondaryButtonClass}>
              Back to role
            </Link>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Interview review summary">
        <SummaryCard label="Score" value={candidate.score === null ? "Pending" : `${candidate.score}/${candidate.maxScore}`} detail="AI-generated rubric total" />
        <SummaryCard label="Recommendation" value={recommendation} detail={session.reviewSummary.recommendationRationale} />
        <SummaryCard label="Reviewer" value={session.reviewSummary.owner} detail={`Due ${formatDateTime(session.reviewSummary.dueAt)}`} />
        <SummaryCard label="Duration" value={session.media.durationLabel} detail={session.media.note} />
        <SummaryCard label="Integrity" value={`${candidate.integrityFlags} flags`} detail={`${candidate.aiRisk} risk / ${candidate.aiRiskPercent}% score`} />
      </section>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="grid min-w-0 gap-5">
          <SectionPanel
            title="Video and audio review"
            eyebrow="Recording"
            action={
              <div className="flex flex-wrap gap-2">
                <StatusPill status={`Video ${session.media.videoStatus}`} />
                <StatusPill status={`Audio ${session.media.audioStatus}`} />
                <StatusPill status={`Transcript ${session.media.transcriptStatus}`} />
              </div>
            }
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="min-w-0 overflow-hidden rounded-md border border-slate-800 bg-slate-950 text-white">
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs text-slate-300">
                  <span>{session.roomName}</span>
                  <span>{session.media.durationLabel}</span>
                </div>
                <div className="grid aspect-video place-items-center bg-[radial-gradient(circle_at_50%_30%,rgba(34,211,238,0.22),transparent_36%),linear-gradient(135deg,#020617,#0f172a)] px-6 text-center">
                  <div>
                    <div className="mx-auto grid h-20 w-20 place-items-center rounded-full border border-white/20 bg-white/10 text-2xl font-semibold">
                      {candidate.initials}
                    </div>
                    <div className="mt-4 text-lg font-semibold">Interview recording placeholder</div>
                    <div className="mt-2 text-sm leading-6 text-slate-300">{session.media.note}</div>
                  </div>
                </div>
                <div className="border-t border-white/10 px-4 py-3">
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>{session.media.playbackPositionLabel}</span>
                    <span>{session.media.durationLabel}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full w-[42%] rounded-full bg-cyan-300" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-semibold text-white">
                      Play
                    </button>
                    <button type="button" className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-semibold text-white">
                      Jump to evidence
                    </button>
                    <button type="button" className="rounded-md border border-white/15 px-3 py-1.5 text-xs font-semibold text-white">
                      Audio only
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid content-start gap-3">
                {session.markers.length ? (
                  session.markers.map((marker) => (
                    <div key={`${marker.timestamp}-${marker.label}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-mono text-xs font-semibold text-slate-500">{marker.timestamp}</div>
                          <div className="mt-1 text-sm font-semibold text-slate-950">{marker.label}</div>
                        </div>
                        <StatusPill status={marker.type} />
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{marker.detail}</p>
                    </div>
                  ))
                ) : (
                  <EmptyState title="No media markers yet" detail="Evidence and integrity markers appear after transcript processing." />
                )}
              </div>
            </div>
          </SectionPanel>

          <SectionPanel title="Transcript and evidence" eyebrow="Transcript">
            {session.transcript.length ? (
              <div className="grid gap-3">
                {session.transcript.map((turn) => (
                  <article
                    key={`${turn.timestamp}-${turn.speaker}-${turn.question}`}
                    className={cx(
                      "rounded-md border px-3 py-3",
                      turn.speaker === "Candidate" ? "border-cyan-200 bg-cyan-50/40" : "border-slate-200 bg-slate-50",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-slate-500">{turn.timestamp}</span>
                      <StatusPill status={turn.speaker} />
                      {turn.risk ? <StatusPill status={turn.risk} /> : null}
                    </div>
                    <div className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{turn.question}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">&quot;{turn.text}&quot;</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {turn.evidenceTags.map((tag) => (
                        <span key={tag} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="Transcript unavailable" detail="Transcript turns appear here after recording finalization and post-processing complete." />
            )}
          </SectionPanel>

          <SectionPanel title="Rubric scorecard" eyebrow="Scores">
            {candidate.scorecard.length ? (
              <TableScroller>
                <table className="min-w-[760px] w-full border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className={`${tableHeaderClass} rounded-l-md px-3 py-2`}>Dimension</th>
                      <th className={`${tableHeaderClass} px-3 py-2`}>Score</th>
                      <th className={`${tableHeaderClass} px-3 py-2`}>Signal</th>
                      <th className={`${tableHeaderClass} rounded-r-md px-3 py-2`}>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidate.scorecard.map((row) => (
                      <tr key={row.dimension}>
                        <td className={`${tableCellClass} font-medium text-slate-950`}>
                          {row.dimension}
                          <div className="mt-1 text-xs font-normal leading-5 text-slate-500">{row.note}</div>
                        </td>
                        <td className={tableCellClass}>
                          <ScoreBadge score={row.score} maxScore={row.maxScore} />
                        </td>
                        <td className={tableCellClass}>
                          <StatusPill status={row.barSignal} />
                        </td>
                        <td className={tableCellClass}>{row.evidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroller>
            ) : (
              <EmptyState title="Scorecard pending" detail="Rubric scores appear after transcript processing and scorer finalization." />
            )}
          </SectionPanel>
        </main>

        <aside className="grid min-w-0 gap-5 xl:content-start">
          <SectionPanel title="Recommendation" eyebrow="Human decision">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">AI recommendation</div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="text-2xl font-semibold text-slate-950">{recommendation}</div>
                <ScoreBadge score={candidate.score} maxScore={candidate.maxScore} />
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">{session.reviewSummary.recommendationRationale}</p>
            </div>

            <div className="mt-3 grid gap-2">
              {session.reviewSummary.reviewFocus.map((item) => (
                <div key={item} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700">
                  {item}
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              <button type="button" className={secondaryButtonClass}>
                Advance
              </button>
              <button type="button" className={secondaryButtonClass}>
                Hold
              </button>
              <button type="button" className={secondaryButtonClass}>
                Pass
              </button>
            </div>
            <label className="mt-3 block">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Reviewer note</span>
              <textarea
                className="mt-2 min-h-24 w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                defaultValue={
                  candidate.reviewStatus === "In review"
                    ? "Need to inspect specificity drop before final decision."
                    : ""
                }
                placeholder="Add calibration note before signing off."
              />
            </label>
            <button type="button" className={cx(primaryButtonClass, "mt-3 w-full")}>
              Mark reviewed
            </button>
          </SectionPanel>

          <SectionPanel title="Integrity signals" eyebrow="Authenticity">
            {candidate.authenticitySignals.length ? (
              <div className="grid gap-3">
                {candidate.authenticitySignals.map((signal) => (
                  <div key={signal.signal} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-medium text-slate-950">{signal.signal}</div>
                      <StatusPill status={signal.rating} />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{signal.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No integrity signals" detail="Signals appear after timing and transcript analysis complete." />
            )}
          </SectionPanel>

          <SectionPanel title="Artifacts" eyebrow="Packet contents">
            <div className="grid gap-3">
              {session.artifactChecklist.length ? (
                session.artifactChecklist.map((artifact) => (
                  <div key={artifact.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-medium text-slate-950">{artifact.label}</div>
                      <StatusPill status={artifact.status} />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{artifact.detail}</p>
                  </div>
                ))
              ) : (
                <EmptyState title="Artifacts not created yet" detail="Recording, transcript, scorecard, and integrity artifacts appear here as the session moves through the lifecycle." />
              )}
            </div>
          </SectionPanel>

          <SectionPanel title="Audit timeline" eyebrow="Events">
            <div className="grid gap-3">
              {session.timeline.map((event) => (
                <div key={`${event.at}-${event.label}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-950">{event.label}</div>
                      <div className="mt-1 text-xs text-slate-500">{formatDateTime(event.at)}</div>
                    </div>
                    <StatusPill status={event.severity === "warning" ? "In review" : "Available"} />
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{event.detail}</p>
                </div>
              ))}
            </div>
          </SectionPanel>
        </aside>
      </div>
    </div>
  );
}

function RealInterviewSessionView({
  realInterview,
}: {
  readonly realInterview: RealInterviewDetail;
}) {
  const recommendation = realPacketRecommendation(realInterview);
  const transcriptTurns = [...realInterview.transcript_turns].sort(
    (first, second) => first.turnIndex - second.turnIndex,
  );

  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
      <header className="rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={formatBackendStatus(realInterview.status, "Unknown")} />
              <StatusPill status={recommendation} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Real interview packet</span>
            </div>
            <h1 className="mt-2 break-words text-2xl font-semibold text-slate-950 sm:text-3xl">{realInterview.candidate_email}</h1>
            <p className="mt-2 max-w-3xl break-words text-sm leading-6 text-slate-600">
              Session {realInterview.session_id} from script {realInterview.script_version}.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/dashboard/review-queue" className={primaryButtonClass}>
              Review queue
            </Link>
            <Link href="/dashboard" className={secondaryButtonClass}>
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Interview packet summary">
        <SummaryCard label="Status" value={formatBackendStatus(realInterview.status, "Unknown")} detail={`Org ${realInterview.org_id}`} />
        <SummaryCard label="Recording" value={formatBackendStatus(realInterview.recording_status, "Pending")} detail={realInterview.room_name ?? "No room attached"} />
        <SummaryCard label="Score" value={formatCategoryScoreSummary(realInterview.category_scores)} detail={recommendation} />
        <SummaryCard label="Reviewer" value={realInterview.reviewer_email ?? "Unassigned"} detail={realInterview.signed_off_at ? `Signed ${formatDateTime(realInterview.signed_off_at)}` : "Awaiting sign-off"} />
        <SummaryCard label="Started" value={formatNullableDate(realInterview.started_at)} detail={realInterview.ended_at ? `Ended ${formatDateTime(realInterview.ended_at)}` : "Interview not ended"} />
      </section>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="grid min-w-0 gap-5">
          <SectionPanel
            title="Video and audio review"
            eyebrow="Recording"
            action={
              <div className="flex flex-wrap gap-2">
                <StatusPill status={formatBackendStatus(realInterview.recording_status, "Pending")} />
                <StatusPill status={realInterview.compositeVideoUrl ? "Available" : "Missing"} />
              </div>
            }
          >
            {realInterview.compositeVideoUrl ? (
              <video className="aspect-video w-full rounded-md bg-slate-950" controls src={realInterview.compositeVideoUrl} />
            ) : (
              <EmptyState title="Composite video unavailable" detail="The backend packet has no available composite recording URL yet." />
            )}
          </SectionPanel>

          <SectionPanel title="Transcript and evidence" eyebrow="Transcript">
            {transcriptTurns.length ? (
              <div className="grid gap-3">
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
                      <StatusPill status={formatBackendStatus(turn.speaker, "Speaker")} />
                      {turn.questionId ? <StatusPill status={turn.questionId} /> : null}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{turn.text}</p>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="Transcript unavailable" detail="Transcript turns appear here after recording finalization and post-processing complete." />
            )}
          </SectionPanel>
        </main>

        <aside className="grid min-w-0 gap-5 xl:content-start">
          <SectionPanel title="Packet status" eyebrow="Backend">
            <dl className="grid gap-3">
              <PacketMetaRow label="Session" value={realInterview.session_id} />
              <PacketMetaRow label="Room" value={realInterview.room_name ?? "No room"} />
              <PacketMetaRow label="Scheduled" value={formatNullableDate(realInterview.scheduled_at)} />
              <PacketMetaRow label="Integrity" value={formatUnknownCollection(realInterview.integrity_flags, "flags")} />
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
                        <div className="truncate text-sm font-semibold text-slate-950">{formatScoreLabel(artifact.kind)}</div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">
                          {artifact.contentType} / {formatBytes(artifact.sizeBytes)} / {formatDuration(artifact.durationSeconds)}
                        </div>
                      </div>
                      <StatusPill status={formatBackendStatus(artifact.status, "Unknown")} />
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-slate-500">{artifact.storagePath}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Artifacts not created yet" detail="Recording, transcript, scorecard, and integrity artifacts appear here as the session moves through the lifecycle." />
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

function formatOffset(value: number | null): string | null {
  if (value === null) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
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
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}
