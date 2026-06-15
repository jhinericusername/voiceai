import { withAuth } from "@workos-inc/authkit-nextjs";
import { handleAshbyApiKeyOnboarding } from "@/lib/ashby/onboarding-route-behavior.mjs";
import { companyIdentityFromUser } from "@/lib/ashby/server";
import {
  ASHBY_ONBOARDING_ADMIN_DENIED_ERROR,
  canManageAshbyOnboarding,
} from "@/lib/auth/ashby-onboarding-admin";
import { canViewDashboard, sessionOrganizationId } from "@/lib/auth/org-access.mjs";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await withAuth();
  return handleAshbyApiKeyOnboarding(request, {
    adminDeniedError: ASHBY_ONBOARDING_ADMIN_DENIED_ERROR,
    backendBaseUrl,
    backendHeaders,
    canManageAshbyOnboarding,
    canViewDashboard,
    companyIdentityFromUser,
    fetchImpl: fetch,
    logger: console,
    sessionOrganizationId,
    session,
  });
}
