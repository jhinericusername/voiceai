import { describe, expect, it } from "vitest";
import { recommendInterview } from "../src/grading/recommendation.js";

const baseInput = {
  categoryScores: [
    { category: "problem_solving", score: 4, confidence: 0.9, evidenceQuotes: ["quote"] },
    { category: "agency", score: 3, confidence: 0.84, evidenceQuotes: ["quote"] },
    { category: "competitiveness", score: 3, confidence: 0.8, evidenceQuotes: ["quote"] },
    { category: "curious", score: 3, confidence: 0.82, evidenceQuotes: ["quote"] },
  ],
  bareMinimumRule: "at_least_one_4_and_problem_solving_ge_3",
  minimumConfidence: 0.75,
  severeWarnings: [],
};

describe("recommendInterview", () => {
  it("advances when bare minimum, confidence, and evidence all pass", () => {
    expect(recommendInterview(baseInput)).toEqual({
      recommendation: "advance",
      confidence: 0.84,
      warnings: [],
    });
  });

  it("advances non-problem-solving role rubrics using an average-score rule", () => {
    expect(
      recommendInterview({
        categoryScores: [
          { category: "communication", score: 3, confidence: 0.9, evidenceQuotes: ["quote"] },
          { category: "passion_for_sales", score: 4, confidence: 0.86, evidenceQuotes: ["quote"] },
          { category: "agency", score: 3, confidence: 0.84, evidenceQuotes: ["quote"] },
        ],
        bareMinimumRule: "at_least_one_4_and_average_ge_3",
        minimumConfidence: 0.75,
        severeWarnings: [],
      }),
    ).toEqual({
      recommendation: "advance",
      confidence: 0.87,
      warnings: [],
    });
  });

  it("holds when confidence is low", () => {
    expect(
      recommendInterview({
        ...baseInput,
        categoryScores: [
          { category: "problem_solving", score: 4, confidence: 0.6, evidenceQuotes: ["quote"] },
          { category: "agency", score: 3, confidence: 0.84, evidenceQuotes: ["quote"] },
        ],
      }),
    ).toEqual({
      recommendation: "hold",
      confidence: 0.72,
      warnings: ["low_confidence"],
    });
  });

  it("passes when bare minimum fails with enough evidence", () => {
    expect(
      recommendInterview({
        ...baseInput,
        categoryScores: [
          { category: "problem_solving", score: 2, confidence: 0.9, evidenceQuotes: ["quote"] },
          { category: "agency", score: 3, confidence: 0.9, evidenceQuotes: ["quote"] },
        ],
      }),
    ).toEqual({
      recommendation: "pass",
      confidence: 0.9,
      warnings: [],
    });
  });

  it("holds when severe warnings are present", () => {
    expect(
      recommendInterview({
        ...baseInput,
        severeWarnings: ["severe_integrity_review_required"],
      }),
    ).toEqual({
      recommendation: "hold",
      confidence: 0.84,
      warnings: ["severe_integrity_review_required"],
    });
  });

  it("holds when evidence is missing", () => {
    expect(
      recommendInterview({
        ...baseInput,
        categoryScores: [
          { category: "problem_solving", score: 4, confidence: 0.9, evidenceQuotes: [] },
          { category: "agency", score: 3, confidence: 0.9, evidenceQuotes: ["quote"] },
        ],
      }),
    ).toEqual({
      recommendation: "hold",
      confidence: 0.9,
      warnings: ["missing_evidence"],
    });
  });
});
