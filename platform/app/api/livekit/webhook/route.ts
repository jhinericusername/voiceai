import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function backendBaseUrl(): string {
  return (process.env.PUDDLE_BACKEND_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
}

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
