import { describe, expect, it } from "vitest";
import {
  buildDefaultGradingGuide,
  clampEvaluationBatchSize,
  defaultCalibrationExamples,
  selectCalibrationExamples,
} from "../src/grading/evaluation/calibration.js";

describe("grading evaluation calibration", () => {
  it("builds the default grading guide with explicit calibration rules", () => {
    const guide = buildDefaultGradingGuide();

    expect(guide).toContain("problem_solving");
    expect(guide).toContain("agency");
    expect(guide).toContain("competitiveness");
    expect(guide).toContain("curious");
    expect(guide).toContain("Scores are 0-4");
    expect(guide).toContain("0.5 increments");
    expect(guide).toContain("use 2 for that dimension");
    expect(guide).toContain("candidate dodged");
    expect(guide).toContain("Scripted/AI-answer risk");
    expect(guide).toContain("protected characteristics");
    expect(guide).toContain("concrete evidence and practical specificity");
  });

  it("returns exactly three sanitized calibration examples with expected scores and totals", () => {
    const examples = defaultCalibrationExamples();

    expect(examples).toHaveLength(3);
    expect(examples.map((example) => example.id)).toEqual(["example_a", "example_b", "example_c"]);
    expect(examples.map((example) => example.totalScore)).toEqual([7.5, 10.5, 13]);

    expect(examples[0].scores).toEqual({
      problem_solving: 2.5,
      agency: 2,
      competitiveness: 2,
      curious: 1,
    });
    expect(examples[0].summary).toContain("Practical migration automation");
    expect(examples[0].missingQuestions.agency).toContain("not asked");
    expect(examples[0].comment).toContain("curiosity question was asked");
    expect(examples[0].scriptedRisk).toBe("low_moderate");

    expect(examples[1].scores).toEqual({
      problem_solving: 3,
      agency: 2.5,
      competitiveness: 3,
      curious: 2,
    });
    expect(examples[1].comment).toContain("graph and streaming fraud ML architecture");
    expect(examples[1].comment).toContain("non-computer hack");
    expect(examples[1].missingQuestions.curious).toContain("not asked");
    expect(examples[1].scriptedRisk).toBe("high");

    expect(examples[2].scores).toEqual({
      problem_solving: 3,
      agency: 4,
      competitiveness: 2,
      curious: 4,
    });
    expect(examples[2].comment).toContain("robotics support workaround");
    expect(examples[2].comment).toContain("healthcare deductible");
    expect(examples[2].comment).toContain("goat-farming knowledge");
    expect(examples[2].scriptedRisk).toBe("very_low");
  });

  it("selects at most the requested number of calibration examples", () => {
    const examples = defaultCalibrationExamples();

    expect(selectCalibrationExamples(examples, 2).map((example) => example.id)).toEqual([
      "example_a",
      "example_b",
    ]);
    expect(selectCalibrationExamples(examples, 0)).toEqual([]);
    expect(selectCalibrationExamples(examples, Number.NaN)).toEqual([]);
  });

  it("clamps evaluation batch size with safe defaults and invalid-value handling", () => {
    expect(clampEvaluationBatchSize(0)).toBe(1);
    expect(clampEvaluationBatchSize(1)).toBe(1);
    expect(clampEvaluationBatchSize(3)).toBe(3);
    expect(clampEvaluationBatchSize(99)).toBe(5);
    expect(clampEvaluationBatchSize(Number.NaN)).toBe(1);
    expect(clampEvaluationBatchSize(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampEvaluationBatchSize(8, { min: 2, max: 4 })).toBe(4);
    expect(clampEvaluationBatchSize(1, { min: 2, max: 4 })).toBe(2);
  });
});
