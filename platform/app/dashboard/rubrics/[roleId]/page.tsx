import Link from "next/link";
import { notFound } from "next/navigation";
import { companyIdentityFromUser, getAshbyJobs } from "@/lib/ashby/server";
import { RoleRubricEditor } from "../../roles/[roleId]/RoleRubricEditor";
import { requireDashboardUser } from "../../auth";
import { getGradingCompanyState } from "../../backend-data";
import {
  StatusPill,
  secondaryButtonClass,
} from "../../dashboard-ui";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return [];
}

export default async function PlatformRoleRubricPage({ params }: { readonly params: Promise<{ roleId: string }> }) {
  const { roleId } = await params;
  const { user, organizationId } = await requireDashboardUser(`/dashboard/rubrics/${roleId}`);
  const companyIdentity = companyIdentityFromUser({ email: user.email, organizationId });
  const jobs = await getAshbyJobs(companyIdentity, user.email ?? "");
  const gradingProfiles = await getGradingCompanyState({ orgId: organizationId });
  const selectedJob = jobs.find((job) => job.id === roleId.trim());

  if (!selectedJob) {
    notFound();
  }
  const selectedRole = {
    jobId: selectedJob.id,
    name: selectedJob.name,
  };
  const selectedGradingProfile =
    gradingProfiles.find((profile) => profile.ashby_job_id === selectedRole.jobId) ?? null;
  const rubricEditorKey = [
    selectedRole.jobId,
    selectedGradingProfile?.profile_id ?? "missing-profile",
    selectedGradingProfile?.draft_rubric_version_id ?? "no-draft",
    selectedGradingProfile?.active_rubric_version_id ?? "no-active",
  ].join(":");

  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
      <header className="rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status="Rubric" />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">{selectedRole.name}</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">Role rubric</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Choose the dimensions that should be graded for this role. Approved rubrics are injected into the grading
              prompt for candidates tied to this Ashby role.
            </p>
          </div>
          <Link href="/dashboard/rubrics" className={secondaryButtonClass}>
            All rubrics
          </Link>
        </div>
      </header>

      <section className="puddle-panel overflow-hidden rounded-md border border-slate-200 bg-white/94 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <RoleRubricEditor
          key={rubricEditorKey}
          selectedRole={selectedRole}
          organizationId={organizationId}
          profile={selectedGradingProfile}
        />
      </section>
    </div>
  );
}
