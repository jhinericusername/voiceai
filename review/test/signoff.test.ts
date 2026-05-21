import { describe, it, expect } from "vitest";
import {
  validateSignoff,
  buildSignoffRecord,
  applyScoreEdit,
  type ReviewedAssessment,
} from "../src/signoff.js";

const baseAssessment: ReviewedAssessment = {
  sessionId: "sess1",
  scriptVersion: "pilot-v1",
  categoryScores: [
    { category: "problem_solving", score: 4, confidence: 0.9, lowConfidence: false },
    { category: "agency", score: 3, confidence: 0.6, lowConfidence: true },
  ],
  meetsBareMinimum: true,
  integrityFlags: ["reading_off_screen"],
};

describe("validateSignoff", () => {
  it("requires a reviewer identity", () => {
    const result = validateSignoff(baseAssessment, { reviewerEmail: "" });
    expect(result.ok).toBe(false);
  });

  it("accepts a sign-off from an identified reviewer", () => {
    const result = validateSignoff(baseAssessment, {
      reviewerEmail: "reviewer@puddle.com",
    });
    expect(result.ok).toBe(true);
  });
});

describe("applyScoreEdit", () => {
  it("lets a reviewer override a category score", () => {
    const edited = applyScoreEdit(baseAssessment, "agency", 4);
    const agency = edited.categoryScores.find((c) => c.category === "agency");
    expect(agency?.score).toBe(4);
    // Other categories are untouched.
    const ps = edited.categoryScores.find((c) => c.category === "problem_solving");
    expect(ps?.score).toBe(4);
  });

  it("rejects an out-of-range score", () => {
    expect(() => applyScoreEdit(baseAssessment, "agency", 5)).toThrow(/1-4/);
  });
});

describe("buildSignoffRecord", () => {
  it("captures reviewer, timestamp, and the final assessment", () => {
    const record = buildSignoffRecord(baseAssessment, {
      reviewerEmail: "reviewer@puddle.com",
      signedOffAt: "2026-05-21T16:00:00Z",
    });
    expect(record.reviewerEmail).toBe("reviewer@puddle.com");
    expect(record.signedOffAt).toBe("2026-05-21T16:00:00Z");
    expect(record.assessment.sessionId).toBe("sess1");
  });
});
