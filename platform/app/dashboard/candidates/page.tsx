import { companyIdentityFromUser, getAshbyCompanyState } from "@/lib/ashby/server";
import { CandidateApplicationsFoundation } from "../AshbyFirstDashboardSections";
import { requireDashboardUser } from "../auth";

export const dynamic = "force-dynamic";

export default async function CandidatesPage() {
  const session = await requireDashboardUser("/dashboard/candidates");
  const state = await getAshbyCompanyState(
    companyIdentityFromUser({ email: session.user.email, organizationId: session.organizationId }),
  );

  return <CandidateApplicationsFoundation lastSyncAt={state.lastSyncAt} />;
}
