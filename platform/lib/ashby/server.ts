import "server-only";

import { backendBaseUrl, backendFetch, backendHeaders } from "@/lib/backend-api";
import { emailDomain } from "@/lib/auth/email-domain";

export interface CompanyIdentityPayload {
  readonly organizationId: string;
  readonly emailDomain: string;
}

export interface AshbyCompanyState {
  readonly connected: boolean;
  readonly setupStatus: string;
  readonly integrationId: string | null;
  readonly emailDomain: string;
  readonly selectedJobIds: readonly string[];
  readonly lastPingAt: string | null;
  readonly lastSyncAt: string | null;
  readonly webhookUrlPath?: string | null;
}

export interface AshbyJobOption {
  readonly id: string;
  readonly name: string;
  readonly status: string | null;
}

export interface RecentScreen {
  readonly score_id: string;
  readonly application_id: string;
  readonly role_id: string;
  readonly reviewer_email: string;
  readonly total_score: string | number;
  readonly comments: string;
  readonly updated_at: string;
  readonly candidate_name: string;
  readonly candidate_email: string | null;
  readonly job_id: string;
  readonly current_stage: string | null;
  readonly status: string;
}

export interface AshbyActivePipelineStage {
  readonly name: string;
  readonly count: number;
}

export interface AshbyActivePipelineCandidate {
  readonly applicationId: string;
  readonly candidateId: string;
  readonly candidateName: string;
  readonly candidateEmail: string | null;
  readonly jobId: string;
  readonly currentStage: string;
  readonly source: string | null;
  readonly updatedAt: string | null;
  readonly ashbyUrl: string;
  readonly linkedInUrl: string | null;
  readonly resumeUrl: string | null;
}

export interface AshbyActivePipelineRole {
  readonly jobId: string;
  readonly name: string;
  readonly activeStageNames: readonly string[];
  readonly stageOptions: readonly AshbyActivePipelineStage[];
  readonly activeCandidateCount: number;
  readonly candidates: readonly AshbyActivePipelineCandidate[];
}

export interface AshbyActivePipeline {
  readonly integrationId: string;
  readonly lastSyncAt: string | null;
  readonly selectedJobCount: number;
  readonly totalSyncedCandidates: number;
  readonly activeCandidateCount: number;
  readonly candidateRowCount: number;
  readonly candidateRowsTruncated: boolean;
  readonly roles: readonly AshbyActivePipelineRole[];
}

export function companyIdentityFromUser(input: {
  readonly email: string | null | undefined;
  readonly organizationId?: string | null;
}): CompanyIdentityPayload {
  const organizationId = input.organizationId?.trim();
  if (!organizationId) {
    throw new Error("Signed-in user does not belong to a WorkOS organization.");
  }

  const domain = emailDomain(input.email);
  if (!domain) {
    throw new Error("Signed-in user does not have a valid email domain.");
  }

  return {
    organizationId,
    emailDomain: domain,
  };
}

function backendErrorMessage(payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }

  return "Backend request failed.";
}

async function postBackend<T>(path: string, body: unknown): Promise<T> {
  const response = await backendFetch(`${backendBaseUrl()}${path}`, {
    method: "POST",
    headers: backendHeaders(),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(backendErrorMessage(payload));
  }

  return payload as T;
}

export async function getAshbyCompanyState(identity: CompanyIdentityPayload): Promise<AshbyCompanyState> {
  return postBackend<AshbyCompanyState>("/integrations/ashby/company-state", identity);
}

export async function getAshbyJobs(
  identity: CompanyIdentityPayload,
  reviewerEmail: string,
): Promise<readonly AshbyJobOption[]> {
  const payload = await postBackend<{ jobs: AshbyJobOption[] }>("/integrations/ashby/jobs", {
    ...identity,
    reviewerEmail,
  });

  return payload.jobs;
}

export async function getRecentAshbyScreens(identity: CompanyIdentityPayload): Promise<readonly RecentScreen[]> {
  const payload = await postBackend<{ screens: RecentScreen[] }>("/integrations/ashby/recent-screens", {
    ...identity,
    limit: 20,
  });

  return payload.screens;
}

export async function getAshbyActivePipeline(identity: CompanyIdentityPayload): Promise<AshbyActivePipeline> {
  return postBackend<AshbyActivePipeline>("/integrations/ashby/active-pipeline", {
    ...identity,
    limit: 1000,
  });
}
