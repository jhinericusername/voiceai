import { randomUUID } from "node:crypto";
import type { SqlStatement } from "../consent/repository.js";
import { hashInviteToken } from "../invites/tokens.js";

const DEFAULT_INVITE_TTL_SECONDS = 2 * 60 * 60;

export type AiControlAction = "start" | "stop" | "resume" | "end";
export type AiRequestedState = "running" | "stopped" | "ended";
export type AiInterviewerState = "not_started" | AiRequestedState;

export interface InterviewerSessionRow {
  readonly session_id: string;
  readonly org_id: string;
  readonly candidate_email: string;
  readonly script_version: string;
  readonly status: string;
  readonly scheduled_at: string | Date | null;
  readonly room_name: string | null;
}

export interface CandidateInviteInsertForSessionInput {
  readonly sessionId: string;
  readonly candidateEmail: string;
  readonly token: string;
  readonly now?: Date;
  readonly ttlSeconds?: number;
}

export interface AiControlStateUpsertInput {
  readonly sessionId: string;
  readonly requestedState: AiRequestedState;
  readonly requestedByUserId: string;
  readonly requestedByEmail: string;
  readonly requestedAt: string;
}

export function interviewerSessionStatement(sessionId: string, orgId: string): SqlStatement {
  return {
    sql:
      "SELECT session_id, org_id, candidate_email, script_version, status, scheduled_at, room_name " +
      "FROM sessions WHERE session_id = $1 AND org_id = $2",
    params: [sessionId, orgId],
  };
}

export function candidateInviteInsertForSessionStatement(
  input: CandidateInviteInsertForSessionInput,
): SqlStatement {
  const now = input.now ?? new Date();
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_INVITE_TTL_SECONDS;
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  return {
    sql:
      "INSERT INTO candidate_invites " +
      "(invite_id, session_id, candidate_email, token_hash, not_before, expires_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6)",
    params: [
      randomUUID(),
      input.sessionId,
      input.candidateEmail,
      hashInviteToken(input.token),
      now.toISOString(),
      expiresAt.toISOString(),
    ],
  };
}

export function hasInterviewerJoinedStatement(sessionId: string): SqlStatement {
  return {
    sql:
      "SELECT 1 FROM events WHERE session_id = $1 AND kind = 'ops' " +
      "AND payload->>'event_type' = 'human_interviewer_joined' LIMIT 1",
    params: [sessionId],
  };
}

export function aiControlStateFromAction(action: AiControlAction): AiRequestedState {
  if (action === "end") {
    return "ended";
  }
  return action === "stop" ? "stopped" : "running";
}

export function latestAiControlStateStatement(sessionId: string): SqlStatement {
  return {
    sql:
      "SELECT requested_state FROM interview_ai_control_state " +
      "WHERE session_id = $1 ORDER BY requested_at DESC LIMIT 1",
    params: [sessionId],
  };
}

export function aiControlEventType(action: AiControlAction): string {
  if (action === "start") {
    return "ai_interviewer_start_requested";
  }
  if (action === "stop") {
    return "ai_interviewer_stop_requested";
  }
  if (action === "end") {
    return "ai_interviewer_end_requested";
  }
  return "ai_interviewer_resume_requested";
}

export function aiControlStateUpsertStatement(input: AiControlStateUpsertInput): SqlStatement {
  return {
    sql:
      "INSERT INTO interview_ai_control_state " +
      "(session_id, requested_state, requested_by_user_id, requested_by_email, requested_at) " +
      "VALUES ($1, $2, $3, $4, $5) " +
      "ON CONFLICT (session_id) DO UPDATE SET " +
      "requested_state = EXCLUDED.requested_state, " +
      "requested_by_user_id = EXCLUDED.requested_by_user_id, " +
      "requested_by_email = EXCLUDED.requested_by_email, " +
      "requested_at = EXCLUDED.requested_at, " +
      "updated_at = now()",
    params: [
      input.sessionId,
      input.requestedState,
      input.requestedByUserId,
      input.requestedByEmail,
      input.requestedAt,
    ],
  };
}
