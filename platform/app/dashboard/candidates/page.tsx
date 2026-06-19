import { companyIdentityFromUser, getAshbyActivePipeline } from "@/lib/ashby/server";
import { canManageAshbyOnboarding } from "@/lib/auth/ashby-onboarding-admin";
import { requireDashboardUser } from "../auth";
import { ActivePipelineDashboard } from "../roles/ActivePipelineDashboard";

export const dynamic = "force-dynamic";

export default async function CandidatesPage() {
  const session = await requireDashboardUser("/dashboard/candidates");
  const pipeline = await getAshbyActivePipeline(
    companyIdentityFromUser({ email: session.user.email, organizationId: session.organizationId }),
  );

  return (
    <ActivePipelineDashboard
      pipeline={pipeline}
      view="candidates"
      canManagePipelineStages={canManageAshbyOnboarding(session)}
    />
  );
}
