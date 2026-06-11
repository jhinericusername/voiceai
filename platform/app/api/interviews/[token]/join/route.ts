import { NextResponse } from "next/server";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{
    readonly token: string;
  }>;
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const encodedToken = encodeURIComponent(token);
  const body = await request.json().catch(() => ({}));

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${backendBaseUrl()}/candidate/invites/${encodedToken}/join`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify(body),
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
      {
        error: payload.error ?? "Invite could not be joined.",
        code: payload.code,
      },
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
