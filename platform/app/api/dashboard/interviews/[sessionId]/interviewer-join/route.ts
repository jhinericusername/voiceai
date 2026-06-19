import { NextResponse } from "next/server";
import { requireAshbyReadyDashboardApiAccess } from "@/lib/ashby/dashboard-api-readiness.mjs";
import { dashboardApiReadinessContext } from "@/lib/ashby/dashboard-api-readiness-context";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

const JOIN_AI_INTERVIEWER_STATES = new Set(["not_started", "running", "stopped"]);

interface RouteContext {
  readonly params: Promise<{
    readonly sessionId: string;
  }>;
}

interface InterviewerJoinResponse {
  readonly sessionId: string;
  readonly room: string;
  readonly liveKitUrl: string;
  readonly token: string;
  readonly aiInterviewerState: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isInterviewerJoinResponse(value: unknown): value is InterviewerJoinResponse {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    typeof value.room === "string" &&
    typeof value.liveKitUrl === "string" &&
    typeof value.token === "string" &&
    typeof value.aiInterviewerState === "string" &&
    JOIN_AI_INTERVIEWER_STATES.has(value.aiInterviewerState)
  );
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

  if (!isInterviewerJoinResponse(payload)) {
    return NextResponse.json({ error: "Interviewer join response was malformed." }, { status: 502 });
  }

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "cache-control": "no-store",
    },
  });
}
