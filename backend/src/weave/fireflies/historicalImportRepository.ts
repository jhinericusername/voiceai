import type { SqlStatement } from "../../consent/repository.js";
import type {
  HistoricalImportArtifactRow,
  HistoricalImportRecordingRow,
  HistoricalImportSessionRow,
  HistoricalImportTranscriptTurnRow,
} from "./historicalImportPlan.js";

export type HistoricalSessionRow = HistoricalImportSessionRow;
export type HistoricalRecordingRow = HistoricalImportRecordingRow;
export type HistoricalArtifactRow = HistoricalImportArtifactRow;
export type HistoricalTranscriptTurnRow = HistoricalImportTranscriptTurnRow;

export interface HistoricalImportRunRow {
  readonly importRunId: string;
  readonly source: string;
  readonly orgId: string;
  readonly sourceBucket: string;
  readonly sourcePrefix: string;
  readonly targetBucket: string;
  readonly mode: "dry-run" | "apply";
  readonly plannedCount: number;
  readonly summary: unknown;
}

export interface HistoricalImportRunFinish {
  readonly importRunId: string;
  readonly importedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly summary: unknown;
}

export function historicalSessionUpsertStatement(input: HistoricalSessionRow): SqlStatement {
  return {
    sql:
      "INSERT INTO sessions " +
      "(session_id, org_id, candidate_email, script_version, status, scheduled_at, " +
      "room_name, started_at, ended_at, external_source, external_id, source_metadata) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb) " +
      "ON CONFLICT (external_source, external_id) " +
      "WHERE external_source IS NOT NULL AND external_id IS NOT NULL " +
      "DO UPDATE SET " +
      "org_id = EXCLUDED.org_id, " +
      "candidate_email = EXCLUDED.candidate_email, " +
      "status = CASE " +
      "WHEN sessions.status IN ('scheduled', 'in_progress', 'recording_finalizing', 'review_ready') " +
      "THEN EXCLUDED.status " +
      "ELSE sessions.status " +
      "END, " +
      "scheduled_at = EXCLUDED.scheduled_at, " +
      "room_name = EXCLUDED.room_name, " +
      "started_at = EXCLUDED.started_at, " +
      "ended_at = EXCLUDED.ended_at, " +
      "source_metadata = EXCLUDED.source_metadata, " +
      "updated_at = now() " +
      "RETURNING session_id",
    params: [
      input.sessionId,
      input.orgId,
      input.candidateEmail,
      input.scriptVersion,
      input.status,
      input.scheduledAt,
      input.roomName,
      input.startedAt,
      input.endedAt,
      input.externalSource,
      input.externalId,
      jsonbParam(input.sourceMetadata),
    ],
  };
}

export function historicalRecordingUpsertStatement(input: HistoricalRecordingRow): SqlStatement {
  return {
    sql:
      "INSERT INTO recordings " +
      "(session_id, egress_id, status, started_at, ended_at, error_message) " +
      "VALUES ($1, $2, $3, $4, $5, $6) " +
      "ON CONFLICT (session_id) DO UPDATE SET " +
      "egress_id = EXCLUDED.egress_id, " +
      "status = EXCLUDED.status, " +
      "started_at = EXCLUDED.started_at, " +
      "ended_at = EXCLUDED.ended_at, " +
      "error_message = EXCLUDED.error_message, " +
      "updated_at = now()",
    params: [
      input.sessionId,
      input.egressId,
      input.status,
      input.startedAt,
      input.endedAt,
      input.errorMessage,
    ],
  };
}

export function historicalRecordingArtifactUpsertStatement(
  input: HistoricalArtifactRow,
): SqlStatement {
  return {
    sql:
      "INSERT INTO recording_artifacts " +
      "(artifact_id, session_id, kind, storage_path, content_type, status, size_bytes, duration_seconds) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) " +
      "ON CONFLICT (session_id, kind) DO UPDATE SET " +
      "artifact_id = EXCLUDED.artifact_id, " +
      "storage_path = EXCLUDED.storage_path, " +
      "content_type = EXCLUDED.content_type, " +
      "status = EXCLUDED.status, " +
      "size_bytes = EXCLUDED.size_bytes, " +
      "duration_seconds = EXCLUDED.duration_seconds, " +
      "updated_at = now()",
    params: [
      input.artifactId,
      input.sessionId,
      input.kind,
      input.storagePath,
      input.contentType,
      input.status,
      input.sizeBytes,
      input.durationSeconds,
    ],
  };
}

export function historicalTranscriptTurnUpsertStatement(
  input: HistoricalTranscriptTurnRow,
): SqlStatement {
  return {
    sql:
      "INSERT INTO transcript_turns " +
      "(session_id, turn_index, speaker, question_id, text, occurred_at, offset_ms, source) " +
      "VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7, $8) " +
      "ON CONFLICT (session_id, turn_index) DO UPDATE SET " +
      "speaker = EXCLUDED.speaker, " +
      "question_id = EXCLUDED.question_id, " +
      "text = EXCLUDED.text, " +
      "occurred_at = EXCLUDED.occurred_at, " +
      "offset_ms = EXCLUDED.offset_ms, " +
      "source = EXCLUDED.source, " +
      "updated_at = now()",
    params: [
      input.sessionId,
      input.turnIndex,
      input.speaker,
      input.questionId,
      input.text,
      null,
      input.offsetMs,
      input.source,
    ],
  };
}

export function historicalImportRunInsertStatement(input: HistoricalImportRunRow): SqlStatement {
  return {
    sql:
      "INSERT INTO historical_interview_import_runs " +
      "(import_run_id, source, org_id, source_bucket, source_prefix, target_bucket, mode, planned_count, summary) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) " +
      "ON CONFLICT (import_run_id) DO UPDATE SET " +
      "source = EXCLUDED.source, " +
      "org_id = EXCLUDED.org_id, " +
      "source_bucket = EXCLUDED.source_bucket, " +
      "source_prefix = EXCLUDED.source_prefix, " +
      "target_bucket = EXCLUDED.target_bucket, " +
      "mode = EXCLUDED.mode, " +
      "planned_count = EXCLUDED.planned_count, " +
      "summary = EXCLUDED.summary",
    params: [
      input.importRunId,
      input.source,
      input.orgId,
      input.sourceBucket,
      input.sourcePrefix,
      input.targetBucket,
      input.mode,
      input.plannedCount,
      jsonbParam(input.summary),
    ],
  };
}

export function historicalImportRunFinishStatement(
  input: HistoricalImportRunFinish,
): SqlStatement {
  return {
    sql:
      "UPDATE historical_interview_import_runs SET " +
      "finished_at = now(), " +
      "imported_count = $1, " +
      "skipped_count = $2, " +
      "failed_count = $3, " +
      "summary = $4::jsonb " +
      "WHERE import_run_id = $5",
    params: [
      input.importedCount,
      input.skippedCount,
      input.failedCount,
      jsonbParam(input.summary),
      input.importRunId,
    ],
  };
}

function jsonbParam(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}
