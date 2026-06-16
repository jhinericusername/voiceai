import { NextResponse } from "next/server";
import { requireAshbyReadyDashboardApiAccess } from "@/lib/ashby/dashboard-api-readiness.mjs";
import { dashboardApiReadinessContext } from "@/lib/ashby/dashboard-api-readiness-context";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function POST(request: Request) {
  const access = await requireAshbyReadyDashboardApiAccess(dashboardApiReadinessContext());
  if (access.response) return access.response;

  const body = objectBody(await request.json().catch(() => ({})));

  let response: Response;
  try {
    response = await fetch(`${backendBaseUrl()}/integrations/ashby/applications/search`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({
        ...access.identity,
        jobId: typeof body.jobId === "string" ? body.jobId : null,
        query: typeof body.query === "string" ? body.query : "",
        limit: 8,
      }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
