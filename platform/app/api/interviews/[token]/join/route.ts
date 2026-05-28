import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{
    readonly token: string;
  }>;
}

function backendBaseUrl(): string {
  return (process.env.PUDDLE_BACKEND_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
}

function backendHeaders(): HeadersInit {
  const token = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function POST(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const encodedToken = encodeURIComponent(token);

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${backendBaseUrl()}/candidate/invites/${encodedToken}/join`, {
      method: "POST",
      headers: backendHeaders(),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "Interview backend is not reachable. Please try again shortly." },
      { status: 502 },
    );
  }

  const payload = await backendResponse.json().catch(() => ({}));
  if (!backendResponse.ok) {
    return NextResponse.json(
      { error: payload.error ?? "Invite could not be joined." },
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
