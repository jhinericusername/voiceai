import { randomUUID } from "node:crypto";
import type { SqlStatement } from "../consent/repository.js";
import type { CompanyIdentity, ScoreInput, SyncedAshbyApplication } from "./types.js";

export type AshbyIntegrationAuditAction =
  | "api_key_replaced"
  | "jobs_selected"
  | "active_applications_synced";

function jsonParam(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function assertScoreValue(label: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 4 || !Number.isInteger(value * 2)) {
    throw new Error(`${label} must be a score from 0 to 4 in 0.5 increments`);
  }
}

export function normalizeEmailDomain(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmailDomain(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
    normalizeEmailDomain(value),
  );
}

export function integrationLookupStatement(identity: CompanyIdentity): SqlStatement {
  return {
    sql:
      "SELECT * FROM ashby_company_integrations " +
      "WHERE organization_id = $1 LIMIT 1",
    params: [identity.organizationId],
  };
}

export function integrationByIdStatement(integrationId: string): SqlStatement {
  return {
    sql: "SELECT * FROM ashby_company_integrations WHERE integration_id = $1 LIMIT 1",
    params: [integrationId],
  };
}

export function integrationByIdForUpdateStatement(integrationId: string): SqlStatement {
  return {
    sql: "SELECT * FROM ashby_company_integrations WHERE integration_id = $1 LIMIT 1 FOR UPDATE",
    params: [integrationId],
  };
}

export function integrationSetupUpsertStatement(input: {
  readonly organizationId: string;
  readonly emailDomain: string;
  readonly ashbyApiKeyCiphertext: string;
  readonly selectedJobIds: readonly string[];
  readonly integrationId?: string;
}): SqlStatement {
  const integrationId = input.integrationId ?? randomUUID();
  return {
    sql:
      "WITH matching_integrations AS (" +
      "SELECT integration_id FROM ashby_company_integrations " +
      "WHERE organization_id = $2 " +
      "FOR UPDATE" +
      "), target AS (" +
      "SELECT integration_id FROM matching_integrations ORDER BY integration_id LIMIT 1" +
      "), updated AS (" +
      "UPDATE ashby_company_integrations SET " +
      "email_domain = $3, " +
      "ashby_api_key_ciphertext = $4, selected_job_ids = $5, setup_status = 'pending_webhook', " +
      "connected_at = NULL, last_ping_at = NULL, last_sync_at = NULL, updated_at = now() " +
      "WHERE integration_id = (SELECT integration_id FROM target) " +
      "RETURNING integration_id, false AS identity_conflict" +
      "), inserted AS (" +
      "INSERT INTO ashby_company_integrations " +
      "(integration_id, organization_id, email_domain, ashby_api_key_ciphertext, selected_job_ids) " +
      "SELECT $1, $2, $3, $4, $5 " +
      "WHERE NOT EXISTS (SELECT 1 FROM matching_integrations) " +
      "RETURNING integration_id, false AS identity_conflict" +
      ") SELECT integration_id, identity_conflict FROM updated " +
      "UNION ALL SELECT integration_id, identity_conflict FROM inserted",
    params: [
      integrationId,
      input.organizationId,
      normalizeEmailDomain(input.emailDomain),
      input.ashbyApiKeyCiphertext,
      [...input.selectedJobIds],
    ],
  };
}

export function integrationIdentityLockStatement(input: {
  readonly organizationId: string;
  readonly emailDomain: string;
}): SqlStatement {
  return {
    sql: "SELECT pg_advisory_xact_lock(hashtextextended($1, 1))",
    params: [input.organizationId],
  };
}

export function integrationApiKeyUpsertStatement(input: {
  readonly organizationId: string;
  readonly emailDomain: string;
  readonly reviewerEmail: string;
  readonly ashbyApiKeyCiphertext: string;
  readonly ashbyWebhookSecretCiphertext: string;
  readonly integrationId?: string;
}): SqlStatement {
  const integrationId = input.integrationId ?? randomUUID();
  return {
    sql:
      "WITH matching_integrations AS (" +
      "SELECT integration_id, organization_id FROM ashby_company_integrations " +
      "WHERE organization_id = $2 " +
      "FOR UPDATE" +
      "), target AS (" +
      "SELECT integration_id FROM matching_integrations ORDER BY integration_id LIMIT 1" +
      "), updated AS (" +
      "UPDATE ashby_company_integrations SET " +
      "email_domain = $3, " +
      "ashby_api_key_ciphertext = $4, " +
      "ashby_webhook_secret_ciphertext = $5, " +
      "setup_status = $6, connected_at = NULL, last_ping_at = NULL, last_sync_at = NULL, " +
      "updated_by_email = $7, updated_at = now() " +
      "WHERE integration_id = (SELECT integration_id FROM target) " +
      "RETURNING integration_id, ashby_webhook_secret_ciphertext, false AS identity_conflict" +
      "), inserted AS (" +
      "INSERT INTO ashby_company_integrations " +
      "(integration_id, organization_id, email_domain, ashby_api_key_ciphertext, ashby_webhook_secret_ciphertext, setup_status, created_by_email, updated_by_email) " +
      "SELECT $1, $2, $3, $4, $5, $6, $7, $7 " +
      "WHERE NOT EXISTS (SELECT 1 FROM matching_integrations) " +
      "RETURNING integration_id, ashby_webhook_secret_ciphertext, false AS identity_conflict" +
      ") SELECT integration_id, ashby_webhook_secret_ciphertext, identity_conflict FROM updated " +
      "UNION ALL SELECT integration_id, ashby_webhook_secret_ciphertext, identity_conflict FROM inserted",
    params: [
      integrationId,
      input.organizationId,
      normalizeEmailDomain(input.emailDomain),
      input.ashbyApiKeyCiphertext,
      input.ashbyWebhookSecretCiphertext,
      "job_selection_pending",
      input.reviewerEmail,
    ],
  };
}

export function integrationJobsUpdateStatement(input: {
  readonly integrationId: string;
  readonly selectedJobIds: readonly string[];
  readonly reviewerEmail: string;
}): SqlStatement {
  return {
    sql:
      "UPDATE ashby_company_integrations SET selected_job_ids = $2, setup_status = 'pending_webhook', " +
      "connected_at = NULL, last_ping_at = NULL, last_sync_at = NULL, " +
      "updated_by_email = $3, updated_at = now() WHERE integration_id = $1 " +
      "RETURNING integration_id, email_domain, ashby_webhook_secret_ciphertext, selected_job_ids",
    params: [input.integrationId, [...input.selectedJobIds], input.reviewerEmail],
  };
}

export function integrationSecretLookupStatement(integrationId: string): SqlStatement {
  return {
    sql:
      "SELECT integration_id, email_domain, ashby_api_key_ciphertext, ashby_webhook_secret_ciphertext, selected_job_ids " +
      "FROM ashby_company_integrations WHERE integration_id = $1 LIMIT 1",
    params: [integrationId],
  };
}

export function ashbyIntegrationAuditInsertStatement(input: {
  readonly integrationId: string;
  readonly actorEmail: string;
  readonly action: AshbyIntegrationAuditAction;
  readonly metadata?: Record<string, unknown>;
}): SqlStatement {
  return {
    sql:
      "INSERT INTO ashby_integration_audit_events " +
      "(integration_id, actor_email, action, metadata) VALUES ($1, $2, $3, $4::jsonb)",
    params: [
      input.integrationId,
      input.actorEmail,
      input.action,
      jsonParam(input.metadata ?? {}),
    ],
  };
}

export function markIntegrationSyncedStatement(integrationId: string): SqlStatement {
  return {
    sql: "UPDATE ashby_company_integrations SET last_sync_at = now(), updated_at = now() WHERE integration_id = $1",
    params: [integrationId],
  };
}

export function markIntegrationPingStatement(integrationId: string): SqlStatement {
  return {
    sql:
      "UPDATE ashby_company_integrations " +
      "SET connected_at = COALESCE(connected_at, now()), last_ping_at = now(), setup_status = 'connected', updated_at = now() " +
      "WHERE integration_id = $1",
    params: [integrationId],
  };
}

export function webhookEventInsertStatement(input: {
  readonly webhookActionId: string;
  readonly integrationId: string | null;
  readonly action: string;
  readonly payload: unknown;
}): SqlStatement {
  return {
    sql:
      "WITH inserted AS (" +
      "INSERT INTO ashby_webhook_events (webhook_action_id, integration_id, action, payload) " +
      "VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (webhook_action_id) DO NOTHING " +
      "RETURNING true AS inserted, processed_at" +
      ") SELECT inserted, processed_at FROM inserted " +
      "UNION ALL " +
      "SELECT false AS inserted, processed_at FROM ashby_webhook_events " +
      "WHERE webhook_action_id = $1 AND NOT EXISTS (SELECT 1 FROM inserted)",
    params: [input.webhookActionId, input.integrationId, input.action, jsonParam(input.payload)],
  };
}

export function webhookEventProcessedStatement(webhookActionId: string): SqlStatement {
  return {
    sql: "UPDATE ashby_webhook_events SET processed_at = now() WHERE webhook_action_id = $1",
    params: [webhookActionId],
  };
}

export function activeApplicationUpsertStatement(input: SyncedAshbyApplication): SqlStatement {
  return {
    sql:
      "INSERT INTO ashby_applications " +
      "(application_id, integration_id, candidate_id, candidate_name, candidate_email, job_id, current_stage, source, status, ashby_updated_at, raw_payload) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::jsonb) " +
      "ON CONFLICT (integration_id, application_id) DO UPDATE SET " +
      "candidate_id = EXCLUDED.candidate_id, candidate_name = EXCLUDED.candidate_name, " +
      "candidate_email = EXCLUDED.candidate_email, job_id = EXCLUDED.job_id, current_stage = EXCLUDED.current_stage, source = EXCLUDED.source, " +
      "status = EXCLUDED.status, ashby_updated_at = EXCLUDED.ashby_updated_at, raw_payload = EXCLUDED.raw_payload, updated_at = now()",
    params: [
      input.applicationId,
      input.integrationId,
      input.candidateId,
      input.candidateName,
      input.candidateEmail,
      input.jobId,
      input.currentStage,
      input.source,
      input.status,
      input.ashbyUpdatedAt,
      jsonParam(input.rawPayload),
    ],
  };
}

export function inactiveCandidateApplicationsStatement(input: {
  readonly integrationId: string;
  readonly candidateId: string;
  readonly status: string;
}): SqlStatement {
  return {
    sql:
      "UPDATE ashby_applications SET status = $3, updated_at = now() " +
      "WHERE integration_id = $1 AND candidate_id = $2",
    params: [input.integrationId, input.candidateId, input.status],
  };
}

export function staleActiveApplicationsStatement(integrationId: string): SqlStatement {
  return {
    sql:
      "UPDATE ashby_applications SET status = $2, updated_at = now() " +
      "WHERE integration_id = $1 AND status = 'Active'",
    params: [integrationId, "Stale"],
  };
}

export function searchActiveApplicationsStatement(input: {
  readonly integrationId: string;
  readonly jobId?: string | null;
  readonly query: string;
  readonly limit: number;
}): SqlStatement {
  return {
    sql:
      "SELECT application_id, candidate_id, candidate_name, candidate_email, job_id, current_stage, source, status " +
      "FROM ashby_applications WHERE integration_id = $1 AND status = 'Active' " +
      "AND ($2::text IS NULL OR job_id = $2) " +
      "AND ($3::text = '' OR lower(candidate_name) LIKE '%' || lower($3) || '%' OR lower(COALESCE(candidate_email, '')) LIKE '%' || lower($3) || '%') " +
      "ORDER BY updated_at DESC LIMIT $4",
    params: [input.integrationId, input.jobId ?? null, input.query.trim(), input.limit],
  };
}

export function activeApplicationForJobStatement(input: {
  readonly integrationId: string;
  readonly applicationId: string;
  readonly jobId: string;
}): SqlStatement {
  return {
    sql:
      "SELECT application_id FROM ashby_applications " +
      "WHERE integration_id = $1 AND application_id = $2 AND job_id = $3 AND status = 'Active' LIMIT 1",
    params: [input.integrationId, input.applicationId, input.jobId],
  };
}

export function scoreUpsertStatement(input: ScoreInput & { readonly integrationId: string }): SqlStatement {
  assertScoreValue("problemSolving", input.problemSolving);
  assertScoreValue("agency", input.agency);
  assertScoreValue("competitiveness", input.competitiveness);
  assertScoreValue("curiosity", input.curiosity);

  const total = input.problemSolving + input.agency + input.competitiveness + input.curiosity;
  return {
    sql:
      "INSERT INTO ashby_candidate_scores " +
      "(score_id, integration_id, application_id, role_id, reviewer_email, problem_solving, agency, competitiveness, curiosity, total_score, comments) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) " +
      "ON CONFLICT (integration_id, application_id, reviewer_email) DO UPDATE SET " +
      "role_id = EXCLUDED.role_id, problem_solving = EXCLUDED.problem_solving, agency = EXCLUDED.agency, " +
      "competitiveness = EXCLUDED.competitiveness, curiosity = EXCLUDED.curiosity, total_score = EXCLUDED.total_score, " +
      "comments = EXCLUDED.comments, updated_at = now() RETURNING score_id, total_score",
    params: [
      randomUUID(),
      input.integrationId,
      input.applicationId,
      input.roleId,
      input.reviewerEmail,
      input.problemSolving,
      input.agency,
      input.competitiveness,
      input.curiosity,
      total,
      input.comments,
    ],
  };
}

export function recentScreensStatement(input: {
  readonly integrationId: string;
  readonly limit: number;
}): SqlStatement {
  return {
    sql:
      "SELECT s.score_id, s.application_id, s.role_id, s.reviewer_email, s.problem_solving, s.agency, " +
      "s.competitiveness, s.curiosity, s.total_score, s.comments, s.updated_at, " +
      "a.candidate_name, a.candidate_email, a.job_id, a.current_stage, a.status " +
      "FROM ashby_candidate_scores s JOIN ashby_applications a " +
      "ON a.integration_id = s.integration_id AND a.application_id = s.application_id " +
      "WHERE s.integration_id = $1 ORDER BY s.updated_at DESC LIMIT $2",
    params: [input.integrationId, input.limit],
  };
}
