import { randomUUID } from "node:crypto";
import type { SqlStatement } from "../consent/repository.js";
import { storagePaths } from "../storage/layout.js";

export type RecordingStatus = "pending" | "starting" | "active" | "complete" | "failed";

export type RecordingArtifactKind =
  | "composite_video"
  | "candidate_video"
  | "candidate_audio"
  | "agent_audio"
  | "transcript"
  | "agent_events"
  | "media_events"
  | "integrity_events"
  | "scores"
  | "integrity_flags";

export type RecordingArtifactStatus = "expected" | "available" | "failed";

export interface RecordingInput {
  readonly sessionId: string;
  readonly status: RecordingStatus;
  readonly egressId?: string | null;
  readonly startedAt?: string | null;
  readonly endedAt?: string | null;
  readonly errorMessage?: string | null;
}

export interface RecordingArtifactInput {
  readonly artifactId?: string;
  readonly sessionId: string;
  readonly kind: RecordingArtifactKind;
  readonly storagePath: string;
  readonly contentType: string;
  readonly status: RecordingArtifactStatus;
  readonly sizeBytes?: number | null;
  readonly durationSeconds?: number | null;
}

export function recordingUpsertStatement(input: RecordingInput): SqlStatement {
  return {
    sql:
      "INSERT INTO recordings " +
      "(session_id, egress_id, status, started_at, ended_at, error_message) " +
      "VALUES ($1, $2, $3, $4, $5, $6) " +
      "ON CONFLICT (session_id) DO UPDATE SET " +
      "egress_id = COALESCE(EXCLUDED.egress_id, recordings.egress_id), " +
      "status = EXCLUDED.status, started_at = COALESCE(EXCLUDED.started_at, recordings.started_at), " +
      "ended_at = EXCLUDED.ended_at, error_message = EXCLUDED.error_message, updated_at = now()",
    params: [
      input.sessionId,
      input.egressId ?? null,
      input.status,
      input.startedAt ?? null,
      input.endedAt ?? null,
      input.errorMessage ?? null,
    ],
  };
}

export function recordingArtifactUpsertStatement(input: RecordingArtifactInput): SqlStatement {
  return {
    sql:
      "INSERT INTO recording_artifacts " +
      "(artifact_id, session_id, kind, storage_path, content_type, status, size_bytes, duration_seconds) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8) " +
      "ON CONFLICT (session_id, kind) DO UPDATE SET " +
      "storage_path = EXCLUDED.storage_path, content_type = EXCLUDED.content_type, " +
      "status = EXCLUDED.status, size_bytes = EXCLUDED.size_bytes, " +
      "duration_seconds = EXCLUDED.duration_seconds, updated_at = now()",
    params: [
      input.artifactId ?? randomUUID(),
      input.sessionId,
      input.kind,
      input.storagePath,
      input.contentType,
      input.status,
      input.sizeBytes ?? null,
      input.durationSeconds ?? null,
    ],
  };
}

export function expectedRecordingArtifacts(
  orgId: string,
  sessionId: string,
): RecordingArtifactInput[] {
  const paths = storagePaths(orgId, sessionId);
  return [
    {
      sessionId,
      kind: "composite_video",
      storagePath: paths.media.composite,
      contentType: "video/mp4",
      status: "expected",
    },
    {
      sessionId,
      kind: "candidate_video",
      storagePath: paths.media.candidateVideo,
      contentType: "video/mp4",
      status: "expected",
    },
    {
      sessionId,
      kind: "candidate_audio",
      storagePath: paths.media.candidateAudio,
      contentType: "audio/mp4",
      status: "expected",
    },
    {
      sessionId,
      kind: "agent_audio",
      storagePath: paths.media.agentAudio,
      contentType: "audio/mp4",
      status: "expected",
    },
    {
      sessionId,
      kind: "transcript",
      storagePath: paths.transcripts.transcript,
      contentType: "application/json",
      status: "expected",
    },
    {
      sessionId,
      kind: "agent_events",
      storagePath: paths.events.agentEvents,
      contentType: "application/x-ndjson",
      status: "expected",
    },
    {
      sessionId,
      kind: "media_events",
      storagePath: paths.events.mediaEvents,
      contentType: "application/x-ndjson",
      status: "expected",
    },
    {
      sessionId,
      kind: "integrity_events",
      storagePath: paths.events.integrityEvents,
      contentType: "application/x-ndjson",
      status: "expected",
    },
    {
      sessionId,
      kind: "scores",
      storagePath: paths.assessment.scores,
      contentType: "application/json",
      status: "expected",
    },
    {
      sessionId,
      kind: "integrity_flags",
      storagePath: paths.assessment.integrityFlags,
      contentType: "application/json",
      status: "expected",
    },
  ];
}
