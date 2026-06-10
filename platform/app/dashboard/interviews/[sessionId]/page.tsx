import Link from "next/link";
import { notFound } from "next/navigation";
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
  const session = getSession(sessionId);

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
