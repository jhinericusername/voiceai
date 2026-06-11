import { NextResponse } from "next/server";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("ashby-signature");
  const url = new URL(request.url);
  const integrationId = url.searchParams.get("integrationId");
  const companyDomain = url.searchParams.get("companyDomain");

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${backendBaseUrl()}/integrations/ashby/webhook`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({ integrationId, companyDomain, rawBody, signature }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const responsePayload = await backendResponse.json().catch(() => ({}));
  if (!backendResponse.ok) {
    return NextResponse.json({ error: "Ashby webhook was rejected." }, { status: 400 });
  }

  return NextResponse.json(responsePayload);
}
