import { describe, expect, it } from "vitest";
import {
  historicalSessionEvaluationLinksStatement,
  puddleScoredSessionLabelsStatement,
  transcriptTurnsForEvaluationStatement,
  weaveCandidateEvaluationsByIdStatement,
} from "../src/grading/evaluation/repository.js";

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function expectNoCandidateEmailSelection(sql: string): void {
  expect(sql).not.toMatch(/\bcandidate_email\b/i);
  expect(sql).not.toMatch(/\bemail\s+AS\b/i);
  expect(sql).not.toMatch(/\bAS\s+"?email"?\b/i);
}

describe("grading evaluation repository", () => {
  it("selects Puddle scored session labels scoped by organization without a job filter", () => {
    const stmt = puddleScoredSessionLabelsStatement({
      organizationId: "org_1",
      limit: 500,
    });
    const sql = compactSql(stmt.text);

    expect(sql).toContain("FROM sessions s");
    expect(sql).toContain("JOIN ashby_company_integrations i ON i.organization_id = linked.organization_id");
    expect(sql).toContain("JOIN ashby_applications a");
    expect(sql).toContain("JOIN ashby_candidate_scores sc");
    expect(sql).toContain("WHERE s.org_id = $1");
    expect(sql).not.toContain("a.job_id = $2");
    expect(sql).toContain("LIMIT $2");
    expect(sql).toContain("sc.problem_solving AS problem_solving");
    expect(sql).toContain("sc.curiosity AS curious");
    expect(sql).toContain("sc.total_score");
    expect(sql).toContain("'puddle_ashby_score' AS source");
    expectNoCandidateEmailSelection(sql);
    expect(stmt.values).toEqual(["org_1", 100]);
  });

  it("adds the optional Ashby job filter and clamps low Puddle limits", () => {
    const stmt = puddleScoredSessionLabelsStatement({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      limit: 0,
    });
    const sql = compactSql(stmt.text);

    expect(sql).toContain("WHERE s.org_id = $1");
    expect(sql).toContain("AND a.job_id = $2");
    expect(sql).toContain("LIMIT $3");
    expectNoCandidateEmailSelection(sql);
    expect(stmt.values).toEqual(["org_1", "job_1", 1]);
  });

  it("selects historical Fireflies session links with source metadata evaluation ids", () => {
    const stmt = historicalSessionEvaluationLinksStatement({
      organizationId: "org_1",
      limit: Number.NaN,
    });
    const sql = compactSql(stmt.text);

    expect(sql).toContain("FROM sessions s");
    expect(sql).toContain("WHERE s.org_id = $1 AND s.external_source = 'fireflies'");
    expect(sql).toContain("source_metadata #>> '{ashby,selected,candidateEvaluationId}'");
    expect(sql).toContain("source_metadata #>> '{ashby,selected,candidate_evaluation_id}'");
    expect(sql).toContain("source_metadata #>> '{candidate_evaluation_id}'");
    expect(sql).toContain("jsonb_path_query_first");
    expect(sql).toContain("matched_candidate ->> 'applicationId'");
    expect(sql).toContain("matched_candidate ->> 'jobId'");
    expect(sql).toContain("matched_candidate ->> 'candidateEvaluationId'");
    expect(sql).toContain("candidate_evaluation_id IS NOT NULL");
    expect(sql).not.toContain("ashby_job_id = $2");
    expect(sql).toContain("LIMIT $2");
    expect(sql).toContain("'weave_candidate_evaluation' AS source");
    expect(sql).toContain("jsonb_build_object");
    expect(sql).toContain("'candidateEvaluationId'");
    expect(sql).not.toContain("SELECT s.session_id, s.org_id AS organization_id, s.source_metadata");
    expectNoCandidateEmailSelection(sql);
    expect(stmt.values).toEqual(["org_1", 25]);
  });

  it("adds the optional Ashby job filter and clamps high historical limits", () => {
    const stmt = historicalSessionEvaluationLinksStatement({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      limit: 101,
    });
    const sql = compactSql(stmt.text);

    expect(sql).toContain("ashby_job_id = $2");
    expect(sql).toContain("LIMIT $3");
    expectNoCandidateEmailSelection(sql);
    expect(stmt.values).toEqual(["org_1", "job_1", 100]);
  });

  it("looks up Weave candidate evaluations by id with placeholders", () => {
    const stmt = weaveCandidateEvaluationsByIdStatement(["eval_1", "eval_2"]);
    const sql = compactSql(stmt.text);

    expect(sql).toContain("FROM candidate_evaluations ev");
    expect(sql).toContain("ev.id::text IN ($1, $2)");
    expect(sql).toContain("ev.ashby_application_id");
    expect(sql).toContain("ev.ashby_job_id");
    expect(sql).toContain("ev.candidate_name");
    expect(sql).toContain("ev.sum AS total_score");
    expect(sql).toContain("'weave_candidate_evaluation' AS source");
    expectNoCandidateEmailSelection(sql);
    expect(stmt.values).toEqual(["eval_1", "eval_2"]);
  });

  it("returns a safe no-row Weave statement for empty ids", () => {
    const stmt = weaveCandidateEvaluationsByIdStatement([]);
    const sql = compactSql(stmt.text);

    expect(sql).toContain("WHERE false");
    expect(sql).not.toContain("IN ()");
    expect(stmt.values).toEqual([]);
  });

  it("selects transcript turns for evaluation with stable session and turn ordering", () => {
    const stmt = transcriptTurnsForEvaluationStatement(["sess_2", "sess_1"]);
    const sql = compactSql(stmt.text);

    expect(sql).toContain("FROM transcript_turns");
    expect(sql).toContain("WHERE session_id IN ($1, $2)");
    expect(sql).toContain("ORDER BY session_id ASC, turn_index ASC");
    expect(stmt.values).toEqual(["sess_2", "sess_1"]);
  });
});
