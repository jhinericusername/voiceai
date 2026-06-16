import { describe, expect, it } from "vitest";
import {
  activeRubricForJobStatement,
  gradingProfileActivateStatement,
  gradingProfileByIdForUpdateStatement,
  gradingProfileUpsertStatement,
  gradingProfilesForIntegrationStatement,
  historicalBackfillSessionsStatement,
  nextRubricVersionStatement,
  recommendationUpsertStatement,
  reviewerFeedbackInsertStatement,
  rubricVersionApproveStatement,
  rubricVersionInsertStatement,
  sessionForRecommendationStatement,
  transcriptTurnsForSessionStatement,
} from "../src/grading/repository.js";

describe("grading repository", () => {
  it("upserts one profile per organization and Ashby job", () => {
    const stmt = gradingProfileUpsertStatement({
      profileId: "profile_1",
      organizationId: "org_1",
      ashbyIntegrationId: "int_1",
      ashbyJobId: "job_1",
      actorEmail: "admin@example.com",
    });

    expect(stmt.sql).toContain("INSERT INTO role_grading_profiles");
    expect(stmt.sql).toContain("ON CONFLICT (organization_id, ashby_job_id) DO UPDATE");
    expect(stmt.sql).toContain("RETURNING *");
    expect(stmt.params).toEqual([
      "profile_1",
      "org_1",
      "int_1",
      "job_1",
      "draft_needed",
      "admin@example.com",
      "admin@example.com",
    ]);
  });

  it("lists profiles for an Ashby integration", () => {
    const stmt = gradingProfilesForIntegrationStatement("org_1", "int_1");

    expect(stmt.sql).toContain("FROM role_grading_profiles");
    expect(stmt.sql).toContain("organization_id = $1");
    expect(stmt.sql).toContain("ashby_integration_id = $2");
    expect(stmt.params).toEqual(["org_1", "int_1"]);
  });

  it("computes the next rubric version for a profile", () => {
    const stmt = nextRubricVersionStatement("profile_1");

    expect(stmt.sql).toContain("COALESCE(MAX(version), 0) + 1");
    expect(stmt.params).toEqual(["profile_1"]);
  });

  it("locks a grading profile by id and organization", () => {
    const stmt = gradingProfileByIdForUpdateStatement("profile_1", "org_1");

    expect(stmt.sql).toContain("FROM role_grading_profiles");
    expect(stmt.sql).toContain("WHERE profile_id = $1 AND organization_id = $2 FOR UPDATE");
    expect(stmt.params).toEqual(["profile_1", "org_1"]);
  });

  it("inserts rubric versions as JSONB", () => {
    const stmt = rubricVersionInsertStatement({
      rubricVersionId: "rv_1",
      profileId: "profile_1",
      organizationId: "org_1",
      ashbyJobId: "job_1",
      version: 1,
      status: "draft",
      rubric: { script_version: "job_1-v1" },
      generationInputs: { source: "weave" },
    });

    expect(stmt.sql).toContain("INSERT INTO role_rubric_versions");
    expect(stmt.sql).toContain("$8::jsonb");
    expect(stmt.sql).toContain("$9::jsonb");
    expect(stmt.sql).toContain("$10::timestamptz");
    expect(stmt.params[7]).toBe(JSON.stringify({ script_version: "job_1-v1" }));
    expect(stmt.params[8]).toBe(JSON.stringify({ source: "weave" }));
  });

  it("approves draft rubric versions with profile and organization scope while preserving edits", () => {
    const stmt = rubricVersionApproveStatement({
      rubricVersionId: "rv_1",
      profileId: "profile_1",
      organizationId: "org_1",
      rubric: { edited: true },
      approvedByEmail: "reviewer@example.com",
    });

    expect(stmt.sql).toContain("UPDATE role_rubric_versions");
    expect(stmt.sql).toContain("rubric = $4::jsonb");
    expect(stmt.sql).toContain("WHERE rubric_version_id = $1 AND profile_id = $2 AND organization_id = $3 AND status = 'draft'");
    expect(stmt.params).toEqual([
      "rv_1",
      "profile_1",
      "org_1",
      JSON.stringify({ edited: true }),
      "reviewer@example.com",
    ]);
  });

  it("activates grading profiles with organization scope", () => {
    const stmt = gradingProfileActivateStatement({
      profileId: "profile_1",
      organizationId: "org_1",
      activeRubricVersionId: "rv_1",
      actorEmail: "reviewer@example.com",
    });

    expect(stmt.sql).toContain("UPDATE role_grading_profiles");
    expect(stmt.sql).toContain("active_rubric_version_id = $3");
    expect(stmt.sql).toContain("WHERE profile_id = $1 AND organization_id = $2 RETURNING *");
    expect(stmt.params).toEqual(["profile_1", "org_1", "rv_1", "reviewer@example.com"]);
  });

  it("upserts recommendations by session and rubric version", () => {
    const stmt = recommendationUpsertStatement({
      recommendationId: "rec_1",
      sessionId: "sess_1",
      organizationId: "org_1",
      ashbyJobId: "job_1",
      rubricVersionId: "rv_1",
      source: "historical_fireflies",
      recommendation: "advance",
      confidence: 0.86,
      categoryScores: [{ category: "problem_solving", score: 4 }],
      evidence: [{ quote: "I shipped it" }],
      warnings: [],
      modelMetadata: { model: "fake" },
    });

    expect(stmt.sql).toContain("INSERT INTO interview_recommendations");
    expect(stmt.sql).toContain("ON CONFLICT (session_id, rubric_version_id) DO UPDATE");
    expect(stmt.sql).toContain("updated_at = now()");
    expect(stmt.sql).toContain(
      "WHERE interview_recommendations.organization_id = EXCLUDED.organization_id " +
        "AND interview_recommendations.ashby_job_id = EXCLUDED.ashby_job_id",
    );
    expect(stmt.sql).not.toContain("created_at = now()");
    expect(stmt.params[7]).toBe(0.86);
  });

  it("loads a scoped session for recommendation with Ashby job fallback metadata", () => {
    const stmt = sessionForRecommendationStatement("sess_1", "org_1");

    expect(stmt.sql).toContain("SELECT s.session_id, s.org_id, s.external_source, s.source_metadata");
    expect(stmt.sql).toContain("COALESCE(s.source_metadata #>> '{ashby,selected,jobId}'");
    expect(stmt.sql).toContain("s.source_metadata #>> '{ashby,selected,ashbyJobId}'");
    expect(stmt.sql).toContain("FROM sessions s WHERE s.session_id = $1 AND s.org_id = $2 LIMIT 1");
    expect(stmt.params).toEqual(["sess_1", "org_1"]);
  });

  it("loads ordered transcript turns for a session", () => {
    const stmt = transcriptTurnsForSessionStatement("sess_1");

    expect(stmt.sql).toContain("FROM transcript_turns");
    expect(stmt.sql).toContain("WHERE session_id = $1");
    expect(stmt.sql).toContain("ORDER BY turn_index ASC");
    expect(stmt.params).toEqual(["sess_1"]);
  });

  it("loads active rubric for a scoped Ashby job", () => {
    const stmt = activeRubricForJobStatement("org_1", "job_1");

    expect(stmt.sql).toContain("FROM role_grading_profiles p");
    expect(stmt.sql).toContain("JOIN role_rubric_versions r ON r.rubric_version_id = p.active_rubric_version_id");
    expect(stmt.sql).toContain("p.organization_id = $1 AND p.ashby_job_id = $2");
    expect(stmt.sql).toContain("p.status = 'recommendations_active'");
    expect(stmt.params).toEqual(["org_1", "job_1"]);
  });

  it("selects historical Fireflies sessions missing recommendations", () => {
    const stmt = historicalBackfillSessionsStatement("org_1", "job_1", 10);

    expect(stmt.sql).toContain("SELECT s.session_id FROM sessions s");
    expect(stmt.sql).toContain("LEFT JOIN interview_recommendations rec ON rec.session_id = s.session_id");
    expect(stmt.sql).toContain("s.external_source = 'fireflies'");
    expect(stmt.sql).toContain("rec.recommendation_id IS NULL");
    expect(stmt.sql).toContain("ORDER BY s.started_at DESC NULLS LAST LIMIT $3");
    expect(stmt.params).toEqual(["org_1", "job_1", 10]);
  });

  it("inserts reviewer feedback", () => {
    const stmt = reviewerFeedbackInsertStatement({
      feedbackId: "fb_1",
      recommendationId: "rec_1",
      sessionId: "sess_1",
      organizationId: "org_1",
      reviewerEmail: "reviewer@example.com",
      reviewerDecision: "hold",
      overrideReason: "Need hiring manager review.",
      dimensionFeedback: { agency: "Too high" },
    });

    expect(stmt.sql).toContain("INSERT INTO reviewer_feedback");
    expect(stmt.sql).toContain("reviewer_decision, override_reason, dimension_feedback");
    expect(stmt.params).toEqual([
      "fb_1",
      "rec_1",
      "sess_1",
      "org_1",
      "reviewer@example.com",
      "hold",
      "Need hiring manager review.",
      JSON.stringify({ agency: "Too high" }),
    ]);
  });
});
