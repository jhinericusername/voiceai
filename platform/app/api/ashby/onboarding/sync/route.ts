import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
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
  const { user, organizationId } = session;
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!isAllowedAuthEmail(user.email)) {
    return NextResponse.json({ error: "Email domain is not allowed." }, { status: 403 });
  }

  if (!canManageAshbyOnboarding(session)) {
    return NextResponse.json({ error: ASHBY_ONBOARDING_ADMIN_DENIED_ERROR }, { status: 403 });
  }

  const identity = companyIdentityFromUser({ email: user.email, organizationId });

  let response: Response;
  try {
    response = await fetch(`${backendBaseUrl()}/integrations/ashby/sync-active-applications`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({
        ...identity,
        reviewerEmail: user.email,
      }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.warn("Ashby sync backend rejected request", { status: response.status, payload });
    return NextResponse.json({ error: "Ashby sync request failed." }, { status: response.status });
  }

  return NextResponse.json(payload, { status: response.status });
}
