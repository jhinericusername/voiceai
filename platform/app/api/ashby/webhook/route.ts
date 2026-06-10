import { NextResponse } from "next/server";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";
import { verifyAshbyWebhookSignature } from "@/lib/ashby/webhook-signature";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ashbyWebhookSecret(): string {
  return process.env.PUDDLE_ASHBY_WEBHOOK_SECRET?.trim() ?? "";
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("ashby-signature");
  const secret = ashbyWebhookSecret();

  if (!verifyAshbyWebhookSignature({ body, secret, signature })) {
    return NextResponse.json({ error: "invalid webhook signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid webhook json" }, { status: 400 });
  }

  const url = new URL(request.url);
  const integrationId = url.searchParams.get("integrationId");
  const companyDomain = url.searchParams.get("companyDomain");

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${backendBaseUrl()}/integrations/ashby/webhook`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({ integrationId, companyDomain, payload }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const responsePayload = await backendResponse.json().catch(() => ({}));
  if (!backendResponse.ok) {
    return NextResponse.json(
      { error: responsePayload.error ?? "Ashby webhook was rejected." },
      { status: backendResponse.status },
    );
  }

  return NextResponse.json(responsePayload, { status: 200 });
}
