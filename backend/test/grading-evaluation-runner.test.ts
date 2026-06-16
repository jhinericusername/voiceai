import { describe, expect, it } from "vitest";
import {
  evaluateLabeledInterviews,
  type LabeledInterviewCase,
} from "../src/grading/evaluation/runner.js";
import type { GradingModel } from "../src/grading/scoring.js";

const rubric = {
  script_version: "job_1-v1",
  dimensions: [
    { key: "problem_solving", name: "Problem Solving" },
    { key: "agency", name: "Agency" },
    { key: "competitiveness", name: "Competitiveness" },
    { key: "curious", name: "Curious" },
  ],
};

const caseA = labeledCase({
  sessionId: "session-a",
  candidateName: "Ada",
  ashbyJobId: "job-1",
  marker: "UNIQUE_TRANSCRIPT_ALPHA",
  humanScores: {
    problem_solving: 4,
    agency: 3,
    competitiveness: 2,
    curious: 1,
  },
  humanTotalScore: 10,
});

const caseB = labeledCase({
  sessionId: "session-b",
  candidateName: null,
  ashbyJobId: "job-1",
  marker: "UNIQUE_TRANSCRIPT_BRAVO",
  humanScores: {
    problem_solving: 2,
    agency: 2,
    competitiveness: 2,
    curious: 2,
  },
  humanTotalScore: 8,
});

const caseC = labeledCase({
  sessionId: "session-c",
  candidateName: "Chen",
  ashbyJobId: "job-2",
  marker: "UNIQUE_TRANSCRIPT_CHARLIE",
  humanScores: {
    problem_solving: 3,
    agency: 3,
    competitiveness: 3,
    curious: 3,
  },
  humanTotalScore: 12,
});

describe("grading evaluation runner", () => {
  it("scores each labeled interview in a separate model call with guide and calibration examples", async () => {
    const model = new FakeModel([
      scoringOutput({
        problem_solving: 4,
        agency: 3,
        competitiveness: 2,
        curious: 1,
      }),
      scoringOutput({
        problem_solving: 2,
        agency: 2.5,
        competitiveness: 1,
        curious: 2,
      }),
    ]);

    const report = await evaluateLabeledInterviews({
      cases: [caseA, caseB],
      rubric,
      model,
      options: { batchSize: 20, calibrationExampleLimit: 2 },
    });

    expect(report.caseCount).toBe(2);
    expect(report.succeeded).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.batchSize).toBe(5);
    expect(report.modelCallCount).toBe(2);
    expect(model.prompts).toHaveLength(2);

    expect(model.prompts[0]).toContain("GRADING_GUIDE:");
    expect(model.prompts[0]).toContain("Missing question neutral default");
    expect(model.prompts[0]).toContain("CALIBRATION_EXAMPLES_JSON:");
    expect(model.prompts[0]).toContain('"id": "example_a"');
    expect(model.prompts[0]).toContain('"id": "example_b"');
    expect(model.prompts[0]).not.toContain('"id": "example_c"');

    expect(model.prompts[0]).toContain("UNIQUE_TRANSCRIPT_ALPHA");
    expect(model.prompts[0]).not.toContain("UNIQUE_TRANSCRIPT_BRAVO");
    expect(model.prompts[1]).toContain("UNIQUE_TRANSCRIPT_BRAVO");
    expect(model.prompts[1]).not.toContain("UNIQUE_TRANSCRIPT_ALPHA");

    expect(report.cases[0]).toMatchObject({
      status: "succeeded",
      sessionId: "session-a",
      candidateName: null,
      ashbyJobId: "job-1",
      source: "markdown_scorecard",
      humanTotalScore: 10,
      predictedTotalScore: 10,
      comparison: {
        meanAbsoluteError: 0,
        exactRate: 1,
        withinHalfPointRate: 1,
      },
    });
    expect(report.cases[0].predictedCategoryScores).toEqual([
      expect.objectContaining({ category: "problem_solving", score: 4 }),
      expect.objectContaining({ category: "agency", score: 3 }),
      expect.objectContaining({ category: "competitiveness", score: 2 }),
      expect.objectContaining({ category: "curious", score: 1 }),
    ]);
    expect(report.cases[0]).not.toHaveProperty("humanComment");
    expect(report.cases[0]).not.toHaveProperty("transcriptTurns");
  });

  it("computes aggregate metrics across successful cases only", async () => {
    const model = new FakeModel([
      scoringOutput({
        problem_solving: 4,
        agency: 3,
        competitiveness: 2,
        curious: 1,
      }),
      scoringOutput({
        problem_solving: 2,
        agency: 2.5,
        competitiveness: 1,
        curious: 2,
      }),
      new Error("model failed while processing UNIQUE_TRANSCRIPT_CHARLIE"),
    ]);

    const report = await evaluateLabeledInterviews({
      cases: [caseA, caseB, caseC],
      rubric,
      model,
      options: { batchSize: 2, calibrationExampleLimit: 1 },
    });

    expect(report.succeeded).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.modelCallCount).toBe(3);
    expect(report.aggregate).toMatchObject({
      meanAbsoluteError: 0.1875,
      exactRate: 0.75,
      withinHalfPointRate: 0.875,
    });
    expect(report.aggregate.dimensions.problem_solving).toMatchObject({
      count: 2,
      meanAbsoluteError: 0,
      exactRate: 1,
      withinHalfPointRate: 1,
    });
    expect(report.aggregate.dimensions.agency).toMatchObject({
      count: 2,
      meanAbsoluteError: 0.25,
      exactRate: 0.5,
      withinHalfPointRate: 1,
    });
    expect(report.aggregate.dimensions.competitiveness).toMatchObject({
      count: 2,
      meanAbsoluteError: 0.5,
      exactRate: 0.5,
      withinHalfPointRate: 0.5,
    });
    expect(report.aggregate.dimensions.curious).toMatchObject({
      count: 2,
      meanAbsoluteError: 0,
      exactRate: 1,
      withinHalfPointRate: 1,
    });

    expect(report.cases[2]).toMatchObject({
      status: "failed",
      sessionId: "session-c",
      warnings: [],
      errorMessage: "Scoring failed.",
    });
    expect(report.cases[2]).not.toHaveProperty("comparison");
  });

  it("keeps transcripts out of output by default and includes them only when requested", async () => {
    const defaultReport = await evaluateLabeledInterviews({
      cases: [caseA],
      rubric,
      model: new FakeModel([
        scoringOutput({
          problem_solving: 4,
          agency: 3,
          competitiveness: 2,
          curious: 1,
        }, "UNIQUE_TRANSCRIPT_ALPHA"),
      ]),
      options: { batchSize: 1, calibrationExampleLimit: 0 },
    });

    expect(JSON.stringify(defaultReport.cases)).not.toContain("UNIQUE_TRANSCRIPT_ALPHA");
    expect(JSON.stringify(defaultReport.cases)).not.toContain("Ada");
    expect(JSON.stringify(defaultReport.cases)).not.toContain("Human scorecard comment");
    expect(defaultReport.cases[0]).not.toHaveProperty("transcriptTurns");
    expect(defaultReport.cases[0].candidateName).toBeNull();
    expect(defaultReport.cases[0]).not.toHaveProperty("humanComment");
    expect(defaultReport.cases[0].predictedCategoryScores?.[0]).toEqual({
      category: "problem_solving",
      score: 4,
      confidence: 0.8,
    });

    const transcriptReport = await evaluateLabeledInterviews({
      cases: [caseA],
      rubric,
      model: new FakeModel([
        scoringOutput({
          problem_solving: 4,
          agency: 3,
          competitiveness: 2,
          curious: 1,
        }, "UNIQUE_TRANSCRIPT_ALPHA"),
      ]),
      options: {
        batchSize: 1,
        calibrationExampleLimit: 0,
        includeTranscriptInOutput: true,
      },
    });

    expect(transcriptReport.cases[0].transcriptTurns).toEqual(caseA.transcriptTurns);
    expect(transcriptReport.cases[0].candidateName).toBe("Ada");
    expect(transcriptReport.cases[0].humanComment).toBe("Human scorecard comment");
    expect(JSON.stringify(transcriptReport.cases)).toContain("UNIQUE_TRANSCRIPT_ALPHA");
    expect(transcriptReport.cases[0].predictedCategoryScores?.[0]).toMatchObject({
      category: "problem_solving",
      score: 4,
      evidenceQuotes: ["UNIQUE_TRANSCRIPT_ALPHA"],
      rationale: "problem_solving rationale from UNIQUE_TRANSCRIPT_ALPHA",
    });
  });

  it("redacts model warnings and malformed score details by default", async () => {
    const report = await evaluateLabeledInterviews({
      cases: [caseA],
      rubric,
      model: new FakeModel([
        JSON.stringify({
          category_scores: [
            {
              category: "problem_solving",
              score: 4,
              confidence: 0.8,
              evidence_quotes: ["candidate evidence"],
              rationale: "valid",
            },
            {
              category: "UNIQUE_TRANSCRIPT_ALPHA",
              score: 3,
              confidence: 0.8,
              evidence_quotes: ["candidate evidence"],
              rationale: "invalid category",
            },
          ],
          warnings: ["warning mentions UNIQUE_TRANSCRIPT_ALPHA"],
        }),
      ]),
      options: { batchSize: 1, calibrationExampleLimit: 0 },
    });

    expect(report.failed).toBe(1);
    expect(report.cases[0]).toMatchObject({
      status: "failed",
      warnings: ["redacted_model_warnings"],
      errorMessage: "Scoring failed.",
    });
    expect(report.cases[0]).not.toHaveProperty("predictedCategoryScores");
    expect(JSON.stringify(report.cases)).not.toContain("UNIQUE_TRANSCRIPT_ALPHA");
  });

  it("drops extra model-controlled category names from successful default output", async () => {
    const report = await evaluateLabeledInterviews({
      cases: [caseA],
      rubric,
      model: new FakeModel([
        JSON.stringify({
          category_scores: [
            ...Object.entries(caseA.humanScores).map(([category, score]) => ({
              category,
              score,
              confidence: 0.8,
              evidence_quotes: ["candidate evidence"],
              rationale: "valid",
            })),
            {
              category: "UNIQUE_TRANSCRIPT_ALPHA",
              score: 4,
              confidence: 0.8,
              evidence_quotes: ["candidate evidence"],
              rationale: "extra model-controlled category",
            },
          ],
          warnings: [],
        }),
      ]),
      options: { batchSize: 1, calibrationExampleLimit: 0 },
    });

    expect(report.succeeded).toBe(1);
    expect(report.cases[0].predictedCategoryScores).toHaveLength(4);
    expect(JSON.stringify(report.cases)).not.toContain("UNIQUE_TRANSCRIPT_ALPHA");
  });
});

function labeledCase(input: {
  readonly sessionId: string;
  readonly candidateName: string | null;
  readonly ashbyJobId: string;
  readonly marker: string;
  readonly humanScores: LabeledInterviewCase["humanScores"];
  readonly humanTotalScore: number;
}): LabeledInterviewCase {
  return {
    sessionId: input.sessionId,
    candidateName: input.candidateName,
    ashbyJobId: input.ashbyJobId,
    transcriptTurns: [
      { speaker: "agent", text: "Tell me about a hard problem.", turnIndex: 0 },
      { speaker: "candidate", text: input.marker, turnIndex: 1 },
    ],
    humanScores: input.humanScores,
    humanTotalScore: input.humanTotalScore,
    humanComment: "Human scorecard comment",
    source: "markdown_scorecard",
  };
}

function scoringOutput(
  scores: LabeledInterviewCase["humanScores"],
  transcriptQuote = "candidate evidence",
): string {
  return JSON.stringify({
    category_scores: Object.entries(scores).map(([category, score]) => ({
      category,
      score,
      confidence: 0.8,
      evidence_quotes: [transcriptQuote],
      rationale: `${category} rationale from ${transcriptQuote}`,
    })),
    warnings: [],
  });
}

class FakeModel implements GradingModel {
  readonly prompts: string[] = [];
  private index = 0;

  constructor(private readonly responses: readonly (string | Error)[]) {}

  async complete(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    const response = this.responses[this.index];
    this.index += 1;
    if (response instanceof Error) {
      throw response;
    }
    if (typeof response !== "string") {
      throw new Error("Unexpected fake model call.");
    }
    return response;
  }
}
