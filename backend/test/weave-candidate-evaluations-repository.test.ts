import { describe, expect, it } from "vitest";
import {
  WEAVE_IMPORT_ACTOR_EMAIL,
  importedApplicationUpsertStatement,
  importedEvaluationForApplicationStatement,
  importedEvaluationForSessionStatement,
  importedScoreUpsertStatement,
  existingImportForUpdateStatement,
  provenanceUpsertStatement,
  weaveIntegrationForOrganizationStatement,
  weaveRoleProfileUpsertStatement,
} from "../src/weave/candidate-evaluations/repository.js";

describe("Weave candidate evaluation repository statements", () => {
  it("locks the Ashby integration for an organization", () => {
    const stmt = weaveIntegrationForOrganizationStatement("org_1");

    expect(stmt.sql).toContain("FROM ashby_company_integrations");
    expect(stmt.sql).toContain("WHERE organization_id = $1");
    expect(stmt.sql).toContain("LIMIT 1 FOR UPDATE");
    expect(stmt.params).toEqual(["org_1"]);
  });

  it("upserts an imported application without overwriting Active status", () => {
    const stmt = importedApplicationUpsertStatement({
      applicationId: "app_1",
      integrationId: "int_1",
      candidateId: "cand_1",
      candidateName: "Maya Chen",
      candidateEmail: null,
      jobId: "job_1",
      ashbyUpdatedAt: "2026-07-01T00:00:00.000Z",
      rawPayload: { id: "eval_1" },
    });

    expect(stmt.sql).toContain("INSERT INTO ashby_applications");
    expect(stmt.sql).toContain("ON CONFLICT (integration_id, application_id)");
    expect(stmt.sql).toContain(
      "status = CASE WHEN ashby_applications.status = 'Active' THEN ashby_applications.status ELSE EXCLUDED.status END",
    );
    expect(stmt.sql).toContain(
      "candidate_id = COALESCE(NULLIF(ashby_applications.candidate_id, ''), EXCLUDED.candidate_id)",
    );
    expect(stmt.sql).toContain(
      "candidate_name = COALESCE(NULLIF(ashby_applications.candidate_name, ''), EXCLUDED.candidate_name)",
    );
    expect(stmt.sql).toContain(
      "candidate_email = COALESCE(ashby_applications.candidate_email, EXCLUDED.candidate_email)",
    );
    expect(stmt.sql).toContain(
      "current_stage = COALESCE(ashby_applications.current_stage, EXCLUDED.current_stage)",
    );
    expect(stmt.sql).toContain("source = COALESCE(ashby_applications.source, EXCLUDED.source)");
    expect(stmt.sql).toContain(
      "ashby_updated_at = GREATEST(COALESCE(ashby_applications.ashby_updated_at, EXCLUDED.ashby_updated_at), EXCLUDED.ashby_updated_at)",
    );
    expect(stmt.sql).toContain(
      "raw_payload = ashby_applications.raw_payload || jsonb_build_object('weaveCandidateEvaluation', EXCLUDED.raw_payload)",
    );
    expect(stmt.params).toEqual([
      "app_1",
      "int_1",
      "cand_1",
      "Maya Chen",
      null,
      "job_1",
      "Weave evaluation",
      "Weave Supabase",
      "ImportedEvaluation",
      "2026-07-01T00:00:00.000Z",
      JSON.stringify({ id: "eval_1" }),
    ]);
  });

  it("upserts a draft-needed role grading profile for the imported role", () => {
    const stmt = weaveRoleProfileUpsertStatement({
      profileId: "role_1",
      organizationId: "org_1",
      integrationId: "int_1",
      ashbyJobId: "job_1",
    });

    expect(stmt.sql).toContain("INSERT INTO role_grading_profiles");
    expect(stmt.sql).toContain("ON CONFLICT (organization_id, ashby_job_id)");
    expect(stmt.sql).toContain("RETURNING profile_id");
    expect(stmt.params).toEqual([
      "role_1",
      "org_1",
      "int_1",
      "job_1",
      "draft_needed",
      WEAVE_IMPORT_ACTOR_EMAIL,
      WEAVE_IMPORT_ACTOR_EMAIL,
    ]);
  });

  it("upserts one imported score per source evaluation", () => {
    const stmt = importedScoreUpsertStatement({
      scoreId: "score_eval_1",
      integrationId: "int_1",
      applicationId: "app_1",
      roleId: "job_1",
      reviewerEmail: "weave-import+eval1@puddle.system",
      problemSolving: 3,
      agency: 4,
      competitiveness: 2.5,
      curiosity: 3.5,
      comments: "Good signal.",
    });

    expect(stmt.sql).toContain("INSERT INTO ashby_candidate_scores");
    expect(stmt.sql).toContain("ON CONFLICT (integration_id, application_id, reviewer_email)");
    expect(stmt.sql).toContain("RETURNING score_id, total_score");
    expect(stmt.params).toEqual([
      "score_eval_1",
      "int_1",
      "app_1",
      "job_1",
      "weave-import+eval1@puddle.system",
      3,
      4,
      2.5,
      3.5,
      13,
      "Good signal.",
    ]);
  });

  it("upserts source provenance without replacing newer source updates", () => {
    const stmt = provenanceUpsertStatement({
      sourceEvaluationId: "eval_1",
      organizationId: "org_1",
      integrationId: "int_1",
      applicationId: "app_1",
      ashbyCandidateId: "cand_1",
      ashbyJobId: "job_1",
      roleProfileId: "role_1",
      scoreId: "score_1",
      sourceCreatedAt: "2026-06-30T00:00:00.000Z",
      sourceUpdatedAt: "2026-07-01T00:00:00.000Z",
      sourcePayloadHash: "hash_1",
      lastEventId: "evt_1",
      syncStatus: "synced",
      syncError: null,
    });

    expect(stmt.sql).toContain("INSERT INTO weave_candidate_evaluation_imports");
    expect(stmt.sql).toContain("ON CONFLICT (source_evaluation_id) DO UPDATE SET");
    expect(stmt.sql).toContain("WHERE weave_candidate_evaluation_imports.source_updated_at IS NULL");
  });

  it("locks existing provenance before mutating imported rows", () => {
    const stmt = existingImportForUpdateStatement("eval_1");

    expect(stmt.sql).toContain(
      "SELECT source_updated_at, score_id, application_id FROM weave_candidate_evaluation_imports",
    );
    expect(stmt.sql).toContain("WHERE source_evaluation_id = $1 FOR UPDATE");
    expect(stmt.params).toEqual(["eval_1"]);
  });

  it("reads latest imported evaluations by application", () => {
    const stmt = importedEvaluationForApplicationStatement("int_1", "app_1");

    expect(stmt.sql).toContain("FROM weave_candidate_evaluation_imports imp");
    expect(stmt.params).toEqual(["int_1", "app_1"]);
  });

  it("reads latest imported evaluations by Puddle session", () => {
    const stmt = importedEvaluationForSessionStatement("sess_1", "org_1");

    expect(stmt.sql).toContain("candidateEvaluationId");
    expect(stmt.sql).toContain("FROM sessions sess");
    expect(stmt.sql).toContain("JOIN weave_candidate_evaluation_imports imp");
    expect(stmt.sql).toContain("imp.organization_id = sess.org_id");
    expect(stmt.sql).toContain(
      "imp.source_evaluation_id = NULLIF(sess.source_metadata #>> '{ashby,selected,candidateEvaluationId}', '')",
    );
    expect(stmt.sql).toContain(
      "imp.application_id = NULLIF(sess.source_metadata #>> '{ashby,selected,applicationId}', '')",
    );
    expect(stmt.sql).toContain("JOIN ashby_candidate_scores sc ON sc.score_id = imp.score_id");
    expect(stmt.sql).not.toContain("candidate_email");
    expect(stmt.sql).not.toContain("lower(app.candidate_email)");
    expect(stmt.params).toEqual(["sess_1", "org_1"]);
  });
});
