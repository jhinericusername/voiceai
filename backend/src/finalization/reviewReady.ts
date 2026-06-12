import type { Pool } from "pg";
import type { SqlStatement } from "../consent/repository.js";
import type {
  RecordingArtifactKind,
  RecordingArtifactStatus,
} from "../recordings/repository.js";
import { sessionStatusUpdateStatement } from "../scheduler/sessions.js";

export const REQUIRED_REVIEW_ARTIFACTS: readonly RecordingArtifactKind[] = [
  "composite_video",
  "transcript",
  "scores",
  "integrity_flags",
  "agent_events",
];

export interface ArtifactStatusRow {
  readonly kind: RecordingArtifactKind;
  readonly status: RecordingArtifactStatus;
}

export type ArtifactReadinessRow = ArtifactStatusRow;

export interface Queryable<Row> {
  query(
    sql: string,
    params: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[] }>;
}

export type ReviewReadyQueryable = Queryable<ArtifactReadinessRow>;

export function reviewReadyArtifactStatusesStatement(sessionId: string): SqlStatement {
  return {
    sql:
      "SELECT kind, status FROM recording_artifacts " +
      "WHERE session_id = $1 AND kind = ANY($2::text[])",
    params: [sessionId, REQUIRED_REVIEW_ARTIFACTS],
  };
}

export function shouldMarkReviewReady(rows: readonly ArtifactStatusRow[]): boolean {
  const statuses = new Map(rows.map((row) => [row.kind, row.status]));
  return REQUIRED_REVIEW_ARTIFACTS.every((kind) => statuses.get(kind) === "available");
}

export function sessionReviewReadyStatement(sessionId: string): SqlStatement {
  return sessionStatusUpdateStatement(sessionId, "review_ready", {
    includeTimelineColumns: false,
  });
}

export function artifactReadinessBySessionStatement(sessionId: string): SqlStatement {
  return reviewReadyArtifactStatusesStatement(sessionId);
}

export function reviewReadyStatusStatement(sessionId: string): SqlStatement {
  const stmt = sessionStatusUpdateStatement(sessionId, "review_ready");
  return {
    sql: `${stmt.sql} AND status = 'recording_finalizing'`,
    params: stmt.params,
  };
}

export async function markSessionReviewReadyIfComplete(
  pool: Pick<Pool, "query">,
  sessionId: string,
): Promise<boolean> {
  const statusStmt = reviewReadyArtifactStatusesStatement(sessionId);
  const result = await pool.query<ArtifactStatusRow>(statusStmt.sql, [
    ...statusStmt.params,
  ]);

  if (!shouldMarkReviewReady(result.rows)) {
    return false;
  }

  const updateStmt = sessionReviewReadyStatement(sessionId);
  await pool.query(updateStmt.sql, [...updateStmt.params]);
  return true;
}

export async function markReviewReadyIfArtifactsAvailable(
  sessionId: string,
  pool: ReviewReadyQueryable,
): Promise<boolean> {
  const readinessStmt = artifactReadinessBySessionStatement(sessionId);
  const readiness = await pool.query(readinessStmt.sql, readinessStmt.params);
  if (!shouldMarkReviewReady(readiness.rows)) {
    return false;
  }

  const reviewReadyStmt = reviewReadyStatusStatement(sessionId);
  await pool.query(reviewReadyStmt.sql, reviewReadyStmt.params);
  return true;
}
