import {
  companyIdentityFromUser,
  getAshbyCompanyState,
  getRecentAshbyScreens,
} from "@/lib/ashby/server";
import { canManageAshbyOnboarding } from "@/lib/auth/ashby-onboarding-admin";
import { AshbyOnboardingWizard } from "./AshbyOnboardingWizard";
import { RecentScreensTable } from "./DashboardSections";
import { requireDashboardUser } from "./auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireDashboardUser();
  const { user, organizationId } = session;
  const identity = companyIdentityFromUser({ email: user.email, organizationId });
  const state = await getAshbyCompanyState(identity);
  const onboardingComplete = state.setupStatus === "connected" && state.connected && Boolean(state.lastSyncAt);
  const canManageSetup = canManageAshbyOnboarding(session);
  const screens = onboardingComplete ? await getRecentAshbyScreens(identity) : [];

  return (
    <div className="mx-auto grid min-w-0 max-w-[1440px] gap-5">
      <header className="min-w-0 rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">Dashboard</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">Recent screens</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          The dashboard shows the latest candidate screens and scorecards synced through the company Ashby
          integration.
        </p>
      </header>

      {onboardingComplete ? (
        <RecentScreensTable screens={screens} />
      ) : (
        <AshbyOnboardingWizard state={state} canManageSetup={canManageSetup} />
      )}
    </div>
  );
}
