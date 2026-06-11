import Link from "next/link";
import { notFound } from "next/navigation";
import { demoCandidates, getCandidate, getRole } from "../../../../demo-data";
import {
  EmptyState,
  ScoreBadge,
  SectionPanel,
  StatusPill,
  TableScroller,
  formatDateTime,
  primaryButtonClass,
  secondaryButtonClass,
  tableCellClass,
  tableHeaderClass,
} from "../../../../dashboard-ui";

export function generateStaticParams() {
  return demoCandidates
    .filter((candidate) => candidate.scorecard.length > 0)
    .map((candidate) => ({ roleId: candidate.roleId, candidateId: candidate.id }));
}

export default async function CandidateReportPage({
  params,
}: {
  readonly params: Promise<{ roleId: string; candidateId: string }>;
}) {
  const { roleId, candidateId } = await params;
  const role = getRole(roleId);
  const candidate = getCandidate(roleId, candidateId);

  if (!role || !candidate || !candidate.scorecard.length) {
    notFound();
  }

  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
      <header className="min-w-0 rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={candidate.reviewStatus} />
              {candidate.recommendation ? <StatusPill status={candidate.recommendation} /> : null}
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Candidate review report</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">{candidate.name}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              {role.title} - {candidate.source}. Review the scorecard, transcript evidence, authenticity signals, and artifacts before making a hiring decision.
            </p>
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:w-[520px] xl:max-w-[48%]">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Final score</div>
              <div className="mt-1 text-2xl font-semibold text-slate-950">
                {candidate.score}/{candidate.maxScore}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">AI/scripted risk</div>
              <div className="mt-1 text-2xl font-semibold text-slate-950">{candidate.aiRiskPercent}%</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Screen length</div>
              <div className="mt-1 text-sm font-semibold text-slate-950">{candidate.screenLengthMinutes ?? "-"} minutes</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Updated</div>
              <div className="mt-1 text-sm font-semibold text-slate-950">{formatDateTime(candidate.lastActivityAt)}</div>
            </div>
          </div>
        </div>
      </header>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="grid min-w-0 gap-5">
          <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Scorecard</div>
                <h2 className="mt-2 text-xl font-semibold text-slate-950">{role.rubricVersion} role bar</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  Dimension scores are tied to transcript evidence and reviewer-inspectable artifacts.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center sm:min-w-72">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-lg font-semibold text-slate-950">{candidate.score}/{candidate.maxScore}</div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Score</div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-lg font-semibold text-slate-950">{candidate.aiRiskPercent}%</div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">AI risk</div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-lg font-semibold text-slate-950">
                    {candidate.questionCoverage.filter((item) => item.status === "Asked").length}/{candidate.questionCoverage.length}
                  </div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Coverage</div>
                </div>
              </div>
            </div>

            <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="border-b border-slate-200 lg:border-b-0 lg:border-r">
                <TableScroller>
                  <table className="min-w-[760px] w-full border-separate border-spacing-0">
                    <thead>
                      <tr>
                        <th className={`${tableHeaderClass} px-3 py-2`}>Dimension</th>
                        <th className={`${tableHeaderClass} px-3 py-2`}>Score</th>
                        <th className={`${tableHeaderClass} px-3 py-2`}>Evidence note</th>
                        <th className={`${tableHeaderClass} px-3 py-2`}>Signal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidate.scorecard.map((row) => (
                        <tr key={row.dimension}>
                          <td className={`${tableCellClass} font-semibold text-slate-950`}>{row.dimension}</td>
                          <td className={tableCellClass}>
                            <ScoreBadge score={row.score} maxScore={row.maxScore} />
                          </td>
                          <td className={tableCellClass}>
                            <div className="font-medium text-slate-900">{row.note}</div>
                            <div className="mt-1 text-xs leading-5 text-slate-500">{row.evidence}</div>
                          </td>
                          <td className={tableCellClass}>
                            <StatusPill status={row.barSignal} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroller>
              </div>

              <div className="bg-slate-950 px-4 py-4 text-white">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Recommendation</div>
                <div className="mt-3 text-4xl font-semibold">{candidate.recommendation}</div>
                <p className="mt-4 text-sm leading-6 text-slate-300">
                  {candidate.recommendation === "Advance"
                    ? "Strong enough rubric signal to move forward, with low authenticity risk and complete artifacts."
                    : candidate.recommendation === "Hold"
                      ? "Mixed rubric signal. Review transcript excerpts and integrity notes before deciding."
                      : "Signal does not clear the current role bar."}
                </p>
                <div className="mt-5 grid gap-3">
                  <div className="rounded-md bg-white/10 px-3 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Integrity flags</div>
                    <div className="mt-2 text-2xl font-semibold">{candidate.integrityFlags}</div>
                  </div>
                  <div className="rounded-md bg-white/10 px-3 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Reviewer</div>
                    <div className="mt-2 text-sm font-semibold">{candidate.reviewer}</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <SectionPanel title="Transcript excerpts" eyebrow="Evidence">
              {candidate.transcriptExcerpts.length ? (
                <div className="grid gap-3">
                  {candidate.transcriptExcerpts.map((excerpt) => (
                    <div key={`${excerpt.timestamp}-${excerpt.question}`} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-500">{excerpt.timestamp}</span>
                        <StatusPill status={excerpt.speaker} />
                      </div>
                      <div className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{excerpt.question}</div>
                      <p className="mt-2 text-sm leading-6 text-slate-700">&quot;{excerpt.quote}&quot;</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No transcript excerpts" detail="Transcript evidence appears here after the session finishes processing." />
              )}
            </SectionPanel>

            <SectionPanel title="Question coverage" eyebrow="Required prompts">
              <div className="grid gap-3">
                {candidate.questionCoverage.map((item) => (
                  <div key={item.question} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-medium text-slate-950">{item.question}</div>
                      <StatusPill status={item.status} />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.evidence}</p>
                  </div>
                ))}
              </div>
            </SectionPanel>

            <SectionPanel title="Authenticity signals" eyebrow="Integrity">
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
            </SectionPanel>

            <SectionPanel title="Recording and artifacts" eyebrow="Availability">
              <div className="grid gap-3">
                {candidate.artifacts.map((artifact) => (
                  <div key={artifact.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-medium text-slate-950">{artifact.label}</div>
                      <StatusPill status={artifact.status} />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{artifact.detail}</p>
                  </div>
                ))}
              </div>
            </SectionPanel>
          </div>
        </main>

        <aside className="grid min-w-0 gap-5 xl:content-start">
          <SectionPanel title="Reviewer controls" eyebrow="Decision">
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={primaryButtonClass}>
                  Advance
                </button>
                <button type="button" className={secondaryButtonClass}>
                  Pass
                </button>
              </div>
              <button type="button" className={secondaryButtonClass}>
                Mark reviewed
              </button>
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                Reviewer note
                <textarea
                  rows={5}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                  placeholder="Add calibration note..."
                />
              </label>
              <button type="button" className={secondaryButtonClass}>
                Add note
              </button>
            </div>
          </SectionPanel>

          <SectionPanel title="Candidate context" eyebrow="Review state">
            <div className="grid gap-3 text-sm">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Role</div>
                <Link href={`/dashboard/roles/${role.id}`} className="mt-1 block font-semibold text-cyan-700 hover:text-cyan-900">
                  {role.title}
                </Link>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Invite</div>
                <div className="mt-1 flex items-center gap-2">
                  <StatusPill status={candidate.inviteStatus} />
                  <span className="text-slate-600">{candidate.joinCount} joins</span>
                </div>
              </div>
              {candidate.sessionId ? (
                <Link href={`/dashboard/interviews/${candidate.sessionId}`} className={primaryButtonClass}>
                  Open interview session
                </Link>
              ) : null}
            </div>
          </SectionPanel>
        </aside>
      </div>
    </div>
  );
}
