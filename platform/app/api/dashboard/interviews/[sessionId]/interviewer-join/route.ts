import { NextResponse } from "next/server";
import { requireAshbyReadyDashboardApiAccess } from "@/lib/ashby/dashboard-api-readiness.mjs";
import { dashboardApiReadinessContext } from "@/lib/ashby/dashboard-api-readiness-context";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{
    readonly sessionId: string;
  }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const access = await requireAshbyReadyDashboardApiAccess(dashboardApiReadinessContext());
  if (access.response) return access.response;

  const { sessionId } = await context.params;
  const encodedSessionId = encodeURIComponent(sessionId);

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${backendBaseUrl()}/internal/interviews/${encodedSessionId}/interviewer/join`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({
        orgId: access.organizationId,
        interviewerEmail: access.user.email,
        interviewerUserId: access.user.id,
      }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const payload = await backendResponse.json().catch(() => ({}));
  if (!backendResponse.ok) {
    return NextResponse.json(
      {
        error: payload.error ?? "Interviewer could not join this interview.",
        code: payload.code,
      },
      { status: backendResponse.status },
    );
  }

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "cache-control": "no-store",
    },
  });
}
