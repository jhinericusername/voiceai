import { withAuth } from "@workos-inc/authkit-nextjs";
import { handleAshbyJobsOnboarding } from "@/lib/ashby/onboarding-route-behavior.mjs";
import { companyIdentityFromUser } from "@/lib/ashby/server";
import {
  ASHBY_ONBOARDING_ADMIN_DENIED_ERROR,
  canManageAshbyOnboarding,
} from "@/lib/auth/ashby-onboarding-admin";
import { isAllowedAuthEmail } from "@/lib/auth/allowed-domains";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await withAuth();
  return handleAshbyJobsOnboarding(request, {
    adminDeniedError: ASHBY_ONBOARDING_ADMIN_DENIED_ERROR,
    backendBaseUrl,
    backendHeaders,
    canManageAshbyOnboarding,
    companyIdentityFromUser,
    fetchImpl: fetch,
    isAllowedAuthEmail,
    logger: console,
    publicBaseUrl: process.env.PUDDLE_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    session,
  });
}
