import { randomUUID } from "node:crypto";
import type { SqlStatement } from "../consent/repository.js";
import { hashInviteToken } from "./tokens.js";

const DEFAULT_INVITE_TTL_SECONDS = 2 * 60 * 60;

export interface CandidateInviteRecord {
  readonly inviteId: string;
  readonly sessionId: string;
  readonly candidateEmail: string;
  readonly tokenHash: string;
  readonly notBefore: string;
  readonly expiresAt: string;
}

export interface CandidateInviteInput {
  readonly sessionId: string;
  readonly candidateEmail: string;
  readonly token: string;
  readonly now?: Date;
  readonly ttlSeconds?: number;
}

export interface CandidateInviteRow {
  readonly invite_id: string;
  readonly session_id: string;
  readonly candidate_email: string;
  readonly status: string;
  readonly not_before: string | Date;
  readonly expires_at: string | Date;
  readonly revoked_at: string | Date | null;
  readonly join_count: number;
}

export function buildCandidateInviteRecord(input: CandidateInviteInput): CandidateInviteRecord {
  const now = input.now ?? new Date();
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_INVITE_TTL_SECONDS;
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  return {
    inviteId: randomUUID(),
    sessionId: input.sessionId,
    candidateEmail: input.candidateEmail,
    tokenHash: hashInviteToken(input.token),
    notBefore: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function createCandidateInviteInsert(record: CandidateInviteRecord): SqlStatement {
  return {
    sql:
      "INSERT INTO candidate_invites " +
      "(invite_id, session_id, candidate_email, token_hash, not_before, expires_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6)",
    params: [
      record.inviteId,
      record.sessionId,
      record.candidateEmail,
      record.tokenHash,
      record.notBefore,
      record.expiresAt,
    ],
  };
}

export function findCandidateInviteByTokenStatement(token: string): SqlStatement {
  return {
    sql:
      "SELECT invite_id, session_id, candidate_email, status, not_before, expires_at, revoked_at, join_count " +
      "FROM candidate_invites WHERE token_hash = $1",
    params: [hashInviteToken(token)],
  };
}

export function markCandidateInviteUsedStatement(inviteId: string): SqlStatement {
  return {
    sql:
      "UPDATE candidate_invites " +
      "SET last_used_at = now(), join_count = join_count + 1 " +
      "WHERE invite_id = $1",
    params: [inviteId],
  };
}

export function invitePath(token: string): string {
  return `/interview/${encodeURIComponent(token)}`;
}

export function isInviteUsable(
  row: CandidateInviteRow,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: "revoked" | "expired" | "not_yet_valid" } {
  if (row.status !== "active" || row.revoked_at) {
    return { ok: false, reason: "revoked" };
  }

  const notBefore = new Date(row.not_before);
  if (Number.isFinite(notBefore.getTime()) && now < notBefore) {
    return { ok: false, reason: "not_yet_valid" };
  }

  const expiresAt = new Date(row.expires_at);
  if (!Number.isFinite(expiresAt.getTime()) || now >= expiresAt) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true };
}
