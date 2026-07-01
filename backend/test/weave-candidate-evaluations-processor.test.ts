import { describe, expect, it, vi } from "vitest";
import { processWeaveCandidateEvaluationEvent } from "../src/weave/candidate-evaluations/processor.js";
import type { WeaveCandidateEvaluationEvent } from "../src/weave/candidate-evaluations/payload.js";

type QueryCall = readonly [sql: string, params?: readonly unknown[]];

function eventFixture(): WeaveCandidateEvaluationEvent {
  const rawRecord = {
    id: "eval_1",
    candidate_name: "Maya Chen",
    interview_date: "2026-06-30",
    problem_solving: 3,
    agency: 4,
    competitiveness: 2.5,
    curious: 3.5,
    comments: "Good signal.",
    ashby_application_id: "app_1",
    ashby_candidate_id: "cand_1",
    ashby_job_id: "job_1",
    created_at: "2026-06-30T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  };

  return {
    eventId: "evt_1",
    source: "weave_supabase_candidate_evaluation",
    operation: "UPDATE",
    evaluation: {
      sourceEvaluationId: "eval_1",
      candidateName: "Maya Chen",
      interviewDate: "2026-06-30",
      problemSolving: 3,
      agency: 4,
      competitiveness: 2.5,
      curiosity: 3.5,
      totalScore: 13,
      comments: "Good signal.",
      ashbyApplicationId: "app_1",
      ashbyCandidateId: "cand_1",
      ashbyJobId: "job_1",
      sourceCreatedAt: "2026-06-30T00:00:00.000Z",
      sourceUpdatedAt: "2026-07-01T00:00:00.000Z",
      rawRecord,
    },
  };
}

function fakePoolWithRows(rows: readonly { readonly rows: readonly Record<string, unknown>[] }[]) {
  const calls: QueryCall[] = [];
  let rowIndex = 0;
  const client = {
    query: vi.fn(async (sql: string, params?: readonly unknown[]) => {
      calls.push([sql, params]);
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      return rows[rowIndex++] ?? { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
  };
  return { pool, client, calls };
}

describe("Weave candidate evaluation processor", () => {
  it("syncs one event inside a transaction", async () => {
    const { pool, client, calls } = fakePoolWithRows([
      { rows: [{ integration_id: "int_1" }] },
      { rows: [] },
      { rows: [{ application_id: "app_1" }] },
      { rows: [{ profile_id: "role_1" }] },
      { rows: [{ score_id: "score_1", total_score: 13 }] },
      { rows: [{ source_evaluation_id: "eval_1" }] },
    ]);

    const result = await processWeaveCandidateEvaluationEvent({
      pool,
      organizationId: "org_1",
      event: eventFixture(),
    });

    expect(result).toEqual({
      status: "synced",
      sourceEvaluationId: "eval_1",
      applicationId: "app_1",
      scoreId: "score_1",
    });
    expect(calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("FROM ashby_company_integrations"),
      expect.stringContaining("FROM weave_candidate_evaluation_imports"),
      expect.stringContaining("INSERT INTO ashby_applications"),
      expect.stringContaining("INSERT INTO role_grading_profiles"),
      expect.stringContaining("INSERT INTO ashby_candidate_scores"),
      expect.stringContaining("INSERT INTO weave_candidate_evaluation_imports"),
      "COMMIT",
    ]);
    expect(calls.some(([sql]) => sql === "ROLLBACK")).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("commits without upserts when existing provenance is newer", async () => {
    const { pool, client, calls } = fakePoolWithRows([
      { rows: [{ integration_id: "int_1" }] },
      {
        rows: [
          {
            source_updated_at: "2026-07-02T00:00:00.000Z",
            application_id: "app_existing",
            score_id: "score_existing",
          },
        ],
      },
    ]);

    const result = await processWeaveCandidateEvaluationEvent({
      pool,
      organizationId: "org_1",
      event: eventFixture(),
    });

    expect(result).toEqual({
      status: "synced",
      sourceEvaluationId: "eval_1",
      applicationId: "app_existing",
      scoreId: "score_existing",
    });
    expect(calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("FROM ashby_company_integrations"),
      expect.stringContaining("FROM weave_candidate_evaluation_imports"),
      "COMMIT",
    ]);
    const sqlText = calls.map(([sql]) => sql).join("\n");
    expect(sqlText).not.toContain("INSERT INTO ashby_applications");
    expect(sqlText).not.toContain("INSERT INTO role_grading_profiles");
    expect(sqlText).not.toContain("INSERT INTO ashby_candidate_scores");
    expect(sqlText).not.toContain("INSERT INTO weave_candidate_evaluation_imports");
    expect(calls.some(([sql]) => sql === "ROLLBACK")).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("rolls back when no organization integration exists", async () => {
    const { pool, client, calls } = fakePoolWithRows([{ rows: [] }]);

    await expect(
      processWeaveCandidateEvaluationEvent({
        pool,
        organizationId: "org_1",
        event: eventFixture(),
      }),
    ).rejects.toThrow("No Ashby integration found for organization org_1");

    expect(calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("FROM ashby_company_integrations"),
      "ROLLBACK",
    ]);
    expect(calls.some(([sql]) => sql === "COMMIT")).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
