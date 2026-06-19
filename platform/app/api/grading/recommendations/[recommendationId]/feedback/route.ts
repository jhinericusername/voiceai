import { NextResponse } from "next/server";
import { requireAshbyReadyDashboardApiAccess } from "@/lib/ashby/dashboard-api-readiness.mjs";
import { dashboardApiReadinessContext } from "@/lib/ashby/dashboard-api-readiness-context";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{
    readonly recommendationId: string;
  }>;
}

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireAshbyReadyDashboardApiAccess(dashboardApiReadinessContext());
  if (access.response) return access.response;

  const { recommendationId } = await context.params;
  const body = objectBody(await request.json().catch(() => ({})));
  const sessionId = stringValue(body.sessionId);
  const reviewerDecision = stringValue(body.reviewerDecision);

  if (!sessionId || !reviewerDecision) {
    return NextResponse.json(
      { error: "sessionId and reviewerDecision are required." },
      { status: 400 },
    );
  }

  let response: Response;
  try {
    response = await fetch(
      `${backendBaseUrl()}/grading/recommendations/${encodeURIComponent(recommendationId)}/feedback`,
      {
        method: "POST",
        headers: backendHeaders(),
        body: JSON.stringify({
          sessionId,
          organizationId: access.organizationId,
          reviewerEmail: stringValue(access.user.email),
          reviewerDecision,
          overrideReason: stringValue(body.overrideReason),
          dimensionFeedback: objectBody(body.dimensionFeedback),
        }),
        cache: "no-store",
      },
    );
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
