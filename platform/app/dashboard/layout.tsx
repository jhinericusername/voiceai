import type { Metadata } from "next";
import type { ReactNode } from "react";
import { canManageAshbyOnboarding } from "@/lib/auth/ashby-onboarding-admin";
import { companyIdentityFromUser, getAshbyCompanyState } from "@/lib/ashby/server";
import { noindexMetadata } from "@/lib/seo";
import { AshbySetupOnlyScreen } from "./AshbySetupOnlyScreen";
import { DashboardChrome } from "./DashboardChrome";
import { isAshbyDashboardReady } from "./ashby-dashboard-state";
import { requireDashboardUser } from "./auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = noindexMetadata;

export default async function DashboardLayout({ children }: { readonly children: ReactNode }) {
  const session = await requireDashboardUser();
  const { displayName, organizationId, user } = session;
  const identity = companyIdentityFromUser({ email: user.email, organizationId });
  const ashbyState = await getAshbyCompanyState(identity);
  const onboardingComplete = isAshbyDashboardReady(ashbyState);
  const canManageSetup = canManageAshbyOnboarding(session);

  if (!onboardingComplete) {
    return (
      <AshbySetupOnlyScreen
        state={ashbyState}
        canManageSetup={canManageSetup}
        displayName={displayName}
        email={user.email}
      />
    );
  }

  return (
    <DashboardChrome displayName={displayName} email={user.email}>
      {children}
    </DashboardChrome>
  );
}
