import { describe, expect, it } from "vitest";
import {
  stableWeaveEvaluationPayloadHash,
  validateWeaveCandidateEvaluationEvent,
  weaveReviewerEmail,
} from "../src/weave/candidate-evaluations/payload.js";

const row = {
  id: "71108f3c-43a9-4832-ae9e-3c6e6e712d08",
  candidate_name: "Maya Chen",
  interview_date: "2026-06-30",
  problem_solving: 3.5,
  agency: 4,
  competitiveness: "2.5",
  curious: 3,
  sum: 13,
  comments: "Strong product instincts.",
  ashby_application_id: "app_123",
  ashby_candidate_id: "cand_123",
  ashby_job_id: "job_123",
  created_at: "2026-06-30T12:00:00.000Z",
  updated_at: "2026-07-01T00:33:54.000Z",
};

describe("Weave candidate evaluation payloads", () => {
  it("validates Supabase webhook events and normalizes scores", () => {
    const result = validateWeaveCandidateEvaluationEvent({
      eventId: "evt_1",
      source: "weave_supabase_candidate_evaluation",
      operation: "UPDATE",
      record: row,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.evaluation).toMatchObject({
      sourceEvaluationId: row.id,
      candidateName: "Maya Chen",
      problemSolving: 3.5,
      agency: 4,
      competitiveness: 2.5,
      curiosity: 3,
      totalScore: 13,
      comments: "Strong product instincts.",
      ashbyApplicationId: "app_123",
      ashbyCandidateId: "cand_123",
      ashbyJobId: "job_123",
    });
  });

  it("rejects missing Ashby identifiers", () => {
    const result = validateWeaveCandidateEvaluationEvent({
      eventId: "evt_1",
      source: "weave_supabase_candidate_evaluation",
      operation: "INSERT",
      record: { ...row, ashby_application_id: "" },
    });

    expect(result).toEqual({
      ok: false,
      reason: "ashby_application_id is required",
    });
  });

  it("rejects scores outside the target candidate score range", () => {
    const result = validateWeaveCandidateEvaluationEvent({
      eventId: "evt_1",
      source: "weave_supabase_candidate_evaluation",
      operation: "UPDATE",
      record: { ...row, agency: 4.2 },
    });

    expect(result).toEqual({
      ok: false,
      reason: "agency must be a score from 0 to 4 in 0.5 increments",
    });
  });

  it("uses a stable reviewer identity per source evaluation", () => {
    expect(weaveReviewerEmail(row.id)).toBe(
      "weave-import+71108f3c43a94832ae9e3c6e6e712d08@puddle.system",
    );
  });

  it("hashes equivalent payloads deterministically", () => {
    expect(stableWeaveEvaluationPayloadHash({ b: 2, a: 1 })).toBe(
      stableWeaveEvaluationPayloadHash({ a: 1, b: 2 }),
    );
  });
});
