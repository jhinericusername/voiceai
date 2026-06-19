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
          "--export-calibration",
          "--include-transcript-output",
          "--sample-size",
          "4",
          "--sample-seed",
          "seed-1",
          "--output-file",
          "artifacts/calibration/weave.json",
          "--calibration-file",
          "artifacts/calibration/weave.json",
          "--error-report-file",
          "artifacts/reports/weave-eval.json",
          "--calibration-transcript-max-chars",
          "1200",
          "--bedrock-region",
          "us-west-2",
          "--model-provider",
          "openai",
          "--model-id",
          "gpt-5.5",
          "--openai-reasoning-effort",
          "high",
          "--openai-verbosity",
          "low",
          "--model-call-timeout-ms",
          "90000",
        ],
        {},
      ),
    ).toEqual({
      organizationId,
      ashbyJobId: "job_123",
      limit: 25,
      batchSize: 3,
      dryRun: true,
      exportCalibration: true,
      includeTranscriptOutput: true,
      calibrationExampleLimit: 3,
      sampleSize: 4,
      sampleSeed: "seed-1",
      outputFile: "artifacts/calibration/weave.json",
      calibrationFile: "artifacts/calibration/weave.json",
      errorReportFile: "artifacts/reports/weave-eval.json",
      calibrationTranscriptMaxChars: 1200,
      modelProvider: "openai",
      bedrockRegion: "us-west-2",
      modelId: "gpt-5.5",
      openaiReasoningEffort: "high",
      openaiVerbosity: "low",
      modelCallTimeoutMs: 90000,
    });
  });

  it("parses repeated and comma-separated session id filters", () => {
    expect(
      parseEvaluationCliArgs(
        [
          "--organization-id",
          organizationId,
          "--session-id",
          "sess_puddle, sess_weave",
          "--session-id",
          "sess_extra",
          "--session-id",
          "sess_puddle",
        ],
        {},
      ),
    ).toMatchObject({
      sessionIds: ["sess_puddle", "sess_weave", "sess_extra"],
    });
    expect(() =>
      parseEvaluationCliArgs(["--organization-id", organizationId, "--session-id", ","], {}),
    ).toThrow(/--session-id requires at least one non-empty value/);
  });

  it("uses environment defaults for model configuration", () => {
    expect(
      parseEvaluationCliArgs(["--organization-id", organizationId], {
        AWS_REGION: "us-east-2",
        PUDDLE_GRADING_MODEL_ID: "env-model",
        PUDDLE_GRADING_MODEL_CALL_TIMEOUT_MS: "120000",
      }),
    ).toMatchObject({
      modelProvider: "bedrock",
      bedrockRegion: "us-east-2",
      modelId: "env-model",
      modelCallTimeoutMs: 120000,
    });
  });

  it("uses OpenAI defaults when OpenAI is selected", () => {
    expect(
      parseEvaluationCliArgs(["--organization-id", organizationId, "--model-provider", "openai"], {}),
    ).toMatchObject({
      modelProvider: "openai",
      modelId: "gpt-5.5",
      openaiReasoningEffort: "high",
      openaiVerbosity: "low",
    });
  });

  it("rejects invalid model provider and OpenAI controls", () => {
    expect(() =>
      parseEvaluationCliArgs(["--organization-id", organizationId, "--model-provider", "local"], {}),
    ).toThrow(/--model-provider must be one of/);
    expect(() =>
      parseEvaluationCliArgs(
        ["--organization-id", organizationId, "--openai-reasoning-effort", "maximum"],
        {},
      ),
    ).toThrow(/--openai-reasoning-effort must be one of/);
    expect(() =>
      parseEvaluationCliArgs(["--organization-id", organizationId, "--openai-verbosity", "tiny"], {}),
    ).toThrow(/--openai-verbosity must be one of/);
  });

  it("validates model call timeout bounds", () => {
    expect(parseEvaluationCliArgs(["--organization-id", organizationId], {})).toMatchObject({
      modelCallTimeoutMs: 180000,
    });
    expect(parseEvaluationCliArgs(["--organization-id", organizationId, "--model-call-timeout-ms", "0"], {})).toMatchObject({
      modelCallTimeoutMs: 0,
    });
    expect(
      parseEvaluationCliArgs(["--organization-id", organizationId, "--model-call-timeout-ms", "1800000"], {}),
    ).toMatchObject({
      modelCallTimeoutMs: 1800000,
    });
    expect(() =>
      parseEvaluationCliArgs(["--organization-id", organizationId, "--model-call-timeout-ms", "-1"], {}),
    ).toThrow(/--model-call-timeout-ms must be between 0 and 1800000/);
    expect(() =>
      parseEvaluationCliArgs(["--organization-id", organizationId, "--model-call-timeout-ms", "1800001"], {}),
    ).toThrow(/--model-call-timeout-ms must be between 0 and 1800000/);
  });

  it("accepts a leading pnpm argument separator", () => {
    expect(
      parseEvaluationCliArgs(["--", "--organization-id", organizationId, "--dry-run"], {}),
    ).toMatchObject({
      organizationId,
      dryRun: true,
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

  it("validates calibration sample size bounds", () => {
    expect(parseEvaluationCliArgs(["--organization-id", organizationId, "--sample-size", "1"], {})).toMatchObject({
      sampleSize: 1,
    });
    expect(parseEvaluationCliArgs(["--organization-id", organizationId, "--sample-size", "20"], {})).toMatchObject({
      sampleSize: 20,
    });
    expect(() =>
      parseEvaluationCliArgs(["--organization-id", organizationId, "--sample-size", "0"], {}),
    ).toThrow(/--sample-size must be between 1 and 20/);
    expect(() =>
      parseEvaluationCliArgs(["--organization-id", organizationId, "--sample-size", "21"], {}),
    ).toThrow(/--sample-size must be between 1 and 20/);
  });

  it("validates calibration transcript excerpt bounds", () => {
    expect(parseEvaluationCliArgs(["--organization-id", organizationId, "--calibration-transcript-max-chars", "0"], {})).toMatchObject({
      calibrationTranscriptMaxChars: 0,
    });
    expect(parseEvaluationCliArgs(["--organization-id", organizationId, "--calibration-transcript-max-chars", "12000"], {})).toMatchObject({
      calibrationTranscriptMaxChars: 12000,
    });
    expect(() =>
      parseEvaluationCliArgs(["--organization-id", organizationId, "--calibration-transcript-max-chars", "-1"], {}),
    ).toThrow(/--calibration-transcript-max-chars must be between 0 and 12000/);
    expect(() =>
      parseEvaluationCliArgs(["--organization-id", organizationId, "--calibration-transcript-max-chars", "12001"], {}),
    ).toThrow(/--calibration-transcript-max-chars must be between 0 and 12000/);
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

  it("keeps dry-run inventory as the loaded universe when filtering by session id", async () => {
    const output: string[] = [];
    const createModel = vi.fn(() => {
      throw new Error("model should not be created during dry-run");
    });
    const evaluate = vi.fn();

    const result = await runGradingEvaluationCli(
      ["--organization-id", organizationId, "--dry-run", "--session-id", "sess_weave"],
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
    expect(result.inventory.evaluatableCases).toBe(2);
    expect(JSON.parse(output.join("")).inventory.evaluatableCases).toBe(2);
    expect(JSON.stringify(output)).not.toContain(transcriptMarker);
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

  it("exports seeded calibration examples without model calls and redacts console output when writing a file", async () => {
    const output: string[] = [];
    const written: Array<{ path: string; contents: string }> = [];
    const createModel = vi.fn(() => {
      throw new Error("model should not be created during calibration export");
    });
    const evaluate = vi.fn();

    const result = await runGradingEvaluationCli(
      [
        "--organization-id",
        organizationId,
        "--export-calibration",
        "--include-transcript-output",
        "--sample-size",
        "2",
        "--sample-seed",
        "fixed-seed",
        "--output-file",
        "artifacts/calibration/weave.json",
      ],
      {
        getPuddlePool: () => fakePuddleDb(),
        getWeavePool: () => fakeWeaveDb(),
        createModel,
        evaluate,
        async writeFile(path, contents) {
          written.push({ path, contents });
        },
        write(message) {
          output.push(message);
        },
      },
    );

    expect(createModel).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
    expect(result.mode).toBe("calibration-export");
    expect(written).toHaveLength(1);
    expect(written[0]?.path).toBe("artifacts/calibration/weave.json");

    const filePayload = JSON.parse(written[0]?.contents ?? "{}");
    expect(filePayload.mode).toBe("calibration-export");
    expect(filePayload.sample.seed).toBe("fixed-seed");
    expect(filePayload.sample.requestedExampleCount).toBe(2);
    expect(filePayload.sample.eligibleCaseCount).toBe(2);
    expect(filePayload.sample.excludedOutOfScaleScoreCases).toBe(0);
    expect(filePayload.sample.examples).toHaveLength(2);
    expect(filePayload.sample.examples[0]).toMatchObject({
      scores: expect.any(Object),
      transcriptTurnCount: 1,
    });
    expect(JSON.stringify(filePayload)).toContain(transcriptMarker);
    expect(JSON.stringify(filePayload)).toContain("Weave comment");

    const consolePayload = JSON.parse(output.join(""));
    expect(consolePayload.mode).toBe("calibration-export");
    expect(consolePayload.inventory.skipped.missingTranscript).toBe(0);
    expect(consolePayload.outputFile).toBe("artifacts/calibration/weave.json");
    expect(consolePayload.sample.examples[0].transcriptTurnCount).toBe(1);
    expect(JSON.stringify(consolePayload)).not.toContain(transcriptMarker);
    expect(JSON.stringify(consolePayload)).not.toContain(candidateEmail);
    expect(JSON.stringify(consolePayload)).not.toContain("Private Candidate");
    expect(JSON.stringify(consolePayload)).not.toContain("Weave comment");
    expect(consolePayload.sample.examples[0]).not.toHaveProperty("transcriptTurns");
  });

  it("exports calibration examples only for matching session ids while inventory stays unfiltered", async () => {
    const output: string[] = [];

    const result = await runGradingEvaluationCli(
      [
        "--organization-id",
        organizationId,
        "--export-calibration",
        "--sample-size",
        "2",
        "--session-id",
        "missing_session,sess_weave",
      ],
      {
        getPuddlePool: () => fakePuddleDb(),
        getWeavePool: () => fakeWeaveDb(),
        write(message) {
          output.push(message);
        },
      },
    );

    expect(result.mode).toBe("calibration-export");
    expect(result.inventory.evaluatableCases).toBe(2);
    expect(result.sample.eligibleCaseCount).toBe(1);
    expect(result.sample.examples.map((example) => example.sessionId)).toEqual(["sess_weave"]);

    const printed = output.join("");
    const consolePayload = JSON.parse(printed);
    expect(consolePayload.inventory.evaluatableCases).toBe(2);
    expect(consolePayload.sample.examples.map((example: { sessionId: string }) => example.sessionId)).toEqual([
      "sess_weave",
    ]);
    expect(printed).not.toContain(transcriptMarker);
  });

  it("excludes out-of-scale zero-score cases from calibration exports", async () => {
    const output: string[] = [];

    const result = await runGradingEvaluationCli(
      ["--organization-id", organizationId, "--export-calibration", "--sample-size", "2"],
      {
        getPuddlePool: () => fakePuddleDb(),
        getWeavePool: () =>
          fakeWeaveDb({
            weaveLabels: [
              {
                candidate_evaluation_id: "eval_1",
                candidate_name: "Zero Score Candidate",
                ashby_job_id: "job_1",
                problem_solving: 0,
                agency: 0,
                competitiveness: 0,
                curious: 0,
                total_score: 0,
                comments: "Zero score placeholder",
                source: "weave_candidate_evaluation",
                candidate_email: candidateEmail,
              },
            ],
          }),
        write(message) {
          output.push(message);
        },
      },
    );

    expect(result.mode).toBe("calibration-export");
    expect(result.inventory.evaluatableCases).toBe(2);
    expect(result.sample.eligibleCaseCount).toBe(1);
    expect(result.sample.excludedOutOfScaleScoreCases).toBe(1);
    expect(result.sample.examples).toHaveLength(1);
    expect(result.sample.examples[0]?.source).toBe("puddle_ashby_score");
    expect(JSON.parse(output.join("")).sample.examples).toHaveLength(1);
  });

  it("loads calibration examples from a file, holds them out, and writes a redacted error report", async () => {
    const output: string[] = [];
    const written: Array<{ path: string; contents: string }> = [];
    const readFile = vi.fn(async () =>
      JSON.stringify({
        sample: {
          examples: [
            {
              id: "weave_candidate_evaluation:sess_weave",
              sessionId: "sess_weave",
              scores: {
                problem_solving: 3,
                agency: 2,
                competitiveness: 4,
                curious: 1,
              },
              totalScore: 10,
              comment: "Calibration human comment",
              transcriptTurns: [{ speaker: "candidate", text: transcriptMarker }],
            },
          ],
        },
      }),
    );
    const evaluate = vi.fn(async (input: {
      readonly cases: readonly LabeledInterviewCase[];
      readonly options: { readonly calibrationExamples?: readonly unknown[] };
    }) => ({
      caseCount: input.cases.length,
      succeeded: 1,
      failed: 0,
      batchSize: 1,
      modelCallCount: 1,
      aggregate: {
        meanAbsoluteError: 0.5,
        exactRate: 0.5,
        withinHalfPointRate: 1,
        dimensions: {},
      },
      cases: [
        {
          status: "succeeded",
          sessionId: "sess_puddle",
          candidateName: null,
          ashbyJobId: "job_1",
          source: "puddle_ashby_score",
          humanScores: input.cases[0]?.humanScores,
          humanTotalScore: input.cases[0]?.humanTotalScore,
          predictedCategoryScores: [
            { category: "problem_solving", score: 3 },
            { category: "agency", score: 3 },
            { category: "competitiveness", score: 2 },
            { category: "curious", score: 1 },
          ],
          predictedTotalScore: 9,
          comparison: {
            meanAbsoluteError: 0.5,
            exactRate: 0.5,
            withinHalfPointRate: 1,
            dimensionErrors: [
              {
                category: "problem_solving",
                dimension: "problem_solving",
                expected: 4,
                actual: 3,
                absoluteError: 1,
                exact: false,
                exactMatch: false,
                withinHalfPoint: false,
              },
            ],
          },
          warnings: [`warning with ${transcriptMarker}`],
        },
      ],
    }));

    const result = await runGradingEvaluationCli(
      [
        "--organization-id",
        organizationId,
        "--calibration-file",
        "artifacts/calibration/weave.json",
        "--calibration-example-limit",
        "1",
        "--calibration-transcript-max-chars",
        "100",
        "--error-report-file",
        "artifacts/reports/weave-eval.json",
      ],
      {
        getPuddlePool: () => fakePuddleDb(),
        getWeavePool: () => fakeWeaveDb(),
        createModel: () => ({
          async complete() {
            return "";
          },
        }),
        readFile,
        async writeFile(path, contents) {
          written.push({ path, contents });
        },
        evaluate,
        write(message) {
          output.push(message);
        },
      },
    );

    expect(readFile).toHaveBeenCalledWith("artifacts/calibration/weave.json");
    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        cases: [
          expect.objectContaining({
            sessionId: "sess_puddle",
          }),
        ],
        options: expect.objectContaining({
          calibrationExamples: [
            expect.objectContaining({
              id: "weave_candidate_evaluation:sess_weave",
              transcriptExcerpt: expect.stringContaining(transcriptMarker),
            }),
          ],
        }),
      }),
    );
    expect(result.mode).toBe("evaluation");
    expect(result.modelConfig).toEqual({
      provider: "bedrock",
      region: "us-east-1",
      modelId: "us.anthropic.claude-opus-4-8",
      modelCallTimeoutMs: 180000,
    });
    expect(result.evaluationSet).toMatchObject({
      loadedCases: 2,
      excludedCalibrationCases: 1,
      excludedOutOfScaleScoreCases: 0,
      evaluatedCases: 1,
      calibrationExampleCount: 1,
      calibrationFile: "artifacts/calibration/weave.json",
    });
    expect(written).toHaveLength(1);
    expect(written[0]?.path).toBe("artifacts/reports/weave-eval.json");
    const errorReport = JSON.parse(written[0]?.contents ?? "{}");
    expect(errorReport.largestDisagreements).toHaveLength(1);
    expect(errorReport.largestDisagreements[0]).toMatchObject({
      sessionId: "sess_puddle",
      meanAbsoluteError: 0.5,
    });
    expect(JSON.stringify(errorReport)).not.toContain(transcriptMarker);
    expect(JSON.stringify(output)).not.toContain(transcriptMarker);
  });

  it("evaluates loaded cases with injected model and include-transcript option", async () => {
    const output: string[] = [];
    const progressOutput: string[] = [];
    const fakeModel: GradingModel = {
      async complete() {
        throw new Error("fake evaluator should own model behavior");
      },
    };
    const createModel = vi.fn(() => fakeModel);
    const evaluate = vi.fn(async (input: {
      readonly cases: readonly LabeledInterviewCase[];
      readonly model: GradingModel;
      readonly options: {
        readonly includeTranscriptInOutput?: boolean;
        readonly progress?: (event: {
          readonly type: "case_started" | "case_finished";
          readonly caseIndex: number;
          readonly caseCount: number;
          readonly sessionId: string;
          readonly ashbyJobId: string;
          readonly source: LabeledInterviewCase["source"];
          readonly status?: "succeeded" | "failed";
          readonly elapsedMs?: number;
          readonly modelCallCount: number;
        }) => void;
      };
    }) => {
      input.options.progress?.({
        type: "case_started",
        caseIndex: 1,
        caseCount: input.cases.length,
        sessionId: input.cases[0]?.sessionId ?? "missing",
        ashbyJobId: input.cases[0]?.ashbyJobId ?? "missing",
        source: input.cases[0]?.source ?? "puddle_ashby_score",
        modelCallCount: 0,
      });
      input.options.progress?.({
        type: "case_finished",
        caseIndex: 1,
        caseCount: input.cases.length,
        sessionId: input.cases[0]?.sessionId ?? "missing",
        ashbyJobId: input.cases[0]?.ashbyJobId ?? "missing",
        source: input.cases[0]?.source ?? "puddle_ashby_score",
        status: "succeeded",
        elapsedMs: 42,
        modelCallCount: 1,
      });
      return {
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
      };
    });

    const result = await runGradingEvaluationCli(
      [
        "--organization-id",
        organizationId,
        "--batch-size",
        "2",
        "--calibration-example-limit",
        "1",
        "--include-transcript-output",
        "--model-call-timeout-ms",
        "90000",
      ],
      {
        getPuddlePool: () => fakePuddleDb(),
        getWeavePool: () => fakeWeaveDb(),
        createModel,
        evaluate,
        write(message) {
          output.push(message);
        },
        writeProgress(message) {
          progressOutput.push(message);
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
        options: expect.objectContaining({
          batchSize: 2,
          calibrationExampleLimit: 1,
          includeTranscriptInOutput: true,
          modelCallTimeoutMs: 90000,
          progress: expect.any(Function),
        }),
      }),
    );
    expect(result.mode).toBe("evaluation");
    const printed = output.join("");
    expect(printed).toContain(transcriptMarker);
    expect(JSON.parse(printed).report.includeTranscriptInOutput).toBe(true);

    const progressLines = progressOutput.join("").trim().split("\n").map((line) => JSON.parse(line));
    expect(progressLines).toEqual([
      {
        event: "grading_evaluation_case_started",
        caseIndex: 1,
        caseCount: 2,
        sessionId: "sess_puddle",
        ashbyJobId: "job_1",
        source: "puddle_ashby_score",
        modelCallCount: 0,
      },
      {
        event: "grading_evaluation_case_finished",
        caseIndex: 1,
        caseCount: 2,
        sessionId: "sess_puddle",
        ashbyJobId: "job_1",
        source: "puddle_ashby_score",
        status: "succeeded",
        elapsedMs: 42,
        modelCallCount: 1,
      },
    ]);
    expect(JSON.stringify(progressLines)).not.toContain(transcriptMarker);
    expect(JSON.stringify(progressLines)).not.toContain(candidateEmail);
    expect(JSON.stringify(progressLines)).not.toContain("Private Candidate");
  });

  it("evaluates only matching session ids while inventory stays unfiltered", async () => {
    const output: string[] = [];
    const fakeModel: GradingModel = {
      async complete() {
        throw new Error("fake evaluator should own model behavior");
      },
    };
    const evaluate = vi.fn(async (input: { readonly cases: readonly LabeledInterviewCase[] }) => ({
      caseCount: input.cases.length,
      succeeded: input.cases.length,
      failed: 0,
      batchSize: 3,
      modelCallCount: input.cases.length,
      aggregate: {},
      cases: input.cases.map((interviewCase) => ({
        status: "succeeded",
        sessionId: interviewCase.sessionId,
      })),
    }));

    const result = await runGradingEvaluationCli(
      [
        "--organization-id",
        organizationId,
        "--session-id",
        "missing_session,sess_weave",
      ],
      {
        getPuddlePool: () => fakePuddleDb(),
        getWeavePool: () => fakeWeaveDb(),
        createModel: () => fakeModel,
        evaluate,
        write(message) {
          output.push(message);
        },
      },
    );

    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({
        cases: [
          expect.objectContaining({
            sessionId: "sess_weave",
            source: "weave_candidate_evaluation",
          }),
        ],
      }),
    );
    expect(result.mode).toBe("evaluation");
    expect(result.inventory.evaluatableCases).toBe(2);
    expect(result.evaluationSet).toMatchObject({
      loadedCases: 1,
      evaluatedCases: 1,
    });

    const printed = output.join("");
    const consolePayload = JSON.parse(printed);
    expect(consolePayload.inventory.evaluatableCases).toBe(2);
    expect(consolePayload.evaluationSet.loadedCases).toBe(1);
    expect(consolePayload.report.cases.map((item: { sessionId: string }) => item.sessionId)).toEqual([
      "sess_weave",
    ]);
    expect(printed).not.toContain(transcriptMarker);
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

function fakeWeaveDb(input: {
  readonly weaveLabels?: readonly Record<string, unknown>[];
} = {}) {
  const weaveLabels =
    input.weaveLabels ??
    [
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
    ];

  return {
    async query(sql: string) {
      if (sql.includes("FROM candidate_evaluations ev")) {
        return {
          rows: weaveLabels,
        };
      }
      throw new Error(`Unexpected Weave query: ${sql}`);
    },
  };
}
