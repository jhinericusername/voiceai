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

const AI_CONTROL_ACTIONS = new Set(["start", "stop", "resume", "end"]);
const AI_INTERVIEWER_STATES = new Set(["running", "stopped", "ended"]);

interface AiControlResponse {
  readonly sessionId: string;
  readonly aiInterviewerState: string;
  readonly requestedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAiControlResponse(value: unknown): value is AiControlResponse {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    typeof value.aiInterviewerState === "string" &&
    AI_INTERVIEWER_STATES.has(value.aiInterviewerState) &&
    typeof value.requestedAt === "string"
  );
}

function actionFromBody(body: unknown): string {
  if (!body || typeof body !== "object" || !("action" in body)) {
    return "";
  }
  return typeof body.action === "string" ? body.action : "";
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireAshbyReadyDashboardApiAccess(dashboardApiReadinessContext());
  if (access.response) return access.response;

  const { sessionId } = await context.params;
  const encodedSessionId = encodeURIComponent(sessionId);
  const action = actionFromBody(await request.json().catch(() => ({})));
  if (!AI_CONTROL_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Choose start, stop, resume, or end." }, { status: 400 });
  }

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${backendBaseUrl()}/internal/interviews/${encodedSessionId}/ai-control`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({
        orgId: access.organizationId,
        interviewerEmail: access.user.email,
        interviewerUserId: access.user.id,
        action,
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
        error: payload.error ?? "AI interviewer control request failed.",
        code: payload.code,
      },
      { status: backendResponse.status },
    );
  }

  if (!isAiControlResponse(payload)) {
    return NextResponse.json({ error: "AI interviewer control response was malformed." }, { status: 502 });
  }

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "cache-control": "no-store",
    },
  });
}
