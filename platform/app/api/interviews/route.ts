import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { isAllowedAuthEmail } from "@/lib/auth/allowed-domains";
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
  const { user, organizationId } = await withAuth();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  if (!isAllowedAuthEmail(user.email)) {
    return NextResponse.json({ error: "Email domain is not allowed." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const candidateEmail = candidateEmailFromBody(body, user.email);
  const scriptVersion = process.env.PUDDLE_DEFAULT_SCRIPT_VERSION ?? "pilot-v1";
  const orgId = organizationId ?? `workos-user:${user.id}`;

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

  const session = payload as BackendCreateSessionResponse;
  const invitePath = session.invitePath ?? `/interview/${encodeURIComponent(session.inviteToken)}`;

  return NextResponse.json(
    {
      sessionId: session.sessionId,
      room: session.room,
      inviteUrl: `${publicOrigin()}${invitePath}`,
      inviteExpiresAt: session.inviteExpiresAt,
    },
    { status: 201 },
  );
}
