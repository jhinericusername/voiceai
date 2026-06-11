import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { SqlStatement } from "../consent/repository.js";

export interface OpsEventInput {
  readonly sessionId: string;
  readonly eventType: string;
  readonly payload?: Record<string, unknown>;
}

interface AuditHashInput {
  readonly sessionId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly prevHash: string | null;
}

function canonicalAuditEntry(input: AuditHashInput): string {
  return JSON.stringify({
    event_type: input.eventType,
    payload: input.payload,
    prev_hash: input.prevHash,
    session_id: input.sessionId,
  });
}

export function opsEventInsertStatement(input: OpsEventInput): SqlStatement {
  return {
    sql: "INSERT INTO events (session_id, kind, payload) VALUES ($1, $2, $3::jsonb)",
    params: [
      input.sessionId,
      "ops",
      JSON.stringify({
        event_type: input.eventType,
        ...(input.payload ?? {}),
      }),
    ],
  };
}

export function lastAuditHashStatement(sessionId: string): SqlStatement {
  return {
    sql:
      "SELECT entry_hash FROM audit_log " +
      "WHERE session_id = $1 ORDER BY id DESC LIMIT 1",
    params: [sessionId],
  };
}

export function auditLogInsertStatement(input: OpsEventInput, prevHash: string | null): SqlStatement {
  const payload = input.payload ?? {};
  const entryHash = createHash("sha256")
    .update(
      canonicalAuditEntry({
        sessionId: input.sessionId,
        eventType: input.eventType,
        payload,
        prevHash,
      }),
    )
    .digest("hex");

  return {
    sql:
      "INSERT INTO audit_log " +
      "(session_id, event_type, payload, prev_hash, entry_hash) " +
      "VALUES ($1, $2, $3::jsonb, $4, $5)",
    params: [
      input.sessionId,
      input.eventType,
      JSON.stringify(payload),
      prevHash,
      entryHash,
    ],
  };
}

export async function persistOpsEvent(
  pool: Pick<Pool, "query">,
  input: OpsEventInput,
): Promise<void> {
  const eventStmt = opsEventInsertStatement(input);
  await pool.query(eventStmt.sql, [...eventStmt.params]);

  const hashStmt = lastAuditHashStatement(input.sessionId);
  const { rows } = await pool.query<{ entry_hash: string }>(hashStmt.sql, [
    ...hashStmt.params,
  ]);
  const auditStmt = auditLogInsertStatement(input, rows[0]?.entry_hash ?? null);
  await pool.query(auditStmt.sql, [...auditStmt.params]);
}
