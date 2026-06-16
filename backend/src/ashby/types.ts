export interface CompanyIdentity {
  readonly organizationId: string;
  readonly emailDomain: string;
}

export interface AshbySetupRequest extends CompanyIdentity {
  readonly ashbyApiKey: string;
  readonly selectedJobIds: readonly string[];
}

export interface AshbyApiKeyOnboardingRequest extends CompanyIdentity {
  readonly reviewerEmail: string;
  readonly ashbyApiKey: string;
}

export interface AshbyJobSelectionRequest extends CompanyIdentity {
  readonly reviewerEmail: string;
  readonly selectedJobIds: readonly string[];
  readonly publicBaseUrl: string;
}

export interface AshbySyncRequest extends CompanyIdentity {
  readonly reviewerEmail?: string;
}

export interface AshbyJob {
  readonly id: string;
  readonly name: string;
  readonly status: string | null;
}

export interface AshbyWebhookEnvelope {
  readonly integrationId?: string | null;
  readonly rawBody?: string | null;
  readonly signature?: string | null;
  readonly payload?: unknown;
}

export interface AshbyWebhookPayload {
  readonly webhookActionId?: string;
  readonly action: string;
  readonly data?: Record<string, unknown>;
}

export interface SyncedAshbyApplication {
  readonly applicationId: string;
  readonly integrationId: string;
  readonly candidateId: string;
  readonly candidateName: string;
  readonly candidateEmail: string | null;
  readonly jobId: string;
  readonly currentStage: string | null;
  readonly source: string | null;
  readonly status: string;
  readonly ashbyUpdatedAt: string | null;
  readonly rawPayload: Record<string, unknown>;
}

export interface ScoreInput extends CompanyIdentity {
  readonly applicationId: string;
  readonly jobId: string;
  readonly roleId: string;
  readonly reviewerEmail: string;
  readonly problemSolving: number;
  readonly agency: number;
  readonly competitiveness: number;
  readonly curiosity: number;
  readonly comments: string;
}
