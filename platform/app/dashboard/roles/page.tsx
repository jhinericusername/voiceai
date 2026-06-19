import { companyIdentityFromUser, getAshbyActivePipeline } from "@/lib/ashby/server";
import { canManageAshbyOnboarding } from "@/lib/auth/ashby-onboarding-admin";
import { requireDashboardUser } from "../auth";
import { ActivePipelineDashboard } from "./ActivePipelineDashboard";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const session = await requireDashboardUser("/dashboard/roles");
  const pipeline = await getAshbyActivePipeline(
    companyIdentityFromUser({ email: session.user.email, organizationId: session.organizationId }),
  );

  return (
    <ActivePipelineDashboard
      pipeline={pipeline}
      view="roles"
      canManageActiveStages={canManageAshbyOnboarding(session)}
    />
  );
}
