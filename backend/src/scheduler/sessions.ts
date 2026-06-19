import type { SqlStatement } from "../consent/repository.js";

export interface SessionInput {
  readonly sessionId: string;
  readonly orgId: string;
  readonly candidateEmail: string;
  readonly scriptVersion: string;
  readonly scheduledAt: string;
  readonly externalSource?: string | null;
  readonly externalId?: string | null;
  readonly sourceMetadata?: Record<string, unknown> | null;
}

export interface SessionRecord extends SessionInput {
  readonly status: "scheduled";
}

export function buildSessionRecord(input: SessionInput): SessionRecord {
  return { ...input, status: "scheduled" };
}

export function createSessionInsert(record: SessionRecord): SqlStatement {
  return {
    sql:
      "INSERT INTO sessions " +
      "(session_id, org_id, candidate_email, script_version, status, scheduled_at, " +
      "external_source, external_id, source_metadata) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)",
    params: [
      record.sessionId,
      record.orgId,
      record.candidateEmail,
      record.scriptVersion,
      record.status,
      record.scheduledAt,
      record.externalSource ?? null,
      record.externalId ?? null,
      JSON.stringify(record.sourceMetadata ?? {}),
    ],
  };
}

export function sessionRoomUpdateStatement(sessionId: string, roomName: string): SqlStatement {
  return {
    sql: "UPDATE sessions SET room_name = $2, updated_at = now() WHERE session_id = $1",
    params: [sessionId, roomName],
  };
}

export function sessionStatusUpdateStatement(
  sessionId: string,
  status: string,
  options: {
    readonly startedAt?: string;
    readonly endedAt?: string;
    readonly includeTimelineColumns?: boolean;
  } = {},
): SqlStatement {
  if (options.includeTimelineColumns === false) {
    return {
      sql: "UPDATE sessions SET status = $2, updated_at = now() WHERE session_id = $1",
      params: [sessionId, status],
    };
  }

  return {
    sql:
      "UPDATE sessions SET status = $2, " +
      "started_at = COALESCE($3::timestamptz, started_at), " +
      "ended_at = COALESCE($4::timestamptz, ended_at), updated_at = now() " +
      "WHERE session_id = $1",
    params: [sessionId, status, options.startedAt ?? null, options.endedAt ?? null],
  };
}

// Mirrors `InterviewJobContext` in agent/src/agent/worker/entrypoint.py —
// the agent worker parses exactly these snake_case keys.
export function buildWorkerDispatchMetadata(record: SessionRecord): string {
  return JSON.stringify({
    session_id: record.sessionId,
    org_id: record.orgId,
    candidate_email: record.candidateEmail,
    script_version: record.scriptVersion,
  });
}
