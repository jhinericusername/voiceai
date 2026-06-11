import type { SqlStatement } from "../consent/repository.js";

export interface CategoryScoreInput {
  readonly category: string;
  readonly score: number;
  readonly confidence: number;
  readonly evidenceQuotes: readonly string[];
  readonly rationale: string;
  readonly lowConfidence: boolean;
}

export interface AssessmentInput {
  readonly sessionId: string;
  readonly scriptVersion: string;
  readonly categoryScores: readonly CategoryScoreInput[];
  readonly meetsBareMinimum: boolean;
  readonly integrityFlags: readonly string[];
}

export interface AssessmentRow {
  readonly session_id: string;
  readonly script_version: string;
  readonly category_scores: unknown;
  readonly meets_bare_minimum: boolean;
  readonly integrity_flags: unknown;
  readonly reviewer_email: string | null;
  readonly signed_off_at: string | Date | null;
  readonly created_at: string | Date;
}

function categoryScoresJson(scores: readonly CategoryScoreInput[]): string {
  return JSON.stringify(
    scores.map((score) => ({
      category: score.category,
      score: score.score,
      confidence: score.confidence,
      evidence_quotes: score.evidenceQuotes,
      rationale: score.rationale,
      low_confidence: score.lowConfidence,
    })),
  );
}

export function assessmentUpsertStatement(input: AssessmentInput): SqlStatement {
  return {
    sql:
      "INSERT INTO assessments " +
      "(session_id, script_version, category_scores, meets_bare_minimum, integrity_flags) " +
      "VALUES ($1, $2, $3::jsonb, $4, $5::jsonb) " +
      "ON CONFLICT (session_id) DO UPDATE SET " +
      "script_version = EXCLUDED.script_version, " +
      "category_scores = EXCLUDED.category_scores, " +
      "meets_bare_minimum = EXCLUDED.meets_bare_minimum, " +
      "integrity_flags = EXCLUDED.integrity_flags, " +
      "reviewer_email = NULL, signed_off_at = NULL",
    params: [
      input.sessionId,
      input.scriptVersion,
      categoryScoresJson(input.categoryScores),
      input.meetsBareMinimum,
      JSON.stringify(input.integrityFlags),
    ],
  };
}

export function assessmentBySessionStatement(sessionId: string): SqlStatement {
  return {
    sql:
      "SELECT session_id, script_version, category_scores, meets_bare_minimum, " +
      "integrity_flags, reviewer_email, signed_off_at, created_at " +
      "FROM assessments WHERE session_id = $1",
    params: [sessionId],
  };
}
