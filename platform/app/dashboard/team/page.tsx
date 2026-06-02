import { allowedAuthDomains } from "@/lib/auth/allowed-domains";
import { DashboardActionButton } from "../DashboardActionButton";
import { EmptyState, SectionPanel } from "../dashboard-ui";

export const dynamic = "force-dynamic";

export default function TeamPage() {
  const domains = allowedAuthDomains();

  return (
    <div className="mx-auto grid min-w-0 max-w-[1440px] gap-5">
      <header className="min-w-0 rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">Team</div>
        <div className="mt-2 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-slate-950 sm:text-3xl">Who can review with you?</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Workspace access is scoped to approved pilot domains. Invite reviewers from the top action bar or this page.
            </p>
          </div>
          <DashboardActionButton action="invite" variant="secondary">
            Invite teammate
          </DashboardActionButton>
        </div>
      </header>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SectionPanel title="Access policy" eyebrow="Workspace">
          <div className="grid gap-3 sm:grid-cols-2">
            {domains.map((domain) => (
              <div key={domain} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Allowed domain</div>
                <div className="mt-1 font-mono text-sm font-semibold text-slate-950">{domain}</div>
              </div>
            ))}
          </div>
        </SectionPanel>

        <SectionPanel title="Reviewer roster" eyebrow="Team access">
          <EmptyState
            title="Roster sync is not connected yet"
            detail="Invited teammates and reviewer permissions will appear here when the workspace team API is wired into the dashboard."
          />
        </SectionPanel>
      </div>
    </div>
  );
}
