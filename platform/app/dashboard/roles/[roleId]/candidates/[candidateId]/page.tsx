import Link from "next/link";
import { notFound } from "next/navigation";
import {
  companyIdentityFromUser,
  getAshbyActivePipeline,
  type AshbyActivePipelineCandidate,
} from "@/lib/ashby/server";
import { DashboardCreateInterviewLauncher } from "../../../../DashboardCreateInterviewLauncher";
import { requireDashboardUser } from "../../../../auth";
import {
  SectionPanel,
  StatusPill,
  formatDateTime,
  secondaryButtonClass,
} from "../../../../dashboard-ui";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return [];
}

export default async function CandidateReportPage({
  params,
}: {
  readonly params: Promise<{ roleId: string; candidateId: string }>;
}) {
  const { roleId, candidateId } = await params;
  const { user, organizationId } = await requireDashboardUser(`/dashboard/roles/${roleId}`);
  const pipeline = await getAshbyActivePipeline(
    companyIdentityFromUser({ email: user.email, organizationId }),
  );
  const selectedRole = pipeline.roles.find((role) => role.jobId === roleId.trim());

  if (!selectedRole) {
    notFound();
  }

  const selectedCandidate = selectedRole.candidates.find((candidate) => candidateMatchesRoute(candidate, candidateId));
  if (!selectedCandidate) {
    notFound();
  }

  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
      <header className="rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status="Candidate profile" />
              <StatusPill status={selectedCandidate.currentStage} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">{selectedRole.name}</span>
            </div>
            <h1 className="mt-2 break-words text-2xl font-semibold text-slate-950 sm:text-3xl">
              {selectedCandidate.candidateName}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Review the synced Ashby application context and create a Puddle interview with candidate metadata attached.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <DashboardCreateInterviewLauncher
              interviewContext={{
                applicationId: selectedCandidate.applicationId,
                candidateId: selectedCandidate.candidateId,
                candidateName: selectedCandidate.candidateName,
                candidateEmail: selectedCandidate.candidateEmail,
                jobId: selectedCandidate.jobId,
                currentStage: selectedCandidate.currentStage,
              }}
            />
            <Link href={`/dashboard/roles/${roleId}`} className={secondaryButtonClass}>
              Back to role
            </Link>
          </div>
        </div>
      </header>

      <SectionPanel title="Application profile" eyebrow="Ashby">
        <dl className="grid gap-3 sm:grid-cols-2">
          <ApplicationMetaRow label="Candidate" value={selectedCandidate.candidateName} />
          <ApplicationMetaRow label="Email" value={selectedCandidate.candidateEmail ?? "No email"} />
          <ApplicationMetaRow label="Role" value={selectedRole.name} />
          <ApplicationMetaRow label="Stage" value={selectedCandidate.currentStage} />
          <ApplicationMetaRow label="Source" value={selectedCandidate.source ?? "Ashby"} />
          <ApplicationMetaRow label="Updated" value={formatNullableDate(selectedCandidate.updatedAt)} />
          <ApplicationMetaRow label="Application" value={selectedCandidate.applicationId} />
        </dl>
      </SectionPanel>
    </div>
  );
}

function candidateMatchesRoute(candidate: AshbyActivePipelineCandidate, routeCandidateId: string): boolean {
  const normalizedRouteCandidateId = routeCandidateId.trim();
  return candidate.candidateId === normalizedRouteCandidateId || candidate.applicationId === normalizedRouteCandidateId;
}

function ApplicationMetaRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</dd>
    </div>
  );
}

function formatNullableDate(value: string | null): string {
  return value ? formatDateTime(value) : "Not synced";
}
