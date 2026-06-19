import type { SqlStatement } from "../consent/repository.js";
import type {
  GradingProfileInput,
  RecommendationInput,
  ReviewerFeedbackInput,
  RubricVersionInput,
} from "./types.js";

function jsonParam(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function gradingProfileUpsertStatement(input: GradingProfileInput): SqlStatement {
  return {
    sql:
      "INSERT INTO role_grading_profiles " +
      "(profile_id, organization_id, ashby_integration_id, ashby_job_id, status, " +
      "created_by_email, updated_by_email) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7) " +
      "ON CONFLICT (organization_id, ashby_job_id) DO UPDATE SET " +
      "ashby_integration_id = EXCLUDED.ashby_integration_id, " +
      "updated_by_email = EXCLUDED.updated_by_email, " +
      "updated_at = now() " +
      "RETURNING *",
    params: [
      input.profileId,
      input.organizationId,
      input.ashbyIntegrationId,
      input.ashbyJobId,
      "draft_needed",
      input.actorEmail,
      input.actorEmail,
    ],
  };
}

export function gradingProfilesForIntegrationStatement(
  organizationId: string,
  ashbyIntegrationId: string,
): SqlStatement {
  return {
    sql:
      "SELECT * FROM role_grading_profiles " +
      "WHERE organization_id = $1 AND ashby_integration_id = $2 " +
      "ORDER BY created_at ASC",
    params: [organizationId, ashbyIntegrationId],
  };
}

export function gradingProfilesForOrganizationStatement(organizationId: string): SqlStatement {
  return {
    sql:
      "SELECT p.*, active.rubric AS active_rubric, draft.rubric AS draft_rubric " +
      "FROM role_grading_profiles p " +
      "LEFT JOIN role_rubric_versions active ON active.rubric_version_id = p.active_rubric_version_id " +
      "LEFT JOIN role_rubric_versions draft ON draft.rubric_version_id = p.draft_rubric_version_id " +
      "WHERE p.organization_id = $1 ORDER BY p.created_at ASC",
    params: [organizationId],
  };
}

export function gradingProfileByIdForUpdateStatement(profileId: string, organizationId: string): SqlStatement {
  return {
    sql:
      "SELECT * FROM role_grading_profiles " +
      "WHERE profile_id = $1 AND organization_id = $2 FOR UPDATE",
    params: [profileId, organizationId],
  };
}

export function gradingProfileDraftUpdateStatement(input: {
  readonly profileId: string;
  readonly draftRubricVersionId: string;
  readonly actorEmail: string;
}): SqlStatement {
  return {
    sql:
      "UPDATE role_grading_profiles SET status = 'draft_ready', draft_rubric_version_id = $2, " +
      "updated_by_email = $3, updated_at = now() WHERE profile_id = $1 RETURNING *",
    params: [input.profileId, input.draftRubricVersionId, input.actorEmail],
  };
}

export function nextRubricVersionStatement(profileId: string): SqlStatement {
  return {
    sql:
      "SELECT COALESCE(MAX(version), 0) + 1 AS next_version " +
      "FROM role_rubric_versions WHERE profile_id = $1",
    params: [profileId],
  };
}

export function rubricVersionInsertStatement(input: RubricVersionInput): SqlStatement {
  return {
    sql:
      "INSERT INTO role_rubric_versions " +
      "(rubric_version_id, profile_id, organization_id, ashby_job_id, version, status, " +
      "approved_by_email, rubric, generation_inputs, approved_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::timestamptz) " +
      "RETURNING *",
    params: [
      input.rubricVersionId,
      input.profileId,
      input.organizationId,
      input.ashbyJobId,
      input.version,
      input.status,
      input.approvedByEmail ?? null,
      jsonParam(input.rubric),
      jsonParam(input.generationInputs),
      input.approvedAt ?? null,
    ],
  };
}

export function rubricVersionApproveStatement(input: {
  readonly rubricVersionId: string;
  readonly profileId: string;
  readonly organizationId: string;
  readonly rubric: unknown;
  readonly approvedByEmail: string;
}): SqlStatement {
  return {
    sql:
      "UPDATE role_rubric_versions SET status = 'approved', rubric = $4::jsonb, " +
      "approved_by_email = $5, approved_at = now() " +
      "WHERE rubric_version_id = $1 AND profile_id = $2 AND organization_id = $3 AND status = 'draft' RETURNING *",
    params: [
      input.rubricVersionId,
      input.profileId,
      input.organizationId,
      jsonParam(input.rubric),
      input.approvedByEmail,
    ],
  };
}

export function gradingProfileActivateStatement(input: {
  readonly profileId: string;
  readonly organizationId: string;
  readonly activeRubricVersionId: string;
  readonly actorEmail: string;
}): SqlStatement {
  return {
    sql:
      "UPDATE role_grading_profiles SET status = 'recommendations_active', active_rubric_version_id = $3, " +
      "draft_rubric_version_id = NULL, updated_by_email = $4, updated_at = now() " +
      "WHERE profile_id = $1 AND organization_id = $2 RETURNING *",
    params: [input.profileId, input.organizationId, input.activeRubricVersionId, input.actorEmail],
  };
}

export function recommendationUpsertStatement(input: RecommendationInput): SqlStatement {
  return {
    sql:
      "INSERT INTO interview_recommendations " +
      "(recommendation_id, session_id, organization_id, ashby_job_id, rubric_version_id, " +
      "source, recommendation, confidence, category_scores, evidence, scorecard_json, warnings, model_metadata) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb) " +
      "ON CONFLICT (session_id, rubric_version_id) DO UPDATE SET " +
      "source = EXCLUDED.source, " +
      "recommendation = EXCLUDED.recommendation, " +
      "confidence = EXCLUDED.confidence, " +
      "category_scores = EXCLUDED.category_scores, " +
      "evidence = EXCLUDED.evidence, " +
      "scorecard_json = EXCLUDED.scorecard_json, " +
      "warnings = EXCLUDED.warnings, " +
      "model_metadata = EXCLUDED.model_metadata, " +
      "updated_at = now() " +
      "WHERE interview_recommendations.organization_id = EXCLUDED.organization_id " +
      "AND interview_recommendations.ashby_job_id = EXCLUDED.ashby_job_id " +
      "RETURNING *",
    params: [
      input.recommendationId,
      input.sessionId,
      input.organizationId,
      input.ashbyJobId,
      input.rubricVersionId,
      input.source,
      input.recommendation,
      input.confidence,
      jsonParam(input.categoryScores),
      jsonParam(input.evidence),
      jsonParam(input.scorecardJson),
      jsonParam(input.warnings),
      jsonParam(input.modelMetadata),
    ],
  };
}

export function sessionForRecommendationStatement(sessionId: string, organizationId: string): SqlStatement {
  return {
    sql:
      "SELECT s.session_id, s.org_id, s.external_source, s.source_metadata, " +
      "COALESCE(s.source_metadata #>> '{ashby,selected,jobId}', s.source_metadata #>> '{ashby,selected,ashbyJobId}') AS ashby_job_id " +
      "FROM sessions s WHERE s.session_id = $1 AND s.org_id = $2 LIMIT 1",
    params: [sessionId, organizationId],
  };
}

export function transcriptTurnsForSessionStatement(sessionId: string): SqlStatement {
  return {
    sql:
      "SELECT turn_index AS \"turnIndex\", speaker, text " +
      "FROM transcript_turns WHERE session_id = $1 ORDER BY turn_index ASC",
    params: [sessionId],
  };
}

export function activeRubricForJobStatement(organizationId: string, ashbyJobId: string): SqlStatement {
  return {
    sql:
      "SELECT p.profile_id, p.active_rubric_version_id, r.rubric " +
      "FROM role_grading_profiles p " +
      "JOIN role_rubric_versions r ON r.rubric_version_id = p.active_rubric_version_id " +
      "WHERE p.organization_id = $1 AND p.ashby_job_id = $2 AND p.status = 'recommendations_active' " +
      "LIMIT 1",
    params: [organizationId, ashbyJobId],
  };
}

export function historicalBackfillSessionsStatement(
  organizationId: string,
  ashbyJobId: string,
  limit: number,
): SqlStatement {
  return {
    sql:
      "SELECT s.session_id FROM sessions s " +
      "LEFT JOIN interview_recommendations rec ON rec.session_id = s.session_id " +
      "WHERE s.org_id = $1 AND s.external_source = 'fireflies' " +
      "AND COALESCE(s.source_metadata #>> '{ashby,selected,jobId}', s.source_metadata #>> '{ashby,selected,ashbyJobId}') = $2 " +
      "AND rec.recommendation_id IS NULL " +
      "ORDER BY s.started_at DESC NULLS LAST LIMIT $3",
    params: [organizationId, ashbyJobId, limit],
  };
}

export function reviewerFeedbackInsertStatement(input: ReviewerFeedbackInput): SqlStatement {
  return {
    sql:
      "INSERT INTO reviewer_feedback " +
      "(feedback_id, recommendation_id, session_id, organization_id, reviewer_email, " +
      "reviewer_decision, override_reason, dimension_feedback) " +
      "SELECT $1, rec.recommendation_id, rec.session_id, rec.organization_id, $5, $6, $7, $8::jsonb " +
      "FROM interview_recommendations rec " +
      "WHERE rec.recommendation_id = $2 AND rec.session_id = $3 AND rec.organization_id = $4 " +
      "RETURNING *",
    params: [
      input.feedbackId,
      input.recommendationId,
      input.sessionId,
      input.organizationId,
      input.reviewerEmail,
      input.reviewerDecision,
      input.overrideReason,
      jsonParam(input.dimensionFeedback),
    ],
  };
}
