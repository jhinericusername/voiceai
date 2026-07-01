import { NextResponse } from "next/server";
import { getRoomRecordingsPage } from "@/app/dashboard/backend-data";
import { RECORDINGS_PAGE_SIZE } from "@/app/dashboard/recordings/recordings-pagination";
import { requireAshbyReadyDashboardApiAccess } from "@/lib/ashby/dashboard-api-readiness.mjs";
import { dashboardApiReadinessContext } from "@/lib/ashby/dashboard-api-readiness-context";

export const dynamic = "force-dynamic";

function boundedInteger(value: string | null, fallback: number, input: { readonly min: number; readonly max: number }): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(input.max, Math.max(input.min, Math.floor(parsed)));
}

export async function GET(request: Request) {
  const access = await requireAshbyReadyDashboardApiAccess(dashboardApiReadinessContext());
  if (access.response) return access.response;

  const url = new URL(request.url);
  const limit = boundedInteger(url.searchParams.get("limit"), RECORDINGS_PAGE_SIZE, {
    min: 1,
    max: RECORDINGS_PAGE_SIZE,
  });
  const offset = boundedInteger(url.searchParams.get("offset"), 0, {
    min: 0,
    max: 100_000,
  });

  try {
    const page = await getRoomRecordingsPage({
      orgId: access.identity.organizationId,
      limit,
      offset,
    });
    return NextResponse.json(page);
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }
}
