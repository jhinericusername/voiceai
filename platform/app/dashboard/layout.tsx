import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  companyIdentityFromUser,
  getAshbyCompanyState,
} from "@/lib/ashby/server";
import { canManageAshbyOnboarding } from "@/lib/auth/ashby-onboarding-admin";
import { allowedAuthDomains } from "@/lib/auth/allowed-domains";
import { noindexMetadata } from "@/lib/seo";
import { AshbyOnboardingWizard } from "./AshbyOnboardingWizard";
import { DashboardChrome } from "./DashboardChrome";
import { requireDashboardUser } from "./auth";
import { demoRoles } from "./demo-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = noindexMetadata;

export default async function DashboardLayout({ children }: { readonly children: ReactNode }) {
  const session = await requireDashboardUser();
  const { displayName, user, organizationId } = session;
  const identity = companyIdentityFromUser({ email: user.email, organizationId });
  const state = await getAshbyCompanyState(identity);
  const onboardingComplete = state.setupStatus === "connected" && state.connected && Boolean(state.lastSyncAt);
  const canManageSetup = canManageAshbyOnboarding(session);

  if (!onboardingComplete) {
    return (
      <main className="min-h-svh min-w-0 overflow-x-clip bg-white px-4 py-5 text-slate-950 sm:px-5">
        <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
          <AshbyOnboardingWizard state={state} canManageSetup={canManageSetup} />
        </div>
      </main>
    );
  }

  return (
    <DashboardChrome
      displayName={displayName}
      email={user.email}
      allowedDomains={allowedAuthDomains()}
      roles={demoRoles.map((role) => ({ id: role.id, title: role.title, status: role.status }))}
    >
      {children}
    </DashboardChrome>
  );
}
