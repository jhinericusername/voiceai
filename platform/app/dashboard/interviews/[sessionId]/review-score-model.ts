export type ReviewDimensionKey = "problemSolving" | "agency" | "competitiveness" | "curious";

export type ReviewerDecision = "advance" | "hold" | "pass" | "needs_more_review";

export interface ReviewDimensionDefinition {
  readonly key: ReviewDimensionKey;
  readonly label: string;
}

export interface ReviewDimensionDraft {
  readonly key: ReviewDimensionKey;
  readonly label: string;
  readonly score: number;
  readonly notes: string;
  readonly aiScore: number | null;
  readonly aiNotes: string;
}

export const reviewDimensionDefinitions: readonly ReviewDimensionDefinition[] = [
  { key: "problemSolving", label: "Problem Solving" },
  { key: "agency", label: "Agency" },
  { key: "competitiveness", label: "Competitiveness" },
  { key: "curious", label: "Curious" },
];

export const reviewScoreOptions = [1, 1.5, 2, 2.5, 3, 3.5, 4] as const;

export const maxReviewTotal = reviewDimensionDefinitions.length * 4;

export function formatReviewScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function reviewDimensionKeyFromLabel(value: string): ReviewDimensionKey | null {
  const normalized = value.replace(/[^a-z0-9]+/gi, "").toLowerCase();
  switch (normalized) {
    case "problemsolving":
    case "problemsolve":
      return "problemSolving";
    case "agency":
      return "agency";
    case "competitiveness":
    case "competitive":
      return "competitiveness";
    case "curious":
    case "curiosity":
      return "curious";
    default:
      return null;
  }
}

export function normalizeReviewScore(value: number | null, fallback = 3): number {
  if (value === null || !Number.isFinite(value)) {
    return fallback;
  }

  const bounded = Math.max(1, Math.min(4, value));
  return Math.round(bounded * 2) / 2;
}
