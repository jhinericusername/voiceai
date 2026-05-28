import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { isAllowedAuthEmail } from "@/lib/auth/allowed-domains";

export const dynamic = "force-dynamic";

interface BackendCreateSessionResponse {
  readonly sessionId: string;
  readonly room: string;
  readonly inviteToken: string;
  readonly invitePath?: string;
  readonly inviteExpiresAt: string;
}

function backendBaseUrl(): string {
  return (process.env.PUDDLE_BACKEND_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
}

function publicOrigin(request: Request): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin).replace(/\/$/, "");
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
      headers: { "content-type": "application/json" },
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
      inviteUrl: `${publicOrigin(request)}${invitePath}`,
      inviteExpiresAt: session.inviteExpiresAt,
    },
    { status: 201 },
  );
}
