import { NextResponse } from "next/server";
import { requireAshbyReadyDashboardApiAccess } from "@/lib/ashby/dashboard-api-readiness.mjs";
import { dashboardApiReadinessContext } from "@/lib/ashby/dashboard-api-readiness-context";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";
import { publicBaseUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

interface BackendCreateSessionResponse {
  readonly sessionId: string;
  readonly room: string;
  readonly inviteToken: string;
  readonly invitePath?: string;
  readonly inviteExpiresAt: string;
}

function publicOrigin(): string {
  return publicBaseUrl();
}

function candidateEmailFromBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object" || !("candidateEmail" in body)) {
    return fallback;
  }
  const candidateEmail = String(body.candidateEmail ?? "").trim();
  return candidateEmail || fallback;
}

export async function POST(request: Request) {
  const access = await requireAshbyReadyDashboardApiAccess(dashboardApiReadinessContext());
  if (access.response) return access.response;

  const body = await request.json().catch(() => ({}));
  const candidateEmail = candidateEmailFromBody(body, access.user.email);
  const scriptVersion = process.env.PUDDLE_DEFAULT_SCRIPT_VERSION ?? "pilot-v1";
  const orgId = access.organizationId;

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${backendBaseUrl()}/integration/sessions`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({
        orgId,
        candidateEmail,
        scriptVersion,
        scheduledAt: new Date().toISOString(),
      }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "Interview backend is not reachable. Start the backend API and try again." },
      { status: 502 },
    );
  }

  const payload = await backendResponse.json().catch(() => ({}));
  if (!backendResponse.ok) {
    return NextResponse.json(
      { error: payload.error ?? "Interview backend rejected the request." },
      { status: backendResponse.status },
    );
  }

  const createdSession = payload as BackendCreateSessionResponse;
  const invitePath =
    createdSession.invitePath ?? `/interview/${encodeURIComponent(createdSession.inviteToken)}`;

  return NextResponse.json(
    {
      sessionId: createdSession.sessionId,
      room: createdSession.room,
      inviteUrl: `${publicOrigin()}${invitePath}`,
      interviewerJoinUrl: `${publicOrigin()}/dashboard/interviews/${encodeURIComponent(createdSession.sessionId)}/join`,
      inviteExpiresAt: createdSession.inviteExpiresAt,
    },
    { status: 201 },
  );
}
