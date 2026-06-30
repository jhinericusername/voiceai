import Link from "next/link";
import { notFound } from "next/navigation";
import { companyIdentityFromUser, getAshbyActivePipeline } from "@/lib/ashby/server";
import { ashbyJobReferences } from "../../../ashby-role-labels";
import { requireDashboardUser } from "../../../../auth";
import {
  EmptyState,
  SectionPanel,
  StatusPill,
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
  const { roleId } = await params;
  const { user, organizationId } = await requireDashboardUser(`/dashboard/roles/${roleId}`);
  const pipeline = await getAshbyActivePipeline(
    companyIdentityFromUser({ email: user.email, organizationId }),
  );
  const selectedRole = ashbyJobReferences(pipeline.roles).find((role) => role.jobId === roleId.trim());

  if (!selectedRole) {
    notFound();
  }

  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
      <header className="rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status="Candidate profile" />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">{selectedRole.name}</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">Candidate application</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Puddle will show the real Ashby application, interview state, transcript evidence, and reviewer decision
              here after application sync is connected.
            </p>
          </div>
          <Link href={`/dashboard/roles/${roleId}`} className={secondaryButtonClass}>
            Back to role
          </Link>
        </div>
      </header>

      <SectionPanel title="Application profile" eyebrow="Ashby">
        <EmptyState
          title="No synced application record yet"
          detail="This page no longer renders placeholder candidate data. It will populate from the selected role's real Ashby applications."
        />
      </SectionPanel>
    </div>
  );
}
