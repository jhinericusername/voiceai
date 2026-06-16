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

export function recommendationUpsertStatement(input: RecommendationInput): SqlStatement {
  return {
    sql:
      "INSERT INTO interview_recommendations " +
      "(recommendation_id, session_id, organization_id, ashby_job_id, rubric_version_id, " +
      "source, recommendation, confidence, category_scores, evidence, warnings, model_metadata) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb) " +
      "ON CONFLICT (session_id, rubric_version_id) DO UPDATE SET " +
      "source = EXCLUDED.source, " +
      "recommendation = EXCLUDED.recommendation, " +
      "confidence = EXCLUDED.confidence, " +
      "category_scores = EXCLUDED.category_scores, " +
      "evidence = EXCLUDED.evidence, " +
      "warnings = EXCLUDED.warnings, " +
      "model_metadata = EXCLUDED.model_metadata, " +
      "created_at = now() " +
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
      jsonParam(input.warnings),
      jsonParam(input.modelMetadata),
    ],
  };
}

export function reviewerFeedbackInsertStatement(input: ReviewerFeedbackInput): SqlStatement {
  return {
    sql:
      "INSERT INTO reviewer_feedback " +
      "(feedback_id, recommendation_id, session_id, organization_id, reviewer_email, " +
      "reviewer_decision, override_reason, dimension_feedback) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) " +
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
