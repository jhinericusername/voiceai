import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { companyIdentityFromUser } from "@/lib/ashby/server";
import { canViewDashboard, sessionOrganizationId } from "@/lib/auth/org-access.mjs";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function POST(request: Request) {
  const session = await withAuth();
  const { user } = session;
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!canViewDashboard(session)) {
    return NextResponse.json({ error: "You need an invitation to access this workspace." }, { status: 403 });
  }

  const body = objectBody(await request.json().catch(() => ({})));
  const organizationId = sessionOrganizationId(session);
  const identity = companyIdentityFromUser({ email: user.email, organizationId });

  let response: Response;
  try {
    response = await fetch(`${backendBaseUrl()}/integrations/ashby/applications/search`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({
        ...identity,
        jobId: typeof body.jobId === "string" ? body.jobId : null,
        query: typeof body.query === "string" ? body.query : "",
        limit: 8,
      }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
