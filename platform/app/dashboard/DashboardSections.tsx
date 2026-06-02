import Link from "next/link";
import {
  demoActivity,
  demoCandidates,
  demoRoles,
  getDashboardStats,
  getReviewQueue,
  getRole,
  type DemoCandidate,
} from "./demo-data";
import {
  EmptyState,
  MetricCard,
  ScoreBadge,
  SectionPanel,
  StatusPill,
  TableScroller,
  formatDateTime,
  primaryButtonClass,
  secondaryButtonClass,
  tableCellClass,
  tableHeaderClass,
} from "./dashboard-ui";

const healthItems = [
  {
    label: "Recording pipeline",
    value: "1 finalizing",
    status: "Recording finalizing",
    detail: "All completed rooms have egress jobs attached.",
  },
  {
    label: "Transcript jobs",
    value: "6 ready",
    status: "Available",
    detail: "One transcript waits on recording finalization.",
  },
  {
    label: "Consent capture",
    value: "100%",
    status: "Accepted",
    detail: "Every joined candidate accepted disclosure before recording.",
  },
  {
    label: "Review SLA",
    value: "3 packets",
    status: "In review",
    detail: "Three packets are waiting for a hiring-manager decision.",
  },
];

export function WorkspaceMetricStrip() {
  const stats = getDashboardStats();

  return (
    <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Workspace metrics">
      <MetricCard label="Active roles" value={String(stats.activeRoles)} detail="Roles accepting candidate screens" />
      <MetricCard label="Candidates screened" value={String(stats.screenedCandidates)} detail="Completed or finalizing sessions" />
      <MetricCard label="Review-ready sessions" value={String(stats.reviewReadySessions)} detail="Packets with scorecards attached" />
      <MetricCard label="Avg screen length" value={`${stats.avgScreenLength}m`} detail="Across completed pilot screens" />
      <MetricCard label="Integrity items" value={String(stats.flaggedIntegrityItems)} detail="Flags needing reviewer inspection" />
    </section>
  );
}

export function NeedsReviewQueue({
  candidates = getReviewQueue(),
  limit,
  actionHref = "/dashboard/review-queue",
  actionLabel = "View queue",
}: {
  readonly candidates?: readonly DemoCandidate[];
  readonly limit?: number;
  readonly actionHref?: string;
  readonly actionLabel?: string;
}) {
  const visibleCandidates = typeof limit === "number" ? candidates.slice(0, limit) : candidates;

  return (
    <SectionPanel
      title="Needs review"
      eyebrow="Decision queue"
      action={
        <Link href={actionHref} className={secondaryButtonClass}>
          {actionLabel}
        </Link>
      }
    >
      {visibleCandidates.length ? (
        <TableScroller>
          <table className="min-w-[760px] w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={`${tableHeaderClass} rounded-l-md px-3 py-2`}>Candidate</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Role</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Score</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Recommendation</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>AI risk</th>
                <th className={`${tableHeaderClass} rounded-r-md px-3 py-2`}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {visibleCandidates.map((candidate) => {
                const role = getRole(candidate.roleId);
                return (
                  <tr key={candidate.id}>
                    <td className={`${tableCellClass} font-medium text-slate-950`}>
                      <Link href={`/dashboard/roles/${candidate.roleId}/candidates/${candidate.id}`} className="hover:text-cyan-700">
                        {candidate.name}
                      </Link>
                      <div className="mt-0.5 text-xs font-normal text-slate-500">{candidate.source}</div>
                    </td>
                    <td className={tableCellClass}>{role?.title ?? "Unknown role"}</td>
                    <td className={tableCellClass}>
                      <ScoreBadge score={candidate.score} maxScore={candidate.maxScore} />
                    </td>
                    <td className={tableCellClass}>{candidate.recommendation ? <StatusPill status={candidate.recommendation} /> : "Pending"}</td>
                    <td className={tableCellClass}>
                      <div className="font-medium text-slate-900">{candidate.aiRisk}</div>
                      <div className="text-xs text-slate-500">{candidate.aiRiskPercent}% risk score</div>
                    </td>
                    <td className={tableCellClass}>{formatDateTime(candidate.lastActivityAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroller>
      ) : (
        <EmptyState title="No candidates need review" detail="Completed screens will appear here after transcript, scorecard, and artifact processing finish." />
      )}
    </SectionPanel>
  );
}

export function ActiveRolesTable() {
  return (
    <SectionPanel
      title="Active roles"
      eyebrow="Hiring bars"
      action={
        <Link href={`/dashboard/roles/${demoRoles[0]?.id ?? ""}`} className={primaryButtonClass}>
          Open primary role
        </Link>
      }
    >
      <TableScroller>
        <table className="min-w-[860px] w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className={`${tableHeaderClass} rounded-l-md px-3 py-2`}>Role</th>
              <th className={`${tableHeaderClass} px-3 py-2`}>Owner</th>
              <th className={`${tableHeaderClass} px-3 py-2`}>Status</th>
              <th className={`${tableHeaderClass} px-3 py-2`}>Pipeline</th>
              <th className={`${tableHeaderClass} px-3 py-2`}>Review ready</th>
              <th className={`${tableHeaderClass} rounded-r-md px-3 py-2`}>Rubric</th>
            </tr>
          </thead>
          <tbody>
            {demoRoles.map((role) => (
              <tr key={role.id}>
                <td className={`${tableCellClass} font-medium text-slate-950`}>
                  <Link href={`/dashboard/roles/${role.id}`} className="hover:text-cyan-700">
                    {role.title}
                  </Link>
                  <div className="mt-0.5 text-xs font-normal text-slate-500">
                    {role.level} - {role.location}
                  </div>
                </td>
                <td className={tableCellClass}>{role.owner}</td>
                <td className={tableCellClass}>
                  <StatusPill status={role.status} />
                </td>
                <td className={tableCellClass}>
                  <div className="font-medium text-slate-900">{role.screenedCount} screened</div>
                  <div className="text-xs text-slate-500">
                    {role.sourcedCount} sourced / {role.advancedCount} advanced / {role.passedCount} passed
                  </div>
                </td>
                <td className={tableCellClass}>{role.reviewReadyCount}</td>
                <td className={tableCellClass}>
                  <Link href={`/dashboard/roles/${role.id}/rubric`} className="font-medium text-cyan-700 hover:text-cyan-900">
                    {role.rubricVersion}
                  </Link>
                  <div className="mt-0.5 text-xs text-slate-500">Used by {role.usedByInterviews} interviews</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
    </SectionPanel>
  );
}

export function CandidateSnapshot({ limit }: { readonly limit?: number }) {
  const visibleCandidates = typeof limit === "number" ? demoCandidates.slice(0, limit) : demoCandidates;

  return (
    <SectionPanel title="Candidate snapshot" eyebrow="Pipeline">
      <TableScroller>
        <table className="min-w-[820px] w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className={`${tableHeaderClass} rounded-l-md px-3 py-2`}>Candidate</th>
              <th className={`${tableHeaderClass} px-3 py-2`}>Role</th>
              <th className={`${tableHeaderClass} px-3 py-2`}>Status</th>
              <th className={`${tableHeaderClass} px-3 py-2`}>Invite</th>
              <th className={`${tableHeaderClass} px-3 py-2`}>Reviewer</th>
              <th className={`${tableHeaderClass} rounded-r-md px-3 py-2`}>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleCandidates.map((candidate) => {
              const role = getRole(candidate.roleId);
              const href = candidate.scorecard.length
                ? `/dashboard/roles/${candidate.roleId}/candidates/${candidate.id}`
                : candidate.sessionId
                  ? `/dashboard/interviews/${candidate.sessionId}`
                  : `/dashboard/roles/${candidate.roleId}`;

              return (
                <tr key={candidate.id}>
                  <td className={`${tableCellClass} font-medium text-slate-950`}>
                    {candidate.name}
                    <div className="mt-0.5 text-xs font-normal text-slate-500">{candidate.email}</div>
                  </td>
                  <td className={tableCellClass}>{role?.title ?? "Unknown role"}</td>
                  <td className={tableCellClass}>
                    <StatusPill status={candidate.pipelineStatus} />
                  </td>
                  <td className={tableCellClass}>
                    <StatusPill status={candidate.inviteStatus} />
                    <div className="mt-1 text-xs text-slate-500">{candidate.joinCount} joins</div>
                  </td>
                  <td className={tableCellClass}>{candidate.reviewer}</td>
                  <td className={tableCellClass}>
                    <Link href={href} className="font-medium text-cyan-700 hover:text-cyan-900">
                      Open
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroller>
    </SectionPanel>
  );
}

export function RecentActivity({ limit }: { readonly limit?: number }) {
  const visibleActivity = typeof limit === "number" ? demoActivity.slice(0, limit) : demoActivity;

  return (
    <SectionPanel title="Recent interview activity" eyebrow="Audit log">
      <div className="grid gap-3">
        {visibleActivity.map((activity) => {
          const role = getRole(activity.roleId);
          const href = activity.sessionId
            ? `/dashboard/interviews/${activity.sessionId}`
            : activity.candidateId
              ? `/dashboard/roles/${activity.roleId}/candidates/${activity.candidateId}`
              : `/dashboard/roles/${activity.roleId}`;

          return (
            <Link
              key={activity.id}
              href={href}
              className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 transition hover:border-cyan-200 hover:bg-cyan-50/40 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium text-slate-950">{activity.title}</div>
                  <StatusPill status={activity.severity === "warning" ? "In review" : "Available"} />
                </div>
                <div className="mt-1 text-sm leading-6 text-slate-600">{activity.detail}</div>
                <div className="mt-1 text-xs text-slate-500">{role?.title ?? "Unknown role"}</div>
              </div>
              <div className="text-xs font-medium text-slate-500 sm:text-right">{formatDateTime(activity.happenedAt)}</div>
            </Link>
          );
        })}
      </div>
    </SectionPanel>
  );
}

export function OperationalHealthPanel() {
  return (
    <SectionPanel title="Operational health" eyebrow="Artifacts">
      <div className="grid gap-3">
        {healthItems.map((item) => (
          <div key={item.label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-950">{item.label}</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{item.detail}</div>
              </div>
              <StatusPill status={item.status} />
            </div>
            <div className="mt-2 text-xl font-semibold text-slate-950">{item.value}</div>
          </div>
        ))}
      </div>
    </SectionPanel>
  );
}

export function ReadinessPanel() {
  return (
    <SectionPanel title="Empty-state coverage" eyebrow="Readiness">
      <EmptyState
        title="No blocked review packets"
        detail="When a candidate has missing consent, transcript, or recording artifacts, the blocked packet state appears here before it reaches reviewers."
      />
    </SectionPanel>
  );
}
