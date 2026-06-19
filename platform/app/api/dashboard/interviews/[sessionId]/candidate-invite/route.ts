import { NextResponse } from "next/server";
import { requireAshbyReadyDashboardApiAccess } from "@/lib/ashby/dashboard-api-readiness.mjs";
import { dashboardApiReadinessContext } from "@/lib/ashby/dashboard-api-readiness-context";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";
import { publicBaseUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{
    readonly sessionId: string;
  }>;
}

interface CandidateInviteResponse {
  readonly invitePath: string;
  readonly inviteExpiresAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCandidateInviteResponse(value: unknown): value is CandidateInviteResponse {
  return isRecord(value) && typeof value.invitePath === "string" && typeof value.inviteExpiresAt === "string";
}

export async function POST(_request: Request, context: RouteContext) {
  const access = await requireAshbyReadyDashboardApiAccess(dashboardApiReadinessContext());
  if (access.response) return access.response;

  const { sessionId } = await context.params;
  const encodedSessionId = encodeURIComponent(sessionId);

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${backendBaseUrl()}/internal/interviews/${encodedSessionId}/candidate-invites`, {
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
        error: payload.error ?? "Candidate invite could not be created.",
        code: payload.code,
      },
      { status: backendResponse.status },
    );
  }

  if (!isCandidateInviteResponse(payload)) {
    return NextResponse.json({ error: "Candidate invite response was malformed." }, { status: 502 });
  }

  return NextResponse.json(
    {
      candidateInviteUrl: `${publicBaseUrl()}${payload.invitePath}`,
      inviteExpiresAt: payload.inviteExpiresAt,
    },
    {
      status: 201,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
