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

interface InterviewerConnectedResponse {
  readonly sessionId: string;
  readonly room: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isInterviewerConnectedResponse(value: unknown): value is InterviewerConnectedResponse {
  return isRecord(value) && typeof value.sessionId === "string" && typeof value.room === "string";
}

export async function POST(_request: Request, context: RouteContext) {
  const access = await requireAshbyReadyDashboardApiAccess(dashboardApiReadinessContext());
  if (access.response) return access.response;

  const { sessionId } = await context.params;
  const encodedSessionId = encodeURIComponent(sessionId);

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${backendBaseUrl()}/internal/interviews/${encodedSessionId}/interviewer/connected`, {
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
        error: payload.error ?? "Interviewer presence could not be acknowledged.",
        code: payload.code,
      },
      { status: backendResponse.status },
    );
  }

  if (!isInterviewerConnectedResponse(payload)) {
    return NextResponse.json({ error: "Interviewer connected response was malformed." }, { status: 502 });
  }

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "cache-control": "no-store",
    },
  });
}
