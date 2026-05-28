import { getPool } from "./pool.js";
import { storagePaths } from "../storage/layout.js";

export interface DeletionStatement {
  readonly table: string;
  readonly sql: string;
  readonly params: readonly string[];
}

export interface DeletionPlan {
  readonly sessionId: string;
  readonly statements: readonly DeletionStatement[];
  readonly storagePrefix?: string;
}

// Children before parent so foreign keys are never violated.
const DELETION_ORDER = [
  "events",
  "audit_log",
  "assessments",
  "consent_records",
  "candidate_invites",
  "sessions",
];

export function buildDeletionPlan(sessionId: string, orgId?: string): DeletionPlan {
  const statements = DELETION_ORDER.map((table) => ({
    table,
    sql: `DELETE FROM ${table} WHERE session_id = $1`,
    params: [sessionId] as const,
  }));
  return {
    sessionId,
    statements,
    storagePrefix: orgId ? storagePaths(orgId, sessionId).root : undefined,
  };
}

export async function executeDeletion(plan: DeletionPlan): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const stmt of plan.statements) {
      await client.query(stmt.sql, [...stmt.params]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
