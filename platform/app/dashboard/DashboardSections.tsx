import Link from "next/link";
import type { RecentScreen } from "@/lib/ashby/server";
import type { RealInterviewListItem } from "./backend-data";
import {
  demoActivity,
  demoCandidates,
  demoRoles,
  getActiveInterviewSessions,
  getCandidateById,
  getDashboardStats,
  getReviewPackets,
  getRole,
  type ReviewPacket,
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
    label: "Review packet pipeline",
    value: "1 finalizing",
    status: "Recording finalizing",
    detail: "One completed room is copying media before transcript scoring.",
  },
  {
    label: "Transcript evidence",
    value: "6 ready",
    status: "Available",
    detail: "Ready packets include speaker turns and evidence markers.",
  },
  {
    label: "Human decision gate",
    value: "100%",
    status: "Accepted",
    detail: "No recommendation advances without reviewer sign-off.",
  },
  {
    label: "Review SLA",
    value: "3 packets",
    status: "In review",
    detail: "Open packets need an owner, calibration note, or final decision.",
  },
];

function formatBackendStatus(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }

  const normalized = trimmed.replace(/[_-]+/g, " ").toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
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

function realPacketRecommendation(interview: RealInterviewListItem): string {
  if (interview.meets_bare_minimum === true) {
    return "Meets bar";
  }
  if (interview.meets_bare_minimum === false) {
    return "Below bar";
  }
  return "Pending";
}

function isReviewReadyInterview(interview: RealInterviewListItem): boolean {
  return interview.status === "review_ready" && !interview.signed_off_at;
}

export function WorkspaceMetricStrip() {
  const stats = getDashboardStats();

  return (
    <section className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5" aria-label="Workspace metrics">
      <MetricCard label="Needs review" value={String(stats.reviewReadySessions)} detail="Open packets with scorecards attached" />
      <MetricCard label="Unassigned" value={String(stats.unassignedReviews)} detail="Packets waiting for a human owner" />
      <MetricCard label="Oldest review" value={`${stats.oldestReviewHours}h`} detail="Time since the oldest packet updated" />
      <MetricCard label="Completed today" value={String(stats.completedToday)} detail="Interviews ended in the demo workspace" />
      <MetricCard label="Integrity items" value={String(stats.flaggedIntegrityItems)} detail="Flags needing reviewer inspection" />
    </section>
  );
}

export function NeedsReviewQueue({
  realInterviews,
  packets = getReviewPackets(),
  limit,
  actionHref = "/dashboard/review-queue",
  actionLabel = "View queue",
}: {
  readonly realInterviews?: readonly RealInterviewListItem[];
  readonly packets?: readonly ReviewPacket[];
  readonly limit?: number;
  readonly actionHref?: string;
  readonly actionLabel?: string;
}) {
  if (realInterviews) {
    const reviewReadyInterviews = realInterviews.filter(isReviewReadyInterview);
    const visibleInterviews =
      typeof limit === "number" ? reviewReadyInterviews.slice(0, limit) : reviewReadyInterviews;

    return (
      <SectionPanel
        title="Interview packets needing review"
        eyebrow="Human review queue"
        action={
          <Link href={actionHref} className={secondaryButtonClass}>
            {actionLabel}
          </Link>
        }
      >
        {visibleInterviews.length ? (
          <TableScroller>
            <table className="min-w-[760px] w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className={`${tableHeaderClass} rounded-l-md px-3 py-2`}>Candidate</th>
                  <th className={`${tableHeaderClass} px-3 py-2`}>Status</th>
                  <th className={`${tableHeaderClass} px-3 py-2`}>Recording</th>
                  <th className={`${tableHeaderClass} px-3 py-2`}>Score / recommendation</th>
                  <th className={`${tableHeaderClass} px-3 py-2`}>Reviewer</th>
                  <th className={`${tableHeaderClass} rounded-r-md px-3 py-2`}>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleInterviews.map((interview) => {
                  const packetTime = interview.started_at ?? interview.scheduled_at ?? interview.ended_at;
                  const recommendation = realPacketRecommendation(interview);

                  return (
                    <tr key={interview.session_id}>
                      <td className={`${tableCellClass} font-medium text-slate-950`}>
                        <Link href={`/dashboard/interviews/${interview.session_id}`} className="break-all hover:text-cyan-700">
                          {interview.candidate_email}
                        </Link>
                        <div className="mt-0.5 text-xs font-normal text-slate-500">
                          {interview.room_name ?? "No room"} {packetTime ? `- ${formatDateTime(packetTime)}` : ""}
                        </div>
                      </td>
                      <td className={tableCellClass}>
                        <StatusPill status={formatBackendStatus(interview.status, "Unknown")} />
                      </td>
                      <td className={tableCellClass}>
                        <StatusPill status={formatBackendStatus(interview.recording_status, "Pending")} />
                        <div className="mt-1 text-xs text-slate-500">{interview.egress_id ? "Egress attached" : "No egress"}</div>
                      </td>
                      <td className={tableCellClass}>
                        <div className="font-medium text-slate-900">{formatCategoryScoreSummary(interview.category_scores)}</div>
                        <div className="mt-1">
                          <StatusPill status={recommendation} />
                        </div>
                      </td>
                      <td className={tableCellClass}>
                        <div className="break-all">{interview.reviewer_email ?? "Unassigned"}</div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {interview.signed_off_at ? `Signed ${formatDateTime(interview.signed_off_at)}` : "Awaiting sign-off"}
                        </div>
                      </td>
                      <td className={tableCellClass}>
                        <Link href={`/dashboard/interviews/${interview.session_id}`} className="font-medium text-cyan-700 hover:text-cyan-900">
                          Open review
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroller>
        ) : (
          <EmptyState title="No real interviews need review" detail="Backend interview packets will appear here after sessions are created and processed." />
        )}
      </SectionPanel>
    );
  }

  const visiblePackets = typeof limit === "number" ? packets.slice(0, limit) : packets;

  return (
    <SectionPanel
      title="Interview packets needing review"
      eyebrow="Human review queue"
      action={
        <Link href={actionHref} className={secondaryButtonClass}>
          {actionLabel}
        </Link>
      }
    >
      {visiblePackets.length ? (
        <TableScroller>
          <table className="min-w-[860px] w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={`${tableHeaderClass} rounded-l-md px-3 py-2`}>Candidate</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Role</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Score</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Recommendation</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Artifacts</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Integrity</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Reviewer</th>
                <th className={`${tableHeaderClass} rounded-r-md px-3 py-2`}>Action</th>
              </tr>
            </thead>
            <tbody>
              {visiblePackets.map((packet) => {
                const { candidate, role, session } = packet;
                return (
                  <tr key={session.id}>
                    <td className={`${tableCellClass} font-medium text-slate-950`}>
                      <Link href={`/dashboard/interviews/${session.id}`} className="hover:text-cyan-700">
                        {candidate.name}
                      </Link>
                      <div className="mt-0.5 text-xs font-normal text-slate-500">
                        {session.durationMinutes}m interview - updated {packet.packetAgeHours}h ago
                      </div>
                    </td>
                    <td className={tableCellClass}>
                      <Link href={`/dashboard/roles/${role.id}`} className="font-medium text-cyan-700 hover:text-cyan-900">
                        {role.title}
                      </Link>
                      <div className="mt-0.5 text-xs text-slate-500">{role.owner}</div>
                    </td>
                    <td className={tableCellClass}>
                      <ScoreBadge score={candidate.score} maxScore={candidate.maxScore} />
                    </td>
                    <td className={tableCellClass}>{candidate.recommendation ? <StatusPill status={candidate.recommendation} /> : "Pending"}</td>
                    <td className={tableCellClass}>
                      <div className="font-medium text-slate-900">{packet.artifactReadiness}</div>
                      <div className="text-xs text-slate-500">Video {session.media.videoStatus.toLowerCase()} / transcript {session.media.transcriptStatus.toLowerCase()}</div>
                    </td>
                    <td className={tableCellClass}>
                      <div className="font-medium text-slate-900">{candidate.aiRisk}</div>
                      <div className="text-xs text-slate-500">{candidate.integrityFlags} flags / {candidate.aiRiskPercent}% risk</div>
                    </td>
                    <td className={tableCellClass}>{candidate.reviewer}</td>
                    <td className={tableCellClass}>
                      <Link href={`/dashboard/interviews/${session.id}`} className="font-medium text-cyan-700 hover:text-cyan-900">
                        Open review
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroller>
      ) : (
        <EmptyState title="No interviews need review" detail="Completed screens will appear here after transcript, scorecard, and artifact processing finish." />
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

export function ActiveInterviewPanel() {
  const activeSessions = getActiveInterviewSessions();

  return (
    <SectionPanel title="Live and finalizing" eyebrow="Interview operations">
      {activeSessions.length ? (
        <div className="grid gap-3">
          {activeSessions.map((session) => {
            const candidate = getCandidateById(session.candidateId);
            const role = getRole(session.roleId);

            return (
              <Link
                key={session.id}
                href={`/dashboard/interviews/${session.id}`}
                className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 transition hover:border-cyan-200 hover:bg-cyan-50/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-950">{candidate?.name ?? "Unknown candidate"}</div>
                    <div className="mt-1 truncate text-xs text-slate-500">{role?.title ?? "Unknown role"}</div>
                  </div>
                  <StatusPill status={session.lifecycleStatus} />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="font-semibold text-slate-950">{session.media.videoStatus}</div>
                    <div className="mt-0.5 text-slate-500">Video</div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-950">{session.media.audioStatus}</div>
                    <div className="mt-0.5 text-slate-500">Audio</div>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-950">{session.media.transcriptStatus}</div>
                    <div className="mt-0.5 text-slate-500">Transcript</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No active interviews" detail="Live and finalizing sessions appear here before they become review packets." />
      )}
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

export function RecentScreensTable({ screens }: { readonly screens: readonly RecentScreen[] }) {
  return (
    <SectionPanel title="Recent screens" eyebrow="Screens">
      {screens.length ? (
        <TableScroller>
          <table className="min-w-[900px] w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={`${tableHeaderClass} rounded-l-md px-3 py-2`}>Candidate</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Role</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Stage</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Score</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Reviewer</th>
                <th className={`${tableHeaderClass} rounded-r-md px-3 py-2`}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {screens.map((screen) => (
                <tr key={screen.score_id}>
                  <td className={`${tableCellClass} font-medium text-slate-950`}>
                    {screen.candidate_name}
                    <div className="mt-0.5 text-xs font-normal text-slate-500">
                      {screen.candidate_email ?? "No email"}
                    </div>
                  </td>
                  <td className={tableCellClass}>{screen.role_id}</td>
                  <td className={tableCellClass}>{screen.current_stage ?? screen.status}</td>
                  <td className={tableCellClass}>
                    <ScoreBadge score={Number(screen.total_score)} maxScore={16} />
                  </td>
                  <td className={tableCellClass}>{screen.reviewer_email}</td>
                  <td className={tableCellClass}>{formatDateTime(screen.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      ) : (
        <EmptyState title="No screens yet" detail="Saved scorecards for active Ashby candidates will appear here." />
      )}
    </SectionPanel>
  );
}
