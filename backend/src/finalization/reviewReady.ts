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
