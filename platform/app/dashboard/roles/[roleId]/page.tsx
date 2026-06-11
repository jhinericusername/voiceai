import Link from "next/link";
import { notFound } from "next/navigation";
import {
  companyIdentityFromUser,
  getAshbyCompanyState,
} from "@/lib/ashby/server";
import { DashboardActionButton } from "../../DashboardActionButton";
import { requireDashboardUser } from "../../auth";
import { RoleWorkspaceTabs } from "./RoleWorkspaceTabs";
import {
  demoRoles,
  getActivityForRole,
  getCandidatesForRole,
  getRole,
  getSessionsForRole,
} from "../../demo-data";
import {
  ScoreBadge,
  SectionPanel,
  StatusPill,
  formatDate,
  formatDateTime,
  secondaryButtonClass,
} from "../../dashboard-ui";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return demoRoles.map((role) => ({ roleId: role.id }));
}

export default async function RoleDetailPage({ params }: { readonly params: Promise<{ roleId: string }> }) {
  const { roleId } = await params;
  const { user, organizationId } = await requireDashboardUser(`/dashboard/roles/${roleId}`);
  const role = getRole(roleId);

  if (!role) {
    notFound();
  }

  const candidates = getCandidatesForRole(role.id);
  const sessions = getSessionsForRole(role.id);
  const activity = getActivityForRole(role.id);
  const identity = companyIdentityFromUser({ email: user.email, organizationId });
  const state = await getAshbyCompanyState(identity).catch(() => null);
  const onboardingComplete = state?.setupStatus === "connected" && state.connected && Boolean(state.lastSyncAt);
  const ashbyJobIds = onboardingComplete && state ? state.selectedJobIds : [];
  const reviewReady = candidates.filter((candidate) => candidate.pipelineStatus === "Review ready");
  const highlighted = candidates
    .filter((candidate) => candidate.score !== null)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, 3);

  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
      <header className="min-w-0 rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={role.status} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Role workspace</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">{role.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{role.hiringBar}</p>
          </div>
          <div className="grid min-w-0 gap-2 text-sm sm:grid-cols-2 xl:w-[520px] xl:max-w-[48%]">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Hiring bar</div>
              <div className="mt-1 font-semibold text-slate-950">{role.targetHires} target hires</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Rubric</div>
              <div className="mt-1 font-semibold text-slate-950">
                {role.rubricVersion} - used by {role.usedByInterviews}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Candidates</div>
              <div className="mt-1 font-semibold text-slate-950">
                {role.sourcedCount} sourced / {role.screenedCount} screened
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Review ready</div>
              <div className="mt-1 font-semibold text-slate-950">{reviewReady.length} packets</div>
            </div>
          </div>
        </div>
      </header>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <RoleWorkspaceTabs role={role} ashbyJobIds={ashbyJobIds} candidates={candidates} sessions={sessions} />
        </div>

        <aside className="grid min-w-0 gap-5 xl:content-start">
          <SectionPanel
            title="Rubric summary"
            eyebrow="Applied bar"
            action={
              <Link href={`/dashboard/roles/${role.id}/rubric`} className={secondaryButtonClass}>
                Full rubric
              </Link>
            }
          >
            <div className="grid gap-3">
              {role.dimensions.map((dimension) => (
                <div key={dimension.name} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-950">{dimension.name}</div>
                    <div className="text-xs font-semibold text-cyan-800">{dimension.weight} pts</div>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{dimension.atBar}</p>
                </div>
              ))}
            </div>
          </SectionPanel>

          <SectionPanel title="Next actions" eyebrow="Reviewer work">
            <div className="grid gap-2">
              {reviewReady.slice(0, 3).map((candidate) => (
                <Link
                  key={candidate.id}
                  href={`/dashboard/roles/${role.id}/candidates/${candidate.id}`}
                  className="rounded-md border border-slate-200 bg-white px-3 py-3 transition hover:border-cyan-200 hover:bg-cyan-50/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-950">{candidate.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{candidate.reviewer}</div>
                    </div>
                    <ScoreBadge score={candidate.score} maxScore={candidate.maxScore} />
                  </div>
                </Link>
              ))}
              {!reviewReady.length ? (
                <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                  No packets are currently waiting for review.
                </div>
              ) : null}
              <DashboardActionButton action="interview">
                Create interview
              </DashboardActionButton>
            </div>
          </SectionPanel>

          <SectionPanel title="Scorecard highlights" eyebrow="Recent signal">
            <div className="grid gap-3">
              {highlighted.map((candidate) => (
                <div key={candidate.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-950">{candidate.name}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {candidate.recommendation ?? "Pending"} / AI risk {candidate.aiRisk}
                      </div>
                    </div>
                    <ScoreBadge score={candidate.score} maxScore={candidate.maxScore} />
                  </div>
                </div>
              ))}
            </div>
          </SectionPanel>

          <SectionPanel title="Role activity" eyebrow="Timeline">
            <div className="grid gap-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Opened</div>
                <div className="mt-1 text-sm font-medium text-slate-950">{formatDate(role.openedAt)}</div>
              </div>
              {activity.slice(0, 3).map((item) => (
                <Link
                  key={item.id}
                  href={item.sessionId ? `/dashboard/interviews/${item.sessionId}` : `/dashboard/roles/${role.id}`}
                  className="rounded-md border border-slate-200 bg-white px-3 py-3 transition hover:border-cyan-200 hover:bg-cyan-50/40"
                >
                  <div className="text-sm font-medium text-slate-950">{item.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{formatDateTime(item.happenedAt)}</div>
                </Link>
              ))}
            </div>
          </SectionPanel>
        </aside>
      </div>
    </div>
  );
}
