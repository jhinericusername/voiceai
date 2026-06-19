import { describe, expect, it } from "vitest";
import {
  buildDefaultGradingGuide,
  buildScoringCalibrationInput,
  clampEvaluationBatchSize,
  calibrationExamplesFromExport,
  defaultCalibrationExamples,
  selectCalibrationExamples,
} from "../src/grading/evaluation/calibration.js";
import {
  defaultDimensionScoreAnchors,
  dimensionScoreAnchorCoverage,
} from "../src/grading/prompts/dimension-score-anchors.js";

describe("grading evaluation calibration", () => {
  it("builds the default grading guide with explicit calibration rules", () => {
    const guide = buildDefaultGradingGuide();

    expect(guide).toContain("problem_solving");
    expect(guide).toContain("agency");
    expect(guide).toContain("competitiveness");
    expect(guide).toContain("curious");
    expect(guide).toContain("Scores are 1-4");
    expect(guide).toContain("0.5 increments");
    expect(guide).toContain("use 2 for that dimension");
    expect(guide).toContain("candidate dodged");
    expect(guide).toContain("Scripted/AI-answer risk");
    expect(guide).toContain("protected characteristics");
    expect(guide).toContain("concrete evidence and practical specificity");
    expect(guide).toContain("Job-related means relevant to the four hiring dimensions");
    expect(guide).toContain("not limited to workplace examples");
  });

  it("builds the default grading guide with dimension-specific disagreement calibration", () => {
    const guide = buildDefaultGradingGuide();

    expect(guide).toContain("Agency 4");
    expect(guide).toContain("rule-breaking, loophole exploitation, or institution/process manipulation");
    expect(guide).toContain("Do not award high agency for technical/product hacks");
    expect(guide).toContain("Competitiveness 4");
    expect(guide).toContain("cost, identity-level obsession, top-percentile competition, or years of life domination");
    expect(guide).toContain("Do not infer high competitiveness from founder background or general ambition alone");
    expect(guide).toContain("Curious 4");
    expect(guide).toContain("hobby/domain expertise, including non-CS or work-adjacent domains");
    expect(guide).toContain("Top-percentile gaming, sports, or hobby knowledge can count");
    expect(guide).toContain("Self-claimed top-percentile status without concrete detail should usually cap at 3");
    expect(guide).toContain("If the transcript appears incomplete");
    expect(guide).toContain("use the missing-question neutral default");
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

  it("returns actual-answer score anchors for every dimension and integer score", () => {
    const anchors = defaultDimensionScoreAnchors();

    expect(Object.keys(anchors).sort()).toEqual([
      "agency",
      "competitiveness",
      "curious",
      "problem_solving",
    ]);
    expect(dimensionScoreAnchorCoverage(anchors)).toEqual({
      problem_solving: [1, 2, 3, 4],
      agency: [1, 2, 3, 4],
      competitiveness: [1, 2, 3, 4],
      curious: [1, 2, 3, 4],
    });

    for (const [dimension, scoreAnchors] of Object.entries(anchors)) {
      for (const score of [1, 2, 3, 4] as const) {
        const examples = scoreAnchors[String(score)];
        expect(examples?.length, `${dimension} ${score}`).toBeGreaterThan(0);
        for (const example of examples ?? []) {
          expect(example.score).toBe(score);
          expect(example.answerExcerpt.trim().length).toBeGreaterThan(40);
          expect(example.whyThisScore.trim().length).toBeGreaterThan(40);
          expect(example.answerExcerpt.toLowerCase()).not.toContain("question was not asked");
          expect(example.whyThisScore.toLowerCase()).not.toContain("question was not asked");
          expect(example.source).toMatch(/^weave_/);
        }
      }
    }
  });

  it("includes score anchors in the default scoring calibration input", () => {
    const calibration = buildScoringCalibrationInput();

    expect(calibration.gradingGuide).toContain("Missing question neutral default");
    expect(calibration.calibrationExamples.map((example) => example.id)).toEqual([
      "example_a",
      "example_b",
      "example_c",
    ]);
    expect(dimensionScoreAnchorCoverage(calibration.dimensionScoreAnchors)).toEqual({
      problem_solving: [1, 2, 3, 4],
      agency: [1, 2, 3, 4],
      competitiveness: [1, 2, 3, 4],
      curious: [1, 2, 3, 4],
    });
  });

  it("converts exported transcript-score pairs into bounded calibration examples", () => {
    const examples = calibrationExamplesFromExport(
      {
        sample: {
          examples: [
            {
              id: "weave_candidate_evaluation:session-a",
              sessionId: "session-a",
              scores: {
                problem_solving: 3,
                agency: 4,
                competitiveness: 2,
                curious: 4,
              },
              totalScore: 13,
              comment: "Human rationale should be preserved.",
              transcriptTurns: [
                { speaker: "agent", text: "Tell me about a hard problem." },
                { speaker: "candidate", text: "I built a weird import pipeline." },
                { speaker: "candidate", text: "I also hacked a human process." },
              ],
            },
          ],
        },
      },
      { maxTranscriptChars: 65 },
    );

    expect(examples).toHaveLength(1);
    expect(examples[0]).toMatchObject({
      id: "weave_candidate_evaluation:session-a",
      scores: {
        problem_solving: 3,
        agency: 4,
        competitiveness: 2,
        curious: 4,
      },
      totalScore: 13,
      scriptedRisk: "unknown",
      missingQuestions: {},
      comment: "Human rationale should be preserved.",
    });
    expect(examples[0].summary).toContain("Real graded calibration example");
    expect(examples[0].transcriptExcerpt).toContain("AGENT: Tell me about");
    expect(examples[0].transcriptExcerpt).toContain("CANDIDATE: I built");
    expect(examples[0].transcriptExcerpt.length).toBeLessThanOrEqual(80);
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
