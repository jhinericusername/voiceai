import { NextResponse } from "next/server";
import { requireAshbyReadyDashboardApiAccess } from "@/lib/ashby/dashboard-api-readiness.mjs";
import { dashboardApiReadinessContext } from "@/lib/ashby/dashboard-api-readiness-context";
import { ASHBY_ONBOARDING_ADMIN_DENIED_ERROR, canManageAshbyOnboarding } from "@/lib/auth/ashby-onboarding-admin";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stageNamesValue(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const names: string[] = [];
  for (const item of value) {
    const text = stringValue(item);
    if (!text || text.length > 120) {
      return null;
    }
    if (!names.includes(text)) {
      names.push(text);
    }
  }
  return names;
}

export async function POST(request: Request) {
  const access = await requireAshbyReadyDashboardApiAccess(dashboardApiReadinessContext());
  if (access.response) {
    return access.response;
  }
  if (!canManageAshbyOnboarding(access.session)) {
    return NextResponse.json({ error: ASHBY_ONBOARDING_ADMIN_DENIED_ERROR }, { status: 403 });
  }

  const body = objectValue(await request.json().catch(() => ({})));
  const jobId = stringValue(body.jobId);
  const activeStageNames = stageNamesValue(body.activeStageNames);
  const reviewerEmail = stringValue(objectValue(access.user).email);
  if (!jobId || !activeStageNames || !reviewerEmail) {
    return NextResponse.json({ error: "jobId and activeStageNames are required." }, { status: 400 });
  }

  const response = await fetch(`${backendBaseUrl()}/integrations/ashby/active-stages`, {
    method: "POST",
    headers: backendHeaders(),
    body: JSON.stringify({
      ...access.identity,
      reviewerEmail,
      jobId,
      activeStageNames,
    }),
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
