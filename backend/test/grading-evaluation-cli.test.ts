import { describe, expect, it, vi } from "vitest";
import {
  parseEvaluationCliArgs,
  runGradingEvaluationCli,
} from "../src/grading/evaluation/cli.js";
import type { LabeledInterviewCase } from "../src/grading/evaluation/runner.js";
import type { GradingModel } from "../src/grading/scoring.js";

const organizationId = "org_01KW0W3Y7RXZ5NPTRT8E1S3QVK";
const transcriptMarker = "TRANSCRIPT_MARKER_DO_NOT_PRINT";
const candidateEmail = "candidate.private@example.com";

describe("grading evaluation CLI argument parsing", () => {
  it("requires an organization id", () => {
    expect(() => parseEvaluationCliArgs([], {})).toThrow(/--organization-id is required/);
  });

  it("parses defaults and optional filters", () => {
    expect(
      parseEvaluationCliArgs(
        [
          "--organization-id",
          organizationId,
          "--ashby-job-id",
          "job_123",
          "--dry-run",
          "--include-transcript-output",
        ],
        {},
      ),
    ).toEqual({
      organizationId,
      ashbyJobId: "job_123",
      limit: 25,
      batchSize: 3,
      dryRun: true,
      includeTranscriptOutput: true,
      calibrationExampleLimit: 3,
    });
  });

  it("validates limit bounds", () => {
    expect(parseEvaluationCliArgs(["--organization-id", organizationId, "--limit", "1"], {})).toMatchObject({
      limit: 1,
    });
    expect(parseEvaluationCliArgs(["--organization-id", organizationId, "--limit", "100"], {})).toMatchObject({
      limit: 100,
    });
    expect(() =>
      parseEvaluationCliArgs(["--organization-id", organizationId, "--limit", "0"], {}),
    ).toThrow(/--limit must be between 1 and 100/);
    expect(() =>
      parseEvaluationCliArgs(["--organization-id", organizationId, "--limit", "101"], {}),
    ).toThrow(/--limit must be between 1 and 100/);
  });

  it("validates batch size bounds", () => {
    expect(parseEvaluationCliArgs(["--organization-id", organizationId, "--batch-size", "1"], {})).toMatchObject({
      batchSize: 1,
    });
    expect(parseEvaluationCliArgs(["--organization-id", organizationId, "--batch-size", "5"], {})).toMatchObject({
      batchSize: 5,
    });
    expect(() =>
      parseEvaluationCliArgs(["--organization-id", organizationId, "--batch-size", "0"], {}),
    ).toThrow(/--batch-size must be between 1 and 5/);
    expect(() =>
      parseEvaluationCliArgs(["--organization-id", organizationId, "--batch-size", "6"], {}),
    ).toThrow(/--batch-size must be between 1 and 5/);
  });
});

describe("grading evaluation CLI runner", () => {
  it("prints dry-run inventory JSON without model calls or sensitive transcript fields", async () => {
    const output: string[] = [];
    const createModel = vi.fn(() => {
      throw new Error("model should not be created during dry-run");
    });
    const evaluate = vi.fn();

    const result = await runGradingEvaluationCli(
      ["--organization-id", organizationId, "--dry-run"],
      {
        getPuddlePool: () => fakePuddleDb(),
        getWeavePool: () => fakeWeaveDb(),
        createModel,
        evaluate,
        write(message) {
          output.push(message);
        },
      },
    );

    expect(createModel).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
    expect(result.mode).toBe("dry-run");
    expect(result.inventory).toMatchObject({
      requestedLimit: 25,
      loadedPuddleLabels: 1,
      loadedHistoricalLinks: 1,
      weaveEvaluationIds: 1,
      weaveLabelsLoaded: 1,
      sessionsWithTranscripts: 2,
      evaluatableCases: 2,
    });
    expect(result.inventory.skipped.missingTranscript).toBe(0);

    const printed = output.join("");
    const parsed = JSON.parse(printed);
    expect(parsed.mode).toBe("dry-run");
    expect(parsed.inventory.evaluatableCases).toBe(2);
    expect(printed).not.toContain(transcriptMarker);
    expect(printed).not.toContain(candidateEmail);
    expect(printed).not.toContain("Private Candidate");
  });

  it("does not request the Weave pool when historical links have no evaluation ids", async () => {
    const output: string[] = [];
    const getWeavePool = vi.fn(() => {
      throw new Error("Weave pool should not be requested");
    });

    const result = await runGradingEvaluationCli(
      ["--organization-id", organizationId, "--dry-run"],
      {
        getPuddlePool: () => fakePuddleDb({ historicalLinks: [] }),
        getWeavePool,
        write(message) {
          output.push(message);
        },
      },
    );

    expect(getWeavePool).not.toHaveBeenCalled();
    expect(result.inventory).toMatchObject({
      loadedHistoricalLinks: 0,
      weaveEvaluationIds: 0,
      weaveLabelsLoaded: 0,
      evaluatableCases: 1,
    });
    expect(JSON.parse(output.join("")).inventory.weaveEvaluationIds).toBe(0);
  });

  it("evaluates loaded cases with injected model and include-transcript option", async () => {
    const output: string[] = [];
    const fakeModel: GradingModel = {
      async complete() {
        throw new Error("fake evaluator should own model behavior");
      },
    };
    const createModel = vi.fn(() => fakeModel);
    const evaluate = vi.fn(async (input: {
      readonly cases: readonly LabeledInterviewCase[];
      readonly model: GradingModel;
      readonly options: { readonly includeTranscriptInOutput?: boolean };
    }) => ({
      caseCount: input.cases.length,
      succeeded: input.cases.length,
      failed: 0,
      batchSize: 2,
      modelCallCount: 2,
      aggregate: {
        meanAbsoluteError: 0,
        exactRate: 1,
        withinHalfPointRate: 1,
        dimensions: {},
      },
      includeTranscriptInOutput: input.options.includeTranscriptInOutput === true,
      cases: input.options.includeTranscriptInOutput
        ? [
            {
              status: "succeeded",
              sessionId: input.cases[0]?.sessionId,
              transcriptTurns: input.cases[0]?.transcriptTurns,
            },
          ]
        : [],
    }));

    const result = await runGradingEvaluationCli(
      [
        "--organization-id",
        organizationId,
        "--batch-size",
        "2",
        "--calibration-example-limit",
        "1",
        "--include-transcript-output",
      ],
      {
        getPuddlePool: () => fakePuddleDb(),
        getWeavePool: () => fakeWeaveDb(),
        createModel,
        evaluate,
        write(message) {
          output.push(message);
        },
      },
    );

    expect(createModel).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        cases: expect.arrayContaining([
          expect.objectContaining({
            sessionId: "sess_puddle",
            humanScores: {
              problem_solving: 4,
              agency: 3,
              competitiveness: 2,
              curious: 1,
            },
            source: "puddle_ashby_score",
          }),
          expect.objectContaining({
            sessionId: "sess_weave",
            source: "weave_candidate_evaluation",
          }),
        ]),
        model: fakeModel,
        options: {
          batchSize: 2,
          calibrationExampleLimit: 1,
          includeTranscriptInOutput: true,
        },
      }),
    );
    expect(result.mode).toBe("evaluation");
    const printed = output.join("");
    expect(printed).toContain(transcriptMarker);
    expect(JSON.parse(printed).report.includeTranscriptInOutput).toBe(true);
  });

  it("keeps default evaluation output free of transcripts and candidate emails", async () => {
    const output: string[] = [];
    const evaluate = vi.fn(async () => ({
      caseCount: 2,
      succeeded: 2,
      failed: 0,
      batchSize: 3,
      modelCallCount: 2,
      aggregate: {
        meanAbsoluteError: 0,
        exactRate: 1,
        withinHalfPointRate: 1,
        dimensions: {},
      },
      cases: [
        {
          status: "succeeded",
          sessionId: "sess_puddle",
          candidateName: "Private Candidate",
          candidateEmail,
          humanComment: "Human comment that should stay private by default",
          modelComment: "Model comment should stay private by default",
          score_comment: "Score comment should stay private by default",
          transcriptTurns: [{ speaker: "candidate", text: transcriptMarker }],
          warnings: [`warning with ${transcriptMarker}`],
        },
      ],
    }));

    await runGradingEvaluationCli(["--organization-id", organizationId], {
      getPuddlePool: () => fakePuddleDb(),
      getWeavePool: () => fakeWeaveDb(),
      createModel: () => ({
        async complete() {
          return "";
        },
      }),
      evaluate,
      write(message) {
        output.push(message);
      },
    });

    const printed = output.join("");
    expect(printed).not.toContain(transcriptMarker);
    expect(printed).not.toContain(candidateEmail);
    expect(printed).not.toContain("Private Candidate");
    expect(printed).not.toContain("Human comment that should stay private by default");
    expect(printed).not.toContain("Model comment should stay private by default");
    expect(printed).not.toContain("Score comment should stay private by default");
    expect(JSON.parse(printed).report.cases[0].candidateName).toBeNull();
  });

  it("skips rows with invalid dimension score values before evaluation", async () => {
    const output: string[] = [];
    const evaluate = vi.fn(async (input: { readonly cases: readonly LabeledInterviewCase[] }) => ({
      caseCount: input.cases.length,
      succeeded: 0,
      failed: 0,
      batchSize: 3,
      modelCallCount: 0,
      aggregate: {},
      cases: [],
    }));

    const result = await runGradingEvaluationCli(["--organization-id", organizationId], {
      getPuddlePool: () =>
        fakePuddleDb({
          puddleLabels: [
            {
              session_id: "sess_puddle",
              organization_id: organizationId,
              candidate_name: "Private Candidate",
              ashby_job_id: "job_1",
              problem_solving: 4.25,
              agency: 3,
              competitiveness: 2,
              curious: 1,
              total_score: 10.25,
              source: "puddle_ashby_score",
            },
          ],
          historicalLinks: [],
        }),
      evaluate,
      write(message) {
        output.push(message);
      },
    });

    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ cases: [] }),
    );
    expect(result.inventory.skipped.missingScores).toBe(1);
    expect(JSON.parse(output.join("")).inventory.evaluatableCases).toBe(0);
  });

  it("skips rows with invalid present total scores before evaluation", async () => {
    const output: string[] = [];
    const evaluate = vi.fn(async (input: { readonly cases: readonly LabeledInterviewCase[] }) => ({
      caseCount: input.cases.length,
      succeeded: 0,
      failed: 0,
      batchSize: 3,
      modelCallCount: 0,
      aggregate: {},
      cases: [],
    }));

    const result = await runGradingEvaluationCli(["--organization-id", organizationId], {
      getPuddlePool: () =>
        fakePuddleDb({
          puddleLabels: [
            {
              session_id: "sess_puddle",
              organization_id: organizationId,
              candidate_name: "Private Candidate",
              ashby_job_id: "job_1",
              problem_solving: 4,
              agency: 3,
              competitiveness: 2,
              curious: 1,
              total_score: 16.5,
              source: "puddle_ashby_score",
            },
          ],
          historicalLinks: [],
        }),
      evaluate,
      write(message) {
        output.push(message);
      },
    });

    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ cases: [] }),
    );
    expect(result.inventory.skipped.missingScores).toBe(1);
    expect(JSON.parse(output.join("")).inventory.evaluatableCases).toBe(0);
  });
});

function fakePuddleDb(input: {
  readonly puddleLabels?: readonly Record<string, unknown>[];
  readonly historicalLinks?: readonly Record<string, unknown>[];
} = {}) {
  const puddleLabels =
    input.puddleLabels ??
    [
      {
        session_id: "sess_puddle",
        organization_id: organizationId,
        candidate_name: "Private Candidate",
        ashby_job_id: "job_1",
        problem_solving: 4,
        agency: 3,
        competitiveness: 2,
        curious: 1,
        total_score: 10,
        comments: "Human comment that should stay private by default",
        source: "puddle_ashby_score",
        candidate_email: candidateEmail,
      },
    ];
  const historicalLinks =
    input.historicalLinks ??
    [
      {
        session_id: "sess_weave",
        organization_id: organizationId,
        candidate_name: "Historical Candidate",
        candidate_evaluation_id: "eval_1",
        ashby_job_id: "job_1",
        ashby_application_id: "app_1",
        source: "weave_candidate_evaluation",
        candidate_email: candidateEmail,
      },
    ];

  return {
    async query(sql: string) {
      if (sql.includes("JOIN ashby_candidate_scores sc")) {
        return {
          rows: puddleLabels,
        };
      }
      if (sql.includes("candidate_evaluation_id IS NOT NULL")) {
        return { rows: historicalLinks };
      }
      if (sql.includes("FROM transcript_turns")) {
        return {
          rows: [
            {
              session_id: "sess_puddle",
              turn_index: 0,
              speaker: "candidate",
              text: transcriptMarker,
            },
            {
              session_id: "sess_weave",
              turn_index: 0,
              speaker: "candidate",
              text: transcriptMarker,
            },
          ],
        };
      }
      throw new Error(`Unexpected Puddle query: ${sql}`);
    },
  };
}

function fakeWeaveDb() {
  return {
    async query(sql: string) {
      if (sql.includes("FROM candidate_evaluations ev")) {
        return {
          rows: [
            {
              candidate_evaluation_id: "eval_1",
              candidate_name: "Weave Candidate",
              ashby_job_id: "job_1",
              problem_solving: 3,
              agency: 2,
              competitiveness: 4,
              curious: 1,
              total_score: 10,
              comments: "Weave comment",
              source: "weave_candidate_evaluation",
              candidate_email: candidateEmail,
            },
          ],
        };
      }
      throw new Error(`Unexpected Weave query: ${sql}`);
    },
  };
}
