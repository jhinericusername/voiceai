import { NextResponse } from "next/server";
import { requireAshbyReadyDashboardApiAccess } from "@/lib/ashby/dashboard-api-readiness.mjs";
import { dashboardApiReadinessContext } from "@/lib/ashby/dashboard-api-readiness-context";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function POST() {
  const access = await requireAshbyReadyDashboardApiAccess(dashboardApiReadinessContext());
  if (access.response) return access.response;

  let response: Response;
  try {
    response = await fetch(`${backendBaseUrl()}/grading/company-state`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({ organizationId: access.organizationId }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
