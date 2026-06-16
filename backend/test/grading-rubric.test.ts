import { describe, expect, it } from "vitest";
import { buildDraftRubric, validateRoleRubric } from "../src/grading/rubric.js";

describe("grading rubric", () => {
  it("builds a draft rubric from the pilot rubric and job context", () => {
    const draft = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });

    expect(draft.script_version).toBe("job_1-v1");
    expect(draft.role.title).toBe("Founding AI Engineer");
    expect(draft.dimensions.map((dimension) => dimension.key)).toEqual([
      "problem_solving",
      "agency",
      "competitiveness",
      "curious",
    ]);
    expect(draft.recommendation_thresholds.minimum_confidence).toBe(0.75);
    expect(draft.generation_context.historical_session_count).toBe(12);
  });

  it("validates a complete rubric", () => {
    const draft = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });

    expect(validateRoleRubric(draft)).toEqual({ ok: true });
  });

  it("rejects rubrics without anchors", () => {
    const draft = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });
    const invalid = {
      ...draft,
      dimensions: [{ ...draft.dimensions[0], anchors: { 1: "Only one" } }],
    };

    expect(validateRoleRubric(invalid)).toEqual({
      ok: false,
      error: "Each rubric dimension must define anchors 1, 2, 3, and 4.",
    });
  });
});
