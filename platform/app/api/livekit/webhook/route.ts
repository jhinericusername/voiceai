import { NextResponse } from "next/server";
import { backendBaseUrl } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  const authorization = request.headers.get("authorization");
  const headers: Record<string, string> = {
    "content-type": "application/webhook+json",
  };
  if (authorization) {
    headers.authorization = authorization;
  }

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${backendBaseUrl()}/livekit/webhook`, {
      method: "POST",
      headers,
      body,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "Interview backend is not reachable. Please try again shortly." },
      { status: 502 },
    );
  }

  const payload = await backendResponse.json().catch(() => ({}));
  return NextResponse.json(payload, { status: backendResponse.status });
}
