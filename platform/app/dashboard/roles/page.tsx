import { companyIdentityFromUser, getAshbyCompanyState } from "@/lib/ashby/server";
import { RolesPipelineFoundation } from "../AshbyFirstDashboardSections";
import { selectedAshbyJobCount } from "../ashby-dashboard-state";
import { requireDashboardUser } from "../auth";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const session = await requireDashboardUser("/dashboard/roles");
  const state = await getAshbyCompanyState(
    companyIdentityFromUser({ email: session.user.email, organizationId: session.organizationId }),
  );

  return <RolesPipelineFoundation selectedJobCount={selectedAshbyJobCount(state)} lastSyncAt={state.lastSyncAt} />;
}
