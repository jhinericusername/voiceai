import type { RecommendationValue } from "./types.js";

export interface RecommendationScore {
  readonly category: string;
  readonly score: number;
  readonly confidence: number;
  readonly evidenceQuotes: readonly string[];
}

export interface RecommendationRuleInput {
  readonly categoryScores: readonly RecommendationScore[];
  readonly bareMinimumRule: "at_least_one_4_and_problem_solving_ge_3" | string;
  readonly minimumConfidence: number;
  readonly severeWarnings: readonly string[];
}

export interface RecommendationRuleOutput {
  readonly recommendation: RecommendationValue;
  readonly confidence: number;
  readonly warnings: readonly string[];
}

export function recommendInterview(input: RecommendationRuleInput): RecommendationRuleOutput {
  const confidence = roundedAverage(input.categoryScores.map((score) => score.confidence));
  const warnings = [
    ...input.severeWarnings,
    ...(confidence < input.minimumConfidence ? ["low_confidence"] : []),
    ...(input.categoryScores.some((score) => score.evidenceQuotes.length === 0) ? ["missing_evidence"] : []),
  ];

  if (warnings.length > 0) {
    return { recommendation: "hold", confidence, warnings };
  }

  if (meetsBareMinimum(input)) {
    return { recommendation: "advance", confidence, warnings };
  }

  return { recommendation: "pass", confidence, warnings };
}

function meetsBareMinimum(input: RecommendationRuleInput): boolean {
  if (input.bareMinimumRule !== "at_least_one_4_and_problem_solving_ge_3") {
    return false;
  }

  const byCategory = new Map(input.categoryScores.map((score) => [score.category, score]));
  const problemSolving = byCategory.get("problem_solving")?.score ?? 0;
  const hasFour = input.categoryScores.some((score) => score.score >= 4);
  return hasFour && problemSolving >= 3;
}

function roundedAverage(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 100) / 100;
}
