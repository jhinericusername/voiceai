import { withAuth } from "@workos-inc/authkit-nextjs";
import { handleAshbySyncOnboarding } from "@/lib/ashby/onboarding-route-behavior.mjs";
import { companyIdentityFromUser } from "@/lib/ashby/server";
import {
  ASHBY_ONBOARDING_ADMIN_DENIED_ERROR,
  canManageAshbyOnboarding,
} from "@/lib/auth/ashby-onboarding-admin";
import { isAllowedAuthEmail } from "@/lib/auth/allowed-domains";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await withAuth();
  return handleAshbySyncOnboarding(undefined, {
    adminDeniedError: ASHBY_ONBOARDING_ADMIN_DENIED_ERROR,
    backendBaseUrl,
    backendHeaders,
    canManageAshbyOnboarding,
    companyIdentityFromUser,
    fetchImpl: fetch,
    isAllowedAuthEmail,
    logger: console,
    session,
  });
}
