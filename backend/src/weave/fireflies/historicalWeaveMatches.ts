import type {
  HistoricalWeaveMatch,
  HistoricalWeaveMatchCandidate,
} from "./historicalImportPlan.js";

export interface Queryable<Row = Record<string, unknown>> {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

export interface HistoricalWeaveMatchBundle {
  readonly weaveMatch: HistoricalWeaveMatch | null;
  readonly weaveMatchCandidates: readonly HistoricalWeaveMatchCandidate[];
}

interface WeaveMatchQueryRow {
  readonly selected?: unknown;
  readonly ranked_candidates?: unknown;
}

const historicalWeaveMatchSql = `
WITH selected AS (
  SELECT
    fireflies_transcript_id,
    match_status,
    match_confidence,
    match_method,
    match_reasons,
    ashby_candidate_id,
    ashby_application_id,
    ashby_job_id,
    candidate_evaluation_id,
    decision_source,
    decision_reason,
    decided_at
  FROM weave_fireflies_recordings
  WHERE fireflies_transcript_id = $1
),
ranked_candidates AS (
  SELECT
    match_rank,
    score,
    ashby_candidate_id,
    ashby_application_id,
    ashby_job_id,
    candidate_evaluation_id,
    matched_email,
    date_delta_days,
    stage_delta_days,
    stage_titles,
    application_active_on_meeting_date,
    active_application_count,
    reasons
  FROM weave_fireflies_recording_match_candidates
  WHERE fireflies_transcript_id = $1
  ORDER BY match_rank ASC, score DESC
)
SELECT
  (SELECT row_to_json(selected) FROM selected) AS selected,
  COALESCE(
    (SELECT json_agg(ranked_candidates ORDER BY match_rank ASC, score DESC) FROM ranked_candidates),
    '[]'::json
  ) AS ranked_candidates;
`;

export async function loadHistoricalWeaveMatchBundle(
  weaveDb: Queryable<WeaveMatchQueryRow>,
  transcriptId: string,
): Promise<HistoricalWeaveMatchBundle> {
  const result = await weaveDb.query(historicalWeaveMatchSql, [transcriptId]);
  const row = result.rows[0];
  if (!row) {
    return { weaveMatch: null, weaveMatchCandidates: [] };
  }

  const weaveMatch = mapSelectedMatch(row.selected);
  return {
    weaveMatch,
    weaveMatchCandidates: mapCandidates(row.ranked_candidates),
  };
}

function mapSelectedMatch(value: unknown): HistoricalWeaveMatch | null {
  const row = asRecord(value);
  if (!row) return null;
  return {
    matchStatus: nullableString(row.match_status),
    ashbyCandidateId: nullableString(row.ashby_candidate_id),
    ashbyApplicationId: nullableString(row.ashby_application_id),
    ashbyJobId: nullableString(row.ashby_job_id),
    candidateEvaluationId: nullableString(row.candidate_evaluation_id),
    decisionSource: nullableString(row.decision_source),
    decisionReason: stringArray(row.decision_reason),
    decidedAt: timestampString(row.decided_at),
  };
}

function mapCandidates(value: unknown): HistoricalWeaveMatchCandidate[] {
  const candidates = Array.isArray(value) ? value : [];
  return candidates
    .map((candidate) => asRecord(candidate))
    .filter((candidate): candidate is Record<string, unknown> => candidate !== null)
    .map((candidate) => ({
      rank: numberValue(candidate.match_rank) ?? 0,
      score: numberValue(candidate.score) ?? 0,
      ashbyCandidateId: nullableString(candidate.ashby_candidate_id) ?? "",
      ashbyApplicationId: nullableString(candidate.ashby_application_id) ?? "",
      ashbyJobId: nullableString(candidate.ashby_job_id),
      candidateEvaluationId: nullableString(candidate.candidate_evaluation_id),
      matchedEmail: nullableString(candidate.matched_email),
      dateDeltaDays: numberValue(candidate.date_delta_days),
      stageDeltaDays: numberValue(candidate.stage_delta_days),
      stageTitles: stringArray(candidate.stage_titles),
      applicationActiveOnMeetingDate: booleanValue(candidate.application_active_on_meeting_date),
      activeApplicationCount: numberValue(candidate.active_application_count),
      reasons: stringArray(candidate.reasons),
    }))
    .sort((left, right) => left.rank - right.rank || right.score - left.score);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return asRecord(parsed);
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestampString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return nullableString(value);
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
