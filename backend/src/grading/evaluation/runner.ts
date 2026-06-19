import {
  buildScoringCalibrationInput,
  type CalibrationExample,
  clampEvaluationBatchSize,
  defaultCalibrationExamples,
  selectCalibrationExamples,
} from "./calibration.js";
import {
  compareScorecardScores,
  type DimensionError,
  type EvaluationDimensionKey,
  type ScoreComparison,
} from "./scorecard.js";
import {
  scoreTranscript,
  type GradingModel,
  type GradingModelCompleteOptions,
  type ParsedCategoryScore,
  type TranscriptTurnLike,
} from "../scoring.js";

export interface LabeledInterviewCase {
  readonly sessionId: string;
  readonly candidateName: string | null;
  readonly ashbyJobId: string;
  readonly transcriptTurns: readonly TranscriptTurnLike[];
  readonly humanScores: Record<EvaluationDimensionKey, number>;
  readonly humanTotalScore: number;
  readonly humanComment?: string;
  readonly source: "puddle_ashby_score" | "weave_candidate_evaluation" | "markdown_scorecard";
}

export interface EvaluationRunOptions {
  readonly batchSize: number;
  readonly calibrationExampleLimit: number;
  readonly calibrationExamples?: readonly CalibrationExample[];
  readonly includeTranscriptInOutput?: boolean;
  readonly modelCallTimeoutMs?: number;
  readonly progress?: (event: EvaluationProgressEvent) => void;
}

interface EvaluationProgressBase {
  readonly caseIndex: number;
  readonly caseCount: number;
  readonly sessionId: string;
  readonly ashbyJobId: string;
  readonly source: LabeledInterviewCase["source"];
  readonly modelCallCount: number;
}

export type EvaluationProgressEvent =
  | ({
      readonly type: "case_started";
    } & EvaluationProgressBase)
  | ({
      readonly type: "case_finished";
      readonly status: EvaluationCaseResult["status"];
      readonly elapsedMs: number;
    } & EvaluationProgressBase);

export interface EvaluationDimensionAggregate {
  readonly count: number;
  readonly meanAbsoluteError: number | null;
  readonly exactRate: number | null;
  readonly withinHalfPointRate: number | null;
}

export interface EvaluationAggregate {
  readonly meanAbsoluteError: number | null;
  readonly exactRate: number | null;
  readonly withinHalfPointRate: number | null;
  readonly dimensions: Record<EvaluationDimensionKey, EvaluationDimensionAggregate>;
}

export interface EvaluationPredictedCategoryScore {
  readonly category: string;
  readonly score: number;
  readonly confidence?: number;
  readonly evidenceQuotes?: readonly string[];
  readonly rationale?: string;
}

export interface EvaluationCaseResult {
  readonly status: "succeeded" | "failed";
  readonly sessionId: string;
  readonly candidateName: string | null;
  readonly ashbyJobId: string;
  readonly source: LabeledInterviewCase["source"];
  readonly humanScores: Record<EvaluationDimensionKey, number>;
  readonly humanTotalScore: number;
  readonly humanComment?: string;
  readonly predictedCategoryScores?: readonly EvaluationPredictedCategoryScore[];
  readonly predictedTotalScore?: number;
  readonly comparison?: ScoreComparison;
  readonly warnings: readonly string[];
  readonly errorMessage?: string;
  readonly transcriptTurns?: readonly TranscriptTurnLike[];
}

export interface EvaluationReport {
  readonly caseCount: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly batchSize: number;
  readonly modelCallCount: number;
  readonly aggregate: EvaluationAggregate;
  readonly cases: readonly EvaluationCaseResult[];
}

const DIMENSIONS: readonly EvaluationDimensionKey[] = [
  "problem_solving",
  "agency",
  "competitiveness",
  "curious",
];

export async function evaluateLabeledInterviews(input: {
  readonly cases: readonly LabeledInterviewCase[];
  readonly rubric: unknown;
  readonly model: GradingModel;
  readonly options: EvaluationRunOptions;
}): Promise<EvaluationReport> {
  const batchSize = clampEvaluationBatchSize(input.options.batchSize);
  const defaultCalibration = buildScoringCalibrationInput();
  const gradingGuide = defaultCalibration.gradingGuide;
  const dimensionScoreAnchors = defaultCalibration.dimensionScoreAnchors;
  const calibrationExamples = selectCalibrationExamples(
    input.options.calibrationExamples ?? defaultCalibrationExamples(),
    input.options.calibrationExampleLimit,
  );
  const modelCallTimeoutMs = normalizeModelCallTimeoutMs(input.options.modelCallTimeoutMs);
  let modelCallCount = 0;
  const countingModel: GradingModel = {
    complete: async (prompt, options) => {
      modelCallCount += 1;
      return completeWithTimeout(input.model, prompt, options, modelCallTimeoutMs);
    },
  };
  const results: Array<EvaluationCaseResult | undefined> = new Array(input.cases.length);
  let nextCaseOffset = 0;

  async function runWorker(): Promise<void> {
    while (nextCaseOffset < input.cases.length) {
      const currentOffset = nextCaseOffset;
      nextCaseOffset += 1;
      const interviewCase = input.cases[currentOffset];
      if (!interviewCase) {
        return;
      }
      const currentCaseIndex = currentOffset + 1;
      input.options.progress?.({
        type: "case_started",
        caseIndex: currentCaseIndex,
        caseCount: input.cases.length,
        sessionId: interviewCase.sessionId,
        ashbyJobId: interviewCase.ashbyJobId,
        source: interviewCase.source,
        modelCallCount,
      });
      const startedAt = Date.now();
      const result = await evaluateOneCase({
        interviewCase,
        rubric: input.rubric,
        model: countingModel,
        gradingGuide,
        dimensionScoreAnchors,
        calibrationExamples,
        includeTranscriptInOutput: input.options.includeTranscriptInOutput === true,
      });
      input.options.progress?.({
        type: "case_finished",
        caseIndex: currentCaseIndex,
        caseCount: input.cases.length,
        sessionId: interviewCase.sessionId,
        ashbyJobId: interviewCase.ashbyJobId,
        source: interviewCase.source,
        status: result.status,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        modelCallCount,
      });
      results[currentOffset] = result;
    }
  }

  const workerCount = Math.min(batchSize, input.cases.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  const orderedResults = results.filter(
    (result): result is EvaluationCaseResult => result !== undefined,
  );

  const succeeded = orderedResults.filter((result) => result.status === "succeeded").length;

  return {
    caseCount: input.cases.length,
    succeeded,
    failed: orderedResults.length - succeeded,
    batchSize,
    modelCallCount,
    aggregate: buildAggregate(orderedResults),
    cases: orderedResults,
  };
}

async function completeWithTimeout(
  model: GradingModel,
  prompt: string,
  options: GradingModelCompleteOptions | undefined,
  timeoutMs: number | undefined,
): Promise<string> {
  if (timeoutMs === undefined) {
    return model.complete(prompt, options);
  }

  const timeoutMessage = `Model call timed out after ${timeoutMs}ms.`;
  const controller = new AbortController();
  const parentSignal = options?.signal;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortParentListener: (() => void) | undefined;

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      abortParentListener = () => controller.abort();
      parentSignal.addEventListener("abort", abortParentListener, { once: true });
    }
  }

  const modelPromise = model.complete(prompt, {
    ...(options ?? {}),
    signal: controller.signal,
  });
  modelPromise.catch(() => undefined);

  const timeoutPromise = new Promise<string>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([modelPromise, timeoutPromise]);
  } catch (error) {
    if (timedOut) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (parentSignal && abortParentListener) {
      parentSignal.removeEventListener("abort", abortParentListener);
    }
  }
}

function normalizeModelCallTimeoutMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.trunc(value);
}

async function evaluateOneCase(input: {
  readonly interviewCase: LabeledInterviewCase;
  readonly rubric: unknown;
  readonly model: GradingModel;
  readonly gradingGuide: string;
  readonly dimensionScoreAnchors: Parameters<typeof scoreTranscript>[0]["dimensionScoreAnchors"];
  readonly calibrationExamples: Parameters<typeof scoreTranscript>[0]["calibrationExamples"];
  readonly includeTranscriptInOutput: boolean;
}): Promise<EvaluationCaseResult> {
  const { interviewCase } = input;

  try {
    const parsed = await scoreTranscript(
      {
        rubric: input.rubric,
        transcriptTurns: interviewCase.transcriptTurns,
        gradingGuide: input.gradingGuide,
        dimensionScoreAnchors: input.dimensionScoreAnchors,
        calibrationExamples: input.calibrationExamples,
      },
      input.model,
    );
    try {
      const comparison = compareScorecardScores(interviewCase.humanScores, parsed.categoryScores);
      return withOptionalTranscript(
        {
          ...baseCaseResult(interviewCase, input.includeTranscriptInOutput),
          status: "succeeded",
          predictedCategoryScores: categoryScoresForOutput(
            parsed.categoryScores,
            input.includeTranscriptInOutput,
          ),
          predictedTotalScore: predictedTotalScore(comparison.dimensionErrors),
          comparison,
          warnings: warningsForOutput(parsed.warnings, input.includeTranscriptInOutput),
        },
        interviewCase,
        input.includeTranscriptInOutput,
      );
    } catch (error) {
      return withOptionalTranscript(
        {
          ...baseCaseResult(interviewCase, input.includeTranscriptInOutput),
          status: "failed",
          ...(input.includeTranscriptInOutput
            ? {
                predictedCategoryScores: categoryScoresForOutput(
                  parsed.categoryScores,
                  input.includeTranscriptInOutput,
                ),
              }
            : {}),
          warnings: warningsForOutput(parsed.warnings, input.includeTranscriptInOutput),
          errorMessage: sanitizeErrorMessage(error, input.includeTranscriptInOutput),
        },
        interviewCase,
        input.includeTranscriptInOutput,
      );
    }
  } catch (error) {
    return withOptionalTranscript(
        {
          ...baseCaseResult(interviewCase, input.includeTranscriptInOutput),
          status: "failed",
          warnings: [],
          errorMessage: sanitizeErrorMessage(error, input.includeTranscriptInOutput),
        },
        interviewCase,
        input.includeTranscriptInOutput,
    );
  }
}

function baseCaseResult(
  interviewCase: LabeledInterviewCase,
  includeTranscriptInOutput: boolean,
): Omit<
  EvaluationCaseResult,
  | "status"
  | "predictedCategoryScores"
  | "predictedTotalScore"
  | "comparison"
  | "warnings"
  | "errorMessage"
  | "transcriptTurns"
> {
  return {
    sessionId: interviewCase.sessionId,
    candidateName: includeTranscriptInOutput ? interviewCase.candidateName : null,
    ashbyJobId: interviewCase.ashbyJobId,
    source: interviewCase.source,
    humanScores: interviewCase.humanScores,
    humanTotalScore: interviewCase.humanTotalScore,
    ...(!includeTranscriptInOutput || interviewCase.humanComment === undefined
      ? {}
      : { humanComment: interviewCase.humanComment }),
  };
}

function withOptionalTranscript(
  result: EvaluationCaseResult,
  interviewCase: LabeledInterviewCase,
  includeTranscriptInOutput: boolean,
): EvaluationCaseResult {
  if (!includeTranscriptInOutput) {
    return result;
  }
  return {
    ...result,
    transcriptTurns: interviewCase.transcriptTurns,
  };
}

function categoryScoresForOutput(
  categoryScores: readonly ParsedCategoryScore[],
  includeTranscriptInOutput: boolean,
): readonly EvaluationPredictedCategoryScore[] {
  if (includeTranscriptInOutput) {
    return categoryScores;
  }
  return categoryScores
    .filter((categoryScore) => isEvaluationDimension(categoryScore.category))
    .map((categoryScore) => ({
      category: categoryScore.category,
      score: categoryScore.score,
      ...(categoryScore.confidence === undefined ? {} : { confidence: categoryScore.confidence }),
    }));
}

function isEvaluationDimension(value: string): value is EvaluationDimensionKey {
  return (DIMENSIONS as readonly string[]).includes(value);
}

function warningsForOutput(
  warnings: readonly string[],
  includeTranscriptInOutput: boolean,
): readonly string[] {
  if (includeTranscriptInOutput) {
    return warnings;
  }
  return warnings.length === 0 ? [] : ["redacted_model_warnings"];
}

function buildAggregate(results: readonly EvaluationCaseResult[]): EvaluationAggregate {
  const dimensionErrors = results.flatMap((result) => result.comparison?.dimensionErrors ?? []);

  return {
    meanAbsoluteError: mean(dimensionErrors.map((error) => error.absoluteError)),
    exactRate: rate(dimensionErrors.map((error) => error.exact)),
    withinHalfPointRate: rate(dimensionErrors.map((error) => error.withinHalfPoint)),
    dimensions: Object.fromEntries(
      DIMENSIONS.map((dimension) => {
        const errors = dimensionErrors.filter((error) => error.dimension === dimension);
        return [
          dimension,
          {
            count: errors.length,
            meanAbsoluteError: mean(errors.map((error) => error.absoluteError)),
            exactRate: rate(errors.map((error) => error.exact)),
            withinHalfPointRate: rate(errors.map((error) => error.withinHalfPoint)),
          },
        ];
      }),
    ) as Record<EvaluationDimensionKey, EvaluationDimensionAggregate>,
  };
}

function predictedTotalScore(errors: readonly DimensionError[]): number {
  return roundMetric(errors.reduce((sum, error) => sum + error.actual, 0));
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function rate(values: readonly boolean[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return roundMetric(values.filter(Boolean).length / values.length);
}

function roundMetric(value: number): number {
  return Number(value.toFixed(10));
}

function sanitizeErrorMessage(
  error: unknown,
  includeTranscriptInOutput: boolean,
): string {
  let message = error instanceof Error ? error.message : String(error);
  if (!message.trim()) {
    message = "Unknown scoring error.";
  }

  return includeTranscriptInOutput ? message : "Scoring failed.";
}
