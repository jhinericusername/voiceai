import type { SqlStatement } from "../consent/repository.js";

export interface SessionInput {
  readonly sessionId: string;
  readonly orgId: string;
  readonly candidateEmail: string;
  readonly scriptVersion: string;
  readonly scheduledAt: string;
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
      "(session_id, org_id, candidate_email, script_version, status, scheduled_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6)",
    params: [
      record.sessionId,
      record.orgId,
      record.candidateEmail,
      record.scriptVersion,
      record.status,
      record.scheduledAt,
    ],
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
