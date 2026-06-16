import { companyIdentityFromUser, getAshbyCompanyState } from "@/lib/ashby/server";
import { ReviewRolePickerFoundation } from "../AshbyFirstDashboardSections";
import { selectedAshbyJobCount } from "../ashby-dashboard-state";
import { requireDashboardUser } from "../auth";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  const session = await requireDashboardUser("/dashboard/review-queue");
  const state = await getAshbyCompanyState(
    companyIdentityFromUser({ email: session.user.email, organizationId: session.organizationId }),
  );

  return <ReviewRolePickerFoundation selectedJobCount={selectedAshbyJobCount(state)} />;
}
