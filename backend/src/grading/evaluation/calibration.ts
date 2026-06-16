import type { EvaluationDimensionKey } from "./scorecard.js";

export interface CalibrationExample {
  readonly id: string;
  readonly summary: string;
  readonly scores: Record<EvaluationDimensionKey, number>;
  readonly missingQuestions: Partial<Record<EvaluationDimensionKey, string>>;
  readonly scriptedRisk: string;
  readonly comment: string;
  readonly totalScore: number;
}

export interface ScoringCalibrationInput {
  readonly gradingGuide: string;
  readonly calibrationExamples: readonly CalibrationExample[];
}

export function buildDefaultGradingGuide(): string {
  return [
    "Grade the candidate on exactly four dimensions: problem_solving, agency, competitiveness, and curious.",
    "Scores are 0-4 for each dimension in 0.5 increments, where 2 is neutral/default signal and 4 is exceptional signal.",
    "Missing question neutral default: if a calibration question was genuinely not asked, use 2 for that dimension unless other job-related evidence directly supports a score.",
    "If the calibration question was asked but the candidate dodged it or answered a different question, score the observed answer; it can be low.",
    "Scripted/AI-answer risk should be assessed separately from the dimension scores; only reduce dimension scores when the answer reliability or evidence itself is weak.",
    "Use only job-related answer content; do not infer ability or score from protected characteristics or proxies.",
    "Prefer concrete evidence and practical specificity over buzzword-heavy summaries.",
  ].join("\n");
}

export function defaultCalibrationExamples(): readonly CalibrationExample[] {
  return [
    {
      id: "example_a",
      summary: "Practical migration automation with neutral agency, weak curiosity, and light competitiveness.",
      scores: {
        problem_solving: 2.5,
        agency: 2,
        competitiveness: 2,
        curious: 1,
      },
      missingQuestions: {
        agency: "The non-computer system hack question was not asked.",
      },
      totalScore: 7.5,
      scriptedRisk: "low_moderate",
      comment:
        "Useful practical migration automation supports a 2.5 in problem_solving. The agency question was not asked, so agency uses the neutral default of 2. Competitiveness showed recreational participation rather than strong competitive drive. The curiosity question was asked, but the answer did not establish niche or top-tier knowledge, so curious is low.",
    },
    {
      id: "example_b",
      summary: "Strong applied ML architecture with partial agency, good athletic competitiveness, and neutral curiosity.",
      scores: {
        problem_solving: 3,
        agency: 2.5,
        competitiveness: 3,
        curious: 2,
      },
      missingQuestions: {
        curious: "The niche/top-percentile curiosity question was not asked.",
      },
      totalScore: 10.5,
      scriptedRisk: "high",
      comment:
        "Strong but high-level graph and streaming fraud ML architecture supports a 3 in problem_solving. The non-computer hack answer described work or process automation, giving partial agency signal. Tournament badminton with deliberate practice supports a 3 in competitiveness. The curiosity question was not asked, so curious uses the neutral default of 2.",
    },
    {
      id: "example_c",
      summary: "Practical robotics support workaround, strong system hack, light competitiveness, and strong niche knowledge.",
      scores: {
        problem_solving: 3,
        agency: 4,
        competitiveness: 2,
        curious: 4,
      },
      missingQuestions: {},
      totalScore: 13,
      scriptedRisk: "very_low",
      comment:
        "A practical robotics support workaround supports a 3 in problem_solving. A strong healthcare deductible system hack supports a 4 in agency. Light ping-pong competitiveness supports a 2 in competitiveness. Strong niche goat-farming knowledge supports a 4 in curious.",
    },
  ];
}

export function selectCalibrationExamples(
  examples: readonly CalibrationExample[],
  maxExamples: number,
): readonly CalibrationExample[] {
  if (!Number.isFinite(maxExamples) || maxExamples <= 0) {
    return [];
  }
  return examples.slice(0, Math.trunc(maxExamples));
}

export function clampEvaluationBatchSize(value: number, options: { min?: number; max?: number } = {}): number {
  const min = options.min ?? 1;
  const max = options.max ?? 5;
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function buildScoringCalibrationInput(): ScoringCalibrationInput {
  return {
    gradingGuide: buildDefaultGradingGuide(),
    calibrationExamples: defaultCalibrationExamples(),
  };
}
