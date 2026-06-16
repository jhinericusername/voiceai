import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { companyIdentityFromUser, getAshbyCompanyState } from "@/lib/ashby/server";
import { isAshbyDashboardReady } from "@/app/dashboard/ashby-dashboard-state";
import { canViewDashboard, sessionOrganizationId } from "@/lib/auth/org-access.mjs";

export function dashboardApiReadinessContext() {
  return {
    withAuth,
    canViewDashboard,
    sessionOrganizationId,
    companyIdentityFromUser,
    getAshbyCompanyState,
    isAshbyDashboardReady,
    responseJson: (payload: unknown, status: number) => NextResponse.json(payload, { status }),
  };
}
