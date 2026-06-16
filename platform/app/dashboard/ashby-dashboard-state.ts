import type { AshbyCompanyState } from "@/lib/ashby/server";

export function isAshbyDashboardReady(state: AshbyCompanyState): boolean {
  return state.setupStatus === "connected" && state.connected && Boolean(state.lastSyncAt);
}

export function selectedAshbyJobCount(state: AshbyCompanyState): number {
  return state.selectedJobIds.length;
}
