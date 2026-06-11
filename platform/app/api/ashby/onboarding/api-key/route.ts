import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { companyIdentityFromUser } from "@/lib/ashby/server";
import { isAllowedAuthEmail } from "@/lib/auth/allowed-domains";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function POST(request: Request) {
  const { user, organizationId } = await withAuth();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!isAllowedAuthEmail(user.email)) {
    return NextResponse.json({ error: "Email domain is not allowed." }, { status: 403 });
  }

  const body = objectBody(await request.json().catch(() => ({})));
  const ashbyApiKey = typeof body.ashbyApiKey === "string" ? body.ashbyApiKey : "";
  const identity = companyIdentityFromUser({ email: user.email, organizationId });

  let response: Response;
  try {
    response = await fetch(`${backendBaseUrl()}/integrations/ashby/onboarding/api-key`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({
        ...identity,
        reviewerEmail: user.email,
        ashbyApiKey,
      }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { error: payload.error ?? "Ashby onboarding request failed." },
      { status: response.status },
    );
  }

  return NextResponse.json(payload, { status: response.status });
}
