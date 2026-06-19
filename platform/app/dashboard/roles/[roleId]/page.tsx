import Link from "next/link";
import { notFound } from "next/navigation";
import { companyIdentityFromUser, getAshbyCompanyState } from "@/lib/ashby/server";
import { requireDashboardUser } from "../../auth";
import { RoleWorkspaceTabs } from "./RoleWorkspaceTabs";
import {
  SectionPanel,
  StatusPill,
  secondaryButtonClass,
} from "../../dashboard-ui";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return [];
}

export default async function RoleDetailPage({ params }: { readonly params: Promise<{ roleId: string }> }) {
  const { roleId } = await params;
  const { user, organizationId } = await requireDashboardUser(`/dashboard/roles/${roleId}`);
  const state = await getAshbyCompanyState(
    companyIdentityFromUser({ email: user.email, organizationId }),
  );
  const onboardingComplete = state?.setupStatus === "connected" && state.connected && Boolean(state.lastSyncAt);
  if (!onboardingComplete) {
    notFound();
  }

  const ashbyJobIds = state.selectedJobIds.map((jobId) => jobId.trim()).filter(Boolean);
  const selectedIndex = ashbyJobIds.indexOf(roleId);

  if (selectedIndex === -1) {
    notFound();
  }

  const roleLabel = `Selected role ${selectedIndex + 1}`;

  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
      <header className="puddle-dashboard-hero-card min-w-0 overflow-hidden rounded-md border border-cyan-200 bg-white/94 px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status="Ashby role" />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Role workspace</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">{roleLabel}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              This workspace is reserved for the role-specific Puddle interview pipeline: send interviews, track scheduled
              interviews, and review completed packets with a job-specific rubric.
            </p>
          </div>
          <Link href="/dashboard/roles" className={secondaryButtonClass}>
            All roles
          </Link>
        </div>
      </header>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <RoleWorkspaceTabs roleLabel={roleLabel} ashbyJobIds={ashbyJobIds} />
        </div>

        <aside className="grid min-w-0 gap-5 xl:content-start">
          <SectionPanel title="Pipeline mapping" eyebrow="Ashby stages">
            <p className="text-sm leading-6 text-slate-600">
              Configure which Ashby stages feed this role-specific Puddle states, then reviewers can move candidates to any
              allowed stage or archive them after review.
            </p>
          </SectionPanel>

          <SectionPanel title="Send interviews" eyebrow="Next step">
            <p className="text-sm leading-6 text-slate-600">
              Use the dashboard top bar to create a hosted Puddle room, then copy the candidate link from the interviewer
              pre-call room.
            </p>
          </SectionPanel>
        </aside>
      </div>
    </div>
  );
}
