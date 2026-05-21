export interface ReviewedCategoryScore {
  readonly category: string;
  readonly score: number;
  readonly confidence: number;
  readonly lowConfidence: boolean;
}

export interface ReviewedAssessment {
  readonly sessionId: string;
  readonly scriptVersion: string;
  readonly categoryScores: readonly ReviewedCategoryScore[];
  readonly meetsBareMinimum: boolean;
  readonly integrityFlags: readonly string[];
}

export type SignoffValidation = { ok: true } | { ok: false; reason: string };

// Every assessment requires a human sign-off from an identified reviewer.
export function validateSignoff(
  _assessment: ReviewedAssessment,
  input: { readonly reviewerEmail: string },
): SignoffValidation {
  if (!input.reviewerEmail.trim()) {
    return { ok: false, reason: "a reviewer identity is required to sign off" };
  }
  return { ok: true };
}

// A reviewer may override any category score within the 1-4 range.
export function applyScoreEdit(
  assessment: ReviewedAssessment,
  category: string,
  newScore: number,
): ReviewedAssessment {
  if (newScore < 1 || newScore > 4 || !Number.isInteger(newScore)) {
    throw new Error(`score must be an integer 1-4, got ${newScore}`);
  }
  return {
    ...assessment,
    categoryScores: assessment.categoryScores.map((cs) =>
      cs.category === category ? { ...cs, score: newScore } : cs,
    ),
  };
}

export interface SignoffRecord {
  readonly reviewerEmail: string;
  readonly signedOffAt: string;
  readonly assessment: ReviewedAssessment;
}

export function buildSignoffRecord(
  assessment: ReviewedAssessment,
  input: { readonly reviewerEmail: string; readonly signedOffAt: string },
): SignoffRecord {
  return {
    reviewerEmail: input.reviewerEmail,
    signedOffAt: input.signedOffAt,
    assessment,
  };
}
