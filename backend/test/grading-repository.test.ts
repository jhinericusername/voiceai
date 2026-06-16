import { describe, expect, it } from "vitest";
import {
  gradingProfileUpsertStatement,
  gradingProfilesForIntegrationStatement,
  nextRubricVersionStatement,
  recommendationUpsertStatement,
  reviewerFeedbackInsertStatement,
  rubricVersionInsertStatement,
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
    expect(stmt.sql).toContain("created_at = now()");
    expect(stmt.params[7]).toBe(0.86);
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
