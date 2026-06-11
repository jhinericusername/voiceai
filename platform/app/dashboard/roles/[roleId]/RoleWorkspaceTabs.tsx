"use client";

import { useState } from "react";
import Link from "next/link";
import type { DemoCandidate, DemoRole, DemoSession } from "../../demo-data";
import { pipelineStatusOrder } from "../../demo-data";
import {
  EmptyState,
  ScoreBadge,
  StatusPill,
  TableScroller,
  cx,
  formatDateTime,
  primaryButtonClass,
  secondaryButtonClass,
  tableCellClass,
  tableHeaderClass,
} from "../../dashboard-ui";
import { ScoreTab } from "./ScoreTab";

type RoleTab = "Pipeline" | "Score" | "Rubric" | "Interviews" | "Reports";

const tabs: readonly RoleTab[] = ["Pipeline", "Score", "Rubric", "Interviews", "Reports"];

export function RoleWorkspaceTabs({
  role,
  ashbyJobIds,
  candidates,
  sessions,
}: {
  readonly role: DemoRole;
  readonly ashbyJobIds: readonly string[];
  readonly candidates: readonly DemoCandidate[];
  readonly sessions: readonly DemoSession[];
}) {
  const [activeTab, setActiveTab] = useState<RoleTab>("Pipeline");

  return (
    <section className="rounded-md border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-200 px-4 pt-3">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Role workspace tabs">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={cx(
                "min-h-10 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition",
                activeTab === tab
                  ? "border-cyan-600 text-slate-950"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900",
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {activeTab === "Pipeline" ? <PipelineTab role={role} candidates={candidates} /> : null}
        {activeTab === "Score" ? <ScoreTab availableJobIds={ashbyJobIds} /> : null}
        {activeTab === "Rubric" ? <RubricTab role={role} /> : null}
        {activeTab === "Interviews" ? <InterviewsTab role={role} sessions={sessions} candidates={candidates} /> : null}
        {activeTab === "Reports" ? <ReportsTab role={role} candidates={candidates} /> : null}
      </div>
    </section>
  );
}

function PipelineTab({
  role,
  candidates,
}: {
  readonly role: DemoRole;
  readonly candidates: readonly DemoCandidate[];
}) {
  const grouped = pipelineStatusOrder.map((status) => ({
    status,
    candidates: candidates.filter((candidate) => candidate.pipelineStatus === status),
  }));

  return (
    <div className="grid gap-4">
      {grouped.map((group) => (
        <section key={group.status} className="rounded-md border border-slate-200">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2">
              <StatusPill status={group.status} />
              <div className="text-sm font-semibold text-slate-900">{group.candidates.length} candidates</div>
            </div>
          </div>

          {group.candidates.length ? (
            <TableScroller>
              <table className="min-w-[760px] w-full border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className={`${tableHeaderClass} px-3 py-2`}>Candidate</th>
                    <th className={`${tableHeaderClass} px-3 py-2`}>Source</th>
                    <th className={`${tableHeaderClass} px-3 py-2`}>Score</th>
                    <th className={`${tableHeaderClass} px-3 py-2`}>Review</th>
                    <th className={`${tableHeaderClass} px-3 py-2`}>Session</th>
                  </tr>
                </thead>
                <tbody>
                  {group.candidates.map((candidate) => (
                    <tr key={candidate.id}>
                      <td className={`${tableCellClass} font-medium text-slate-950`}>
                        {candidate.scorecard.length ? (
                          <Link href={`/dashboard/roles/${role.id}/candidates/${candidate.id}`} className="hover:text-cyan-700">
                            {candidate.name}
                          </Link>
                        ) : (
                          candidate.name
                        )}
                        <div className="mt-0.5 text-xs font-normal text-slate-500">{candidate.email}</div>
                      </td>
                      <td className={tableCellClass}>{candidate.source}</td>
                      <td className={tableCellClass}>
                        <ScoreBadge score={candidate.score} maxScore={candidate.maxScore} />
                      </td>
                      <td className={tableCellClass}>
                        <StatusPill status={candidate.reviewStatus} />
                      </td>
                      <td className={tableCellClass}>
                        {candidate.sessionId ? (
                          <Link href={`/dashboard/interviews/${candidate.sessionId}`} className="font-medium text-cyan-700 hover:text-cyan-900">
                            Open session
                          </Link>
                        ) : (
                          <span className="text-slate-400">No session</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroller>
          ) : (
            <div className="p-3">
              <EmptyState
                title={`No ${group.status.toLowerCase()} candidates`}
                detail="This status group stays visible so reviewers can see gaps in the role pipeline."
              />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function RubricTab({ role }: { readonly role: DemoRole }) {
  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-950">{role.rubricVersion} hiring bar</div>
          <p className="mt-1 text-sm leading-6 text-slate-600">{role.hiringBar}</p>
        </div>
        <Link href={`/dashboard/roles/${role.id}/rubric`} className={primaryButtonClass}>
          Open rubric
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {role.dimensions.map((dimension) => (
          <div key={dimension.name} className="rounded-md border border-slate-200 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold text-slate-950">{dimension.name}</div>
              <span className="rounded-md bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-800">
                {dimension.weight} pts
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">{dimension.atBar}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function InterviewsTab({
  role,
  sessions,
  candidates,
}: {
  readonly role: DemoRole;
  readonly sessions: readonly DemoSession[];
  readonly candidates: readonly DemoCandidate[];
}) {
  if (!sessions.length) {
    return <EmptyState title="No interviews scheduled" detail="New interview sessions for this role will appear here after invites are created." />;
  }

  return (
    <TableScroller>
      <table className="min-w-[760px] w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className={`${tableHeaderClass} rounded-l-md px-3 py-2`}>Session</th>
            <th className={`${tableHeaderClass} px-3 py-2`}>Candidate</th>
            <th className={`${tableHeaderClass} px-3 py-2`}>Lifecycle</th>
            <th className={`${tableHeaderClass} px-3 py-2`}>Recording</th>
            <th className={`${tableHeaderClass} rounded-r-md px-3 py-2`}>Scheduled</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => {
            const candidate = candidates.find((item) => item.id === session.candidateId);
            return (
              <tr key={session.id}>
                <td className={`${tableCellClass} font-medium text-slate-950`}>
                  <Link href={`/dashboard/interviews/${session.id}`} className="hover:text-cyan-700">
                    {session.id}
                  </Link>
                  <div className="mt-0.5 text-xs font-normal text-slate-500">{role.rubricVersion}</div>
                </td>
                <td className={tableCellClass}>{candidate?.name ?? "Unknown candidate"}</td>
                <td className={tableCellClass}>
                  <StatusPill status={session.lifecycleStatus} />
                </td>
                <td className={tableCellClass}>
                  <StatusPill status={session.recordingState} />
                </td>
                <td className={tableCellClass}>{formatDateTime(session.scheduledAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroller>
  );
}

function ReportsTab({
  role,
  candidates,
}: {
  readonly role: DemoRole;
  readonly candidates: readonly DemoCandidate[];
}) {
  const reviewed = candidates.filter((candidate) => candidate.reviewStatus === "Reviewed");
  const advanceRecommended = candidates.filter((candidate) => candidate.recommendation === "Advance").length;
  const averageScore =
    candidates.reduce((total, candidate) => total + (candidate.score ?? 0), 0) /
    Math.max(candidates.filter((candidate) => candidate.score !== null).length, 1);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Reviewed</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">{reviewed.length}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Advance recs</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">{advanceRecommended}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Avg score</div>
          <div className="mt-2 text-2xl font-semibold text-slate-950">{averageScore.toFixed(1)}/16</div>
        </div>
      </div>
      <EmptyState
        title="No exported report pack yet"
        detail={`When ${role.title} has enough reviewed packets, comparative role reports and calibration exports will appear here.`}
      />
      <div>
        <Link href={`/dashboard/roles/${role.id}/rubric`} className={secondaryButtonClass}>
          Review scoring bar
        </Link>
      </div>
    </div>
  );
}
