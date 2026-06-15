import { describe, expect, it } from "vitest";
import {
  loadHistoricalWeaveMatchBundle,
  type Queryable,
} from "../src/weave/fireflies/historicalWeaveMatches.js";

class FakeQueryable implements Queryable {
  readonly queries: { sql: string; params?: readonly unknown[] }[] = [];

  constructor(private readonly rows: Record<string, unknown>[]) {}

  async query(sql: string, params?: readonly unknown[]) {
    this.queries.push({ sql, params });
    return { rows: this.rows };
  }
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("Fireflies historical Weave match loader", () => {
  it("maps the selected Weave recording row and ranked candidates to planner match fields", async () => {
    const decidedAt = new Date("2026-04-10T12:00:00.000Z");
    const weaveDb = new FakeQueryable([
      {
        selected: {
          fireflies_transcript_id: "01ABC",
          match_status: "matched",
          match_confidence: 0.97,
          match_method: "email_and_date",
          match_reasons: ["email match"],
          ashby_candidate_id: "cand_123",
          ashby_application_id: "app_123",
          ashby_job_id: "job_123",
          candidate_evaluation_id: "eval_123",
          decision_source: "manual",
          decision_reason: ["selected in reconciliation table"],
          decided_at: decidedAt,
        },
        ranked_candidates: [
          {
            match_rank: 2,
            score: 96,
            ashby_candidate_id: "cand_999",
            ashby_application_id: "app_999",
            ashby_job_id: "job_999",
            candidate_evaluation_id: null,
            matched_email: "other@example.com",
            date_delta_days: 2,
            stage_delta_days: 1,
            stage_titles: ["Phone Screen"],
            application_active_on_meeting_date: true,
            active_application_count: 2,
            reasons: ["secondary candidate"],
          },
          {
            match_rank: 1,
            score: 92,
            ashby_candidate_id: "cand_low_score",
            ashby_application_id: "app_low_score",
            ashby_job_id: null,
            candidate_evaluation_id: null,
            matched_email: "candidate@example.com",
            date_delta_days: 0,
            stage_delta_days: null,
            stage_titles: null,
            application_active_on_meeting_date: false,
            active_application_count: null,
            reasons: null,
          },
          {
            match_rank: 1,
            score: 96,
            ashby_candidate_id: "cand_123",
            ashby_application_id: "app_123",
            ashby_job_id: "job_123",
            candidate_evaluation_id: "eval_123",
            matched_email: "candidate@example.com",
            date_delta_days: 0,
            stage_delta_days: 0,
            stage_titles: ["Technical Interview", "Final"],
            application_active_on_meeting_date: true,
            active_application_count: 1,
            reasons: ["email match", "meeting date aligned"],
          },
        ],
      },
    ]);

    const bundle = await loadHistoricalWeaveMatchBundle(weaveDb, "01ABC");

    expect(bundle.weaveMatch).toEqual({
      matchStatus: "matched",
      ashbyCandidateId: "cand_123",
      ashbyApplicationId: "app_123",
      ashbyJobId: "job_123",
      candidateEvaluationId: "eval_123",
      decisionSource: "manual",
      decisionReason: ["selected in reconciliation table"],
      decidedAt: "2026-04-10T12:00:00.000Z",
    });
    expect(
      bundle.weaveMatchCandidates.map((candidate) => [
        candidate.rank,
        candidate.score,
        candidate.ashbyApplicationId,
      ]),
    ).toEqual([
      [1, 96, "app_123"],
      [1, 92, "app_low_score"],
      [2, 96, "app_999"],
    ]);
    expect(bundle.weaveMatchCandidates[0]).toMatchObject({
      rank: 1,
      score: 96,
      ashbyCandidateId: "cand_123",
      ashbyApplicationId: "app_123",
      ashbyJobId: "job_123",
      candidateEvaluationId: "eval_123",
      matchedEmail: "candidate@example.com",
      dateDeltaDays: 0,
      stageDeltaDays: 0,
      stageTitles: ["Technical Interview", "Final"],
      applicationActiveOnMeetingDate: true,
      activeApplicationCount: 1,
      reasons: ["email match", "meeting date aligned"],
    });
    expect(bundle.weaveMatchCandidates[1]?.stageTitles).toEqual([]);
    expect(bundle.weaveMatchCandidates[1]?.reasons).toEqual([]);
  });

  it("returns ranked candidates even when Weave has no selected recording row", async () => {
    const weaveDb = new FakeQueryable([
      {
        selected: null,
        ranked_candidates: [
          {
            match_rank: 2,
            score: 96,
            ashby_candidate_id: "cand_second",
            ashby_application_id: "app_second",
            ashby_job_id: "job_second",
            candidate_evaluation_id: null,
            matched_email: "second@example.com",
            date_delta_days: 2,
            stage_delta_days: 1,
            stage_titles: ["Phone Screen"],
            application_active_on_meeting_date: true,
            active_application_count: 2,
            reasons: ["secondary candidate"],
          },
          {
            match_rank: 1,
            score: 99,
            ashby_candidate_id: "cand_first",
            ashby_application_id: "app_first",
            ashby_job_id: null,
            candidate_evaluation_id: "eval_first",
            matched_email: "first@example.com",
            date_delta_days: 0,
            stage_delta_days: 0,
            stage_titles: ["Technical Interview"],
            application_active_on_meeting_date: true,
            active_application_count: 1,
            reasons: ["best candidate"],
          },
        ],
      },
    ]);

    const bundle = await loadHistoricalWeaveMatchBundle(weaveDb, "01UNINDEXED");

    expect(bundle.weaveMatch).toBeNull();
    expect(
      bundle.weaveMatchCandidates.map((candidate) => [
        candidate.rank,
        candidate.score,
        candidate.ashbyApplicationId,
      ]),
    ).toEqual([
      [1, 99, "app_first"],
      [2, 96, "app_second"],
    ]);
    expect(bundle.weaveMatchCandidates[0]).toMatchObject({
      rank: 1,
      score: 99,
      ashbyCandidateId: "cand_first",
      ashbyApplicationId: "app_first",
      candidateEvaluationId: "eval_first",
      matchedEmail: "first@example.com",
      stageTitles: ["Technical Interview"],
      applicationActiveOnMeetingDate: true,
      activeApplicationCount: 1,
      reasons: ["best candidate"],
    });
  });

  it("queries both Weave reconciliation tables with deterministic candidate ordering", async () => {
    const weaveDb = new FakeQueryable([{ selected: null, ranked_candidates: [] }]);

    await loadHistoricalWeaveMatchBundle(weaveDb, "01ABC");

    expect(weaveDb.queries).toHaveLength(1);
    expect(weaveDb.queries[0]?.params).toEqual(["01ABC"]);
    const sql = compactSql(weaveDb.queries[0]?.sql ?? "");
    expect(sql).toContain("FROM weave_fireflies_recordings");
    expect(sql).toContain("FROM weave_fireflies_recording_match_candidates");
    expect(sql).toContain("ORDER BY match_rank ASC, score DESC");
    expect(sql).toContain("json_agg(ranked_candidates ORDER BY match_rank ASC, score DESC)");
  });
});
