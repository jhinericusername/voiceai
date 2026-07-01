import Link from "next/link";
import { companyIdentityFromUser, getAshbyJobs } from "@/lib/ashby/server";
import { requireDashboardUser } from "../auth";
import { getGradingCompanyState, type RoleGradingProfile } from "../backend-data";
import {
  EmptyState,
  MetricCard,
  SectionPanel,
  StatusPill,
} from "../dashboard-ui";

export const dynamic = "force-dynamic";

function profileForRole(
  profiles: readonly RoleGradingProfile[],
  role: { readonly id: string },
): RoleGradingProfile | null {
  return profiles.find((profile) => profile.ashby_job_id === role.id) ?? null;
}

function rubricStatus(profile: RoleGradingProfile | null): string {
  if (profile?.active_rubric_version_id) {
    return "Active Rubric";
  }
  if (profile?.draft_rubric_version_id) {
    return "Draft ready";
  }
  return "Needs Rubric";
}

function dimensionCount(profile: RoleGradingProfile | null): number {
  return profile?.draft_rubric?.dimensions.length ?? profile?.active_rubric?.dimensions.length ?? 0;
}

export default async function RubricsPage() {
  const session = await requireDashboardUser("/dashboard/rubrics");
  const companyIdentity = companyIdentityFromUser({
    email: session.user.email,
    organizationId: session.organizationId,
  });
  const jobs = await getAshbyJobs(companyIdentity, session.user.email ?? "");
  const gradingProfiles = await getGradingCompanyState({ orgId: session.organizationId });
  const configuredRubricCount = gradingProfiles.filter((profile) => profile.active_rubric_version_id).length;
  const draftRubricCount = gradingProfiles.filter((profile) => profile.draft_rubric_version_id).length;

  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
      <header className="puddle-dashboard-hero-card min-w-0 overflow-hidden rounded-md border border-cyan-200 bg-white/94 px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status="Rubrics" />
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Role scoring setup</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">Role rubrics</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Choose dimensions for each synced Ashby role. Approved rubrics are used by grading prompts for candidates in
            that role.
          </p>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard
          label="Open roles"
          value={String(jobs.length)}
          detail="Open Ashby roles available for rubric setup."
        />
        <MetricCard
          label="Active rubrics"
          value={String(configuredRubricCount)}
          detail="Roles with an approved grading rubric."
        />
        <MetricCard
          label="Draft rubrics"
          value={String(draftRubricCount)}
          detail="Roles with saved rubric edits pending approval."
        />
      </div>

      <SectionPanel title="Choose dimensions by role" eyebrow="Rubric library">
        {jobs.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {jobs.map((role) => {
              const profile = profileForRole(gradingProfiles, role);
              const selectedDimensionCount = dimensionCount(profile);
              return (
                <Link
                  key={role.id}
                  href={`/dashboard/rubrics/${encodeURIComponent(role.id)}`}
                  className="puddle-interactive-card min-w-0 rounded-md border border-slate-200 bg-white px-4 py-4 transition hover:-translate-y-px hover:border-cyan-200 hover:bg-cyan-50/40 hover:shadow-[0_12px_28px_rgba(8,145,178,0.08)] focus:outline-none focus:ring-4 focus:ring-cyan-100"
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-950">{role.name}</div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">
                        {role.status ?? "Open"} Ashby role
                      </div>
                    </div>
                    <StatusPill status={rubricStatus(profile)} className="shrink-0" />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <StatusPill
                      status={selectedDimensionCount > 0 ? `${selectedDimensionCount} dimensions` : "Choose dimensions"}
                      className="min-h-5 py-0 text-[11px]"
                    />
                    <span>Role rubric</span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No open Ashby roles yet"
            detail="Create or reopen roles in Ashby before creating role-specific rubrics."
          />
        )}
      </SectionPanel>
    </div>
  );
}
