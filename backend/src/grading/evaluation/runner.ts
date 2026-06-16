import {
  buildDefaultGradingGuide,
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
  readonly includeTranscriptInOutput?: boolean;
}

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
  const gradingGuide = buildDefaultGradingGuide();
  const calibrationExamples = selectCalibrationExamples(
    defaultCalibrationExamples(),
    input.options.calibrationExampleLimit,
  );
  let modelCallCount = 0;
  const countingModel: GradingModel = {
    complete: async (prompt) => {
      modelCallCount += 1;
      return input.model.complete(prompt);
    },
  };
  const results: EvaluationCaseResult[] = [];

  for (let offset = 0; offset < input.cases.length; offset += batchSize) {
    const batch = input.cases.slice(offset, offset + batchSize);
    for (const interviewCase of batch) {
      results.push(
        await evaluateOneCase({
          interviewCase,
          rubric: input.rubric,
          model: countingModel,
          gradingGuide,
          calibrationExamples,
          includeTranscriptInOutput: input.options.includeTranscriptInOutput === true,
        }),
      );
    }
  }

  const succeeded = results.filter((result) => result.status === "succeeded").length;

  return {
    caseCount: input.cases.length,
    succeeded,
    failed: results.length - succeeded,
    batchSize,
    modelCallCount,
    aggregate: buildAggregate(results),
    cases: results,
  };
}

async function evaluateOneCase(input: {
  readonly interviewCase: LabeledInterviewCase;
  readonly rubric: unknown;
  readonly model: GradingModel;
  readonly gradingGuide: string;
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
