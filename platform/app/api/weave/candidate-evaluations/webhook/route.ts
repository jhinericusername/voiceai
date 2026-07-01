import { NextResponse } from "next/server";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const sharedSecret = request.headers.get("x-puddle-webhook-secret");
  const headers: Record<string, string> = {
    ...(backendHeaders("application/json") as Record<string, string>),
  };
  if (sharedSecret) {
    headers["x-puddle-webhook-secret"] = sharedSecret;
  }

  let backendResponse: Response;
  try {
    backendResponse = await fetch(
      `${backendBaseUrl()}/integrations/weave/candidate-evaluations/webhook`,
      {
        method: "POST",
        headers,
        body: rawBody,
        cache: "no-store",
      },
    );
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const responsePayload = await backendResponse.json().catch(() => ({}));
  if (!backendResponse.ok) {
    return NextResponse.json(
      { error: "Weave candidate evaluation webhook was rejected." },
      { status: 400 },
    );
  }

  return NextResponse.json(responsePayload, { status: backendResponse.status });
}
