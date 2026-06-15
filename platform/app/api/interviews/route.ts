import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { canViewDashboard, sessionOrganizationId } from "@/lib/auth/org-access.mjs";
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
  const authSession = await withAuth();
  const { user } = authSession;
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  if (!canViewDashboard(authSession)) {
    return NextResponse.json({ error: "You need an invitation to access this workspace." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const candidateEmail = candidateEmailFromBody(body, user.email);
  const scriptVersion = process.env.PUDDLE_DEFAULT_SCRIPT_VERSION ?? "pilot-v1";
  const orgId = sessionOrganizationId(authSession);
  if (!orgId) {
    return NextResponse.json({ error: "You need an invitation to access this workspace." }, { status: 403 });
  }

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
      inviteExpiresAt: createdSession.inviteExpiresAt,
    },
    { status: 201 },
  );
}
