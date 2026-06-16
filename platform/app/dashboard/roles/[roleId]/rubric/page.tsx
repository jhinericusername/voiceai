import Link from "next/link";
import { notFound } from "next/navigation";
import { companyIdentityFromUser, getAshbyCompanyState } from "@/lib/ashby/server";
import { requireDashboardUser } from "../../../auth";
import {
  EmptyState,
  SectionPanel,
  StatusPill,
  secondaryButtonClass,
} from "../../../dashboard-ui";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return [];
}

export default async function RubricPage({ params }: { readonly params: Promise<{ roleId: string }> }) {
  const { roleId } = await params;
  const { user, organizationId } = await requireDashboardUser(`/dashboard/roles/${roleId}/rubric`);
  const state = await getAshbyCompanyState(
    companyIdentityFromUser({ email: user.email, organizationId }),
  );
  const selectedJobIds = state.selectedJobIds.map((jobId) => jobId.trim()).filter(Boolean);
  const selectedIndex = selectedJobIds.indexOf(roleId);

  if (selectedIndex === -1) {
    notFound();
  }

  const roleLabel = `Selected role ${selectedIndex + 1}`;

  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
      <header className="rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status="Rubric" />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">{roleLabel}</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">Role rubric</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Each review queue must use the rubric for its specific role. This page will show editable role criteria
              after rubric configuration is wired to real Ashby role data.
            </p>
          </div>
          <Link href={`/dashboard/roles/${roleId}`} className={secondaryButtonClass}>
            Back to role
          </Link>
        </div>
      </header>

      <SectionPanel title="Scoring bar" eyebrow="Role-specific">
        <EmptyState
          title="No role rubric configured yet"
          detail="Placeholder rubric content has been removed. Real role-specific criteria will appear here once configured."
        />
      </SectionPanel>
    </div>
  );
}
