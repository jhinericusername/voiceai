import { createHash } from "node:crypto";
import type { SqlStatement } from "../../consent/repository.js";

export const WEAVE_IMPORT_ACTOR_EMAIL = "weave-import@puddle.system";

export interface ImportedApplicationInput {
  readonly applicationId: string;
  readonly integrationId: string;
  readonly candidateId: string;
  readonly candidateName: string;
  readonly candidateEmail: string | null;
  readonly jobId: string;
  readonly ashbyUpdatedAt: string | null;
  readonly rawPayload: unknown;
}

export interface WeaveRoleProfileInput {
  readonly profileId: string;
  readonly organizationId: string;
  readonly integrationId: string;
  readonly ashbyJobId: string;
}

export interface ImportedScoreInput {
  readonly scoreId: string;
  readonly integrationId: string;
  readonly applicationId: string;
  readonly roleId: string;
  readonly reviewerEmail: string;
  readonly problemSolving: number;
  readonly agency: number;
  readonly competitiveness: number;
  readonly curiosity: number;
  readonly comments: string;
}

export interface ProvenanceInput {
  readonly sourceEvaluationId: string;
  readonly organizationId: string;
  readonly integrationId: string;
  readonly applicationId: string;
  readonly ashbyCandidateId: string | null;
  readonly ashbyJobId: string;
  readonly roleProfileId: string | null;
  readonly scoreId: string | null;
  readonly sourceCreatedAt: string | null;
  readonly sourceUpdatedAt: string | null;
  readonly sourcePayloadHash: string;
  readonly lastEventId: string;
  readonly syncStatus: "synced" | "failed";
  readonly syncError: string | null;
}

export function stableTargetId(prefix: string, sourceId: string): string {
  return `${prefix}_${createHash("sha256").update(sourceId).digest("hex").slice(0, 32)}`;
}

export function weaveIntegrationForOrganizationStatement(organizationId: string): SqlStatement {
  return {
    sql:
      "SELECT integration_id, organization_id FROM ashby_company_integrations " +
      "WHERE organization_id = $1 LIMIT 1 FOR UPDATE",
    params: [organizationId],
  };
}

export function weaveEvaluationImportLockStatement(sourceEvaluationId: string): SqlStatement {
  return {
    sql: "SELECT pg_advisory_xact_lock(hashtextextended($1, 2))",
    params: [sourceEvaluationId],
  };
}

export function importedApplicationUpsertStatement(input: ImportedApplicationInput): SqlStatement {
  return {
    sql:
      "INSERT INTO ashby_applications " +
      "(application_id, integration_id, candidate_id, candidate_name, candidate_email, job_id, current_stage, source, status, ashby_updated_at, raw_payload) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::jsonb) " +
      "ON CONFLICT (integration_id, application_id) DO UPDATE SET " +
      "candidate_id = COALESCE(NULLIF(ashby_applications.candidate_id, ''), EXCLUDED.candidate_id), " +
      "candidate_name = COALESCE(NULLIF(ashby_applications.candidate_name, ''), EXCLUDED.candidate_name), " +
      "candidate_email = COALESCE(ashby_applications.candidate_email, EXCLUDED.candidate_email), " +
      "job_id = EXCLUDED.job_id, " +
      "current_stage = COALESCE(ashby_applications.current_stage, EXCLUDED.current_stage), " +
      "source = COALESCE(ashby_applications.source, EXCLUDED.source), " +
      "status = CASE WHEN ashby_applications.status = 'Active' THEN ashby_applications.status ELSE EXCLUDED.status END, " +
      "ashby_updated_at = GREATEST(COALESCE(ashby_applications.ashby_updated_at, EXCLUDED.ashby_updated_at), EXCLUDED.ashby_updated_at), " +
      "raw_payload = ashby_applications.raw_payload || jsonb_build_object('weaveCandidateEvaluation', EXCLUDED.raw_payload), " +
      "updated_at = now() " +
      "RETURNING application_id",
    params: [
      input.applicationId,
      input.integrationId,
      input.candidateId,
      input.candidateName,
      input.candidateEmail,
      input.jobId,
      "Weave evaluation",
      "Weave Supabase",
      "ImportedEvaluation",
      input.ashbyUpdatedAt,
      jsonParam(input.rawPayload),
    ],
  };
}

export function weaveRoleProfileUpsertStatement(input: WeaveRoleProfileInput): SqlStatement {
  return {
    sql:
      "INSERT INTO role_grading_profiles " +
      "(profile_id, organization_id, ashby_integration_id, ashby_job_id, status, created_by_email, updated_by_email) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7) " +
      "ON CONFLICT (organization_id, ashby_job_id) DO UPDATE SET " +
      "ashby_integration_id = EXCLUDED.ashby_integration_id, " +
      "updated_by_email = EXCLUDED.updated_by_email, " +
      "updated_at = now() " +
      "RETURNING profile_id",
    params: [
      input.profileId,
      input.organizationId,
      input.integrationId,
      input.ashbyJobId,
      "draft_needed",
      WEAVE_IMPORT_ACTOR_EMAIL,
      WEAVE_IMPORT_ACTOR_EMAIL,
    ],
  };
}

export function importedScoreUpsertStatement(input: ImportedScoreInput): SqlStatement {
  const totalScore =
    input.problemSolving + input.agency + input.competitiveness + input.curiosity;

  return {
    sql:
      "INSERT INTO ashby_candidate_scores " +
      "(score_id, integration_id, application_id, role_id, reviewer_email, problem_solving, agency, competitiveness, curiosity, total_score, comments) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) " +
      "ON CONFLICT (integration_id, application_id, reviewer_email) DO UPDATE SET " +
      "role_id = EXCLUDED.role_id, " +
      "problem_solving = EXCLUDED.problem_solving, " +
      "agency = EXCLUDED.agency, " +
      "competitiveness = EXCLUDED.competitiveness, " +
      "curiosity = EXCLUDED.curiosity, " +
      "total_score = EXCLUDED.total_score, " +
      "comments = EXCLUDED.comments, " +
      "updated_at = now() " +
      "RETURNING score_id, total_score",
    params: [
      input.scoreId,
      input.integrationId,
      input.applicationId,
      input.roleId,
      input.reviewerEmail,
      input.problemSolving,
      input.agency,
      input.competitiveness,
      input.curiosity,
      totalScore,
      input.comments,
    ],
  };
}

export function provenanceUpsertStatement(input: ProvenanceInput): SqlStatement {
  return {
    sql:
      "INSERT INTO weave_candidate_evaluation_imports " +
      "(source_evaluation_id, organization_id, integration_id, application_id, ashby_candidate_id, ashby_job_id, role_profile_id, score_id, " +
      "source_created_at, source_updated_at, source_payload_hash, last_event_id, last_synced_at, sync_status, sync_error) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11, $12, now(), $13, $14) " +
      "ON CONFLICT (source_evaluation_id) DO UPDATE SET " +
      "organization_id = EXCLUDED.organization_id, " +
      "integration_id = EXCLUDED.integration_id, " +
      "application_id = EXCLUDED.application_id, " +
      "ashby_candidate_id = EXCLUDED.ashby_candidate_id, " +
      "ashby_job_id = EXCLUDED.ashby_job_id, " +
      "role_profile_id = EXCLUDED.role_profile_id, " +
      "score_id = EXCLUDED.score_id, " +
      "source_created_at = EXCLUDED.source_created_at, " +
      "source_updated_at = EXCLUDED.source_updated_at, " +
      "source_payload_hash = EXCLUDED.source_payload_hash, " +
      "last_event_id = EXCLUDED.last_event_id, " +
      "last_synced_at = now(), " +
      "sync_status = EXCLUDED.sync_status, " +
      "sync_error = EXCLUDED.sync_error, " +
      "updated_at = now() " +
      "WHERE weave_candidate_evaluation_imports.source_updated_at IS NULL " +
      "OR (EXCLUDED.source_updated_at IS NOT NULL " +
      "AND EXCLUDED.source_updated_at >= weave_candidate_evaluation_imports.source_updated_at) " +
      "RETURNING source_evaluation_id",
    params: [
      input.sourceEvaluationId,
      input.organizationId,
      input.integrationId,
      input.applicationId,
      input.ashbyCandidateId,
      input.ashbyJobId,
      input.roleProfileId,
      input.scoreId,
      input.sourceCreatedAt,
      input.sourceUpdatedAt,
      input.sourcePayloadHash,
      input.lastEventId,
      input.syncStatus,
      input.syncError,
    ],
  };
}

export function existingImportForUpdateStatement(sourceEvaluationId: string): SqlStatement {
  return {
    sql:
      "SELECT source_updated_at, score_id, application_id FROM weave_candidate_evaluation_imports " +
      "WHERE source_evaluation_id = $1 FOR UPDATE",
    params: [sourceEvaluationId],
  };
}

export function importedEvaluationForApplicationStatement(
  integrationId: string,
  applicationId: string,
): SqlStatement {
  return {
    sql:
      "SELECT imp.source_evaluation_id AS \"candidateEvaluationId\", " +
      "imp.organization_id AS \"organizationId\", " +
      "imp.integration_id AS \"integrationId\", " +
      "imp.application_id AS \"applicationId\", " +
      "imp.ashby_candidate_id AS \"ashbyCandidateId\", " +
      "imp.ashby_job_id AS \"ashbyJobId\", " +
      "imp.role_profile_id AS \"roleProfileId\", " +
      "imp.score_id AS \"scoreId\", " +
      "imp.source_created_at AS \"sourceCreatedAt\", " +
      "imp.source_updated_at AS \"sourceUpdatedAt\", " +
      "imp.last_synced_at AS \"lastSyncedAt\", " +
      "sc.problem_solving AS \"problemSolving\", " +
      "sc.agency, sc.competitiveness, sc.curiosity, " +
      "sc.total_score AS \"totalScore\", sc.comments " +
      "FROM weave_candidate_evaluation_imports imp " +
      "JOIN ashby_candidate_scores sc ON sc.score_id = imp.score_id " +
      "WHERE imp.integration_id = $1 AND imp.application_id = $2 " +
      "ORDER BY imp.source_updated_at DESC NULLS LAST, imp.last_synced_at DESC LIMIT 1",
    params: [integrationId, applicationId],
  };
}

export function importedEvaluationForSessionStatement(
  sessionId: string,
  orgId: string,
): SqlStatement {
  return {
    sql:
      "SELECT imp.source_evaluation_id AS \"candidateEvaluationId\", " +
      "imp.organization_id AS \"organizationId\", " +
      "imp.integration_id AS \"integrationId\", " +
      "imp.application_id AS \"applicationId\", " +
      "imp.ashby_candidate_id AS \"ashbyCandidateId\", " +
      "imp.ashby_job_id AS \"ashbyJobId\", " +
      "imp.role_profile_id AS \"roleProfileId\", " +
      "imp.score_id AS \"scoreId\", " +
      "imp.source_created_at AS \"sourceCreatedAt\", " +
      "imp.source_updated_at AS \"sourceUpdatedAt\", " +
      "imp.last_synced_at AS \"lastSyncedAt\", " +
      "sc.problem_solving AS \"problemSolving\", " +
      "sc.agency, sc.competitiveness, sc.curiosity, " +
      "sc.total_score AS \"totalScore\", sc.comments " +
      "FROM sessions sess " +
      "JOIN weave_candidate_evaluation_imports imp ON imp.organization_id = sess.org_id " +
      "AND (imp.source_evaluation_id = NULLIF(sess.source_metadata #>> '{ashby,selected,candidateEvaluationId}', '') " +
      "OR (NULLIF(sess.source_metadata #>> '{ashby,selected,candidateEvaluationId}', '') IS NULL " +
      "AND imp.application_id = NULLIF(sess.source_metadata #>> '{ashby,selected,applicationId}', ''))) " +
      "JOIN ashby_candidate_scores sc ON sc.score_id = imp.score_id " +
      "WHERE sess.session_id = $1 AND sess.org_id = $2 " +
      "ORDER BY imp.source_updated_at DESC NULLS LAST, imp.last_synced_at DESC LIMIT 1",
    params: [sessionId, orgId],
  };
}

function jsonParam(value: unknown): string {
  return JSON.stringify(value ?? null);
}
