import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { getPool } from "../db/pool.js";
import { persistOpsEvent } from "../events/repository.js";
import { generateInviteToken } from "../invites/tokens.js";
import { invitePath } from "../invites/repository.js";
import { buildInterviewerJoinToken } from "../livekit/token.js";
import { ensureRoomReady, type LiveKitConfig } from "../livekit/provision.js";
import {
  buildWorkerDispatchMetadata,
  sessionRoomUpdateStatement,
  type SessionRecord,
} from "../scheduler/sessions.js";
import {
  aiControlEventType,
  aiControlStateFromAction,
  aiControlStateUpsertStatement,
  candidateInviteInsertForSessionStatement,
  interviewerSessionStatement,
  latestAiControlStateStatement,
  type AiControlAction,
  type AiInterviewerState,
  type AiRequestedState,
  type InterviewerSessionRow,
} from "./repository.js";

interface InterviewerParams {
  readonly sessionId: string;
}

interface InterviewerBaseBody {
  readonly orgId?: string;
  readonly interviewerEmail?: string;
  readonly interviewerUserId?: string;
}

interface AiControlBody extends InterviewerBaseBody {
  readonly action?: string;
}

type BodyValidation<T> = { ok: true; body: T } | { ok: false; reason: string };

const TERMINAL_SESSION_STATUSES = new Set([
  "incomplete",
  "review_ready",
  "recording_finalizing",
]);

function validateBaseBody(body: unknown): BodyValidation<Required<InterviewerBaseBody>> {
  const raw = body as InterviewerBaseBody | undefined;
  if (
    !raw ||
    typeof raw.orgId !== "string" ||
    !raw.orgId.trim() ||
    typeof raw.interviewerEmail !== "string" ||
    !raw.interviewerEmail.trim() ||
    typeof raw.interviewerUserId !== "string" ||
    !raw.interviewerUserId.trim()
  ) {
    return {
      ok: false,
      reason: "orgId, interviewerEmail, and interviewerUserId are required",
    };
  }

  return {
    ok: true,
    body: {
      orgId: raw.orgId.trim(),
      interviewerEmail: raw.interviewerEmail.trim(),
      interviewerUserId: raw.interviewerUserId.trim(),
    },
  };
}

function isAiControlAction(value: unknown): value is AiControlAction {
  return value === "start" || value === "stop" || value === "resume";
}

function validateAiControlBody(body: unknown): BodyValidation<Required<InterviewerBaseBody> & { action: AiControlAction }> {
  const base = validateBaseBody(body);
  if (!base.ok) {
    return base;
  }

  const action = (body as AiControlBody | undefined)?.action;
  if (!isAiControlAction(action)) {
    return { ok: false, reason: "action must be start, stop, or resume" };
  }

  return { ok: true, body: { ...base.body, action } };
}

async function withInterviewerTransaction<T>(
  pool: Pick<Pool, "connect">,
  work: (client: Pick<PoolClient, "query">) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function loadSession(
  pool: Pick<Pool, "query">,
  sessionId: string,
  orgId: string,
): Promise<InterviewerSessionRow | undefined> {
  const stmt = interviewerSessionStatement(sessionId, orgId);
  const { rows } = await pool.query<InterviewerSessionRow>(stmt.sql, [...stmt.params]);
  return rows[0];
}

function isAiRequestedState(value: unknown): value is AiRequestedState {
  return value === "running" || value === "stopped";
}

async function loadAiInterviewerState(
  pool: Pick<Pool, "query">,
  sessionId: string,
): Promise<AiInterviewerState> {
  const stmt = latestAiControlStateStatement(sessionId);
  const { rows } = await pool.query<{ requested_state: unknown }>(stmt.sql, [...stmt.params]);
  const requestedState = rows[0]?.requested_state;
  return isAiRequestedState(requestedState) ? requestedState : "not_started";
}

function isTerminalSession(session: InterviewerSessionRow): boolean {
  return TERMINAL_SESSION_STATUSES.has(session.status);
}

function sessionRecord(session: InterviewerSessionRow): SessionRecord {
  return {
    sessionId: session.session_id,
    orgId: session.org_id,
    candidateEmail: session.candidate_email,
    scriptVersion: session.script_version,
    scheduledAt: new Date(session.scheduled_at ?? Date.now()).toISOString(),
    status: "scheduled",
  };
}

function terminalSessionReply() {
  return {
    error: "This interview session has ended.",
    code: "session_ended",
  };
}

export function registerInterviewerRoutes(
  app: FastifyInstance,
  liveKitConfig: LiveKitConfig,
): void {
  app.post<{ Params: InterviewerParams; Body: unknown }>(
    "/internal/interviews/:sessionId/candidate-invites",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        return reply.code(400).send({ error: "missing session id" });
      }

      const validation = validateBaseBody(request.body);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.reason });
      }

      const pool = getPool();
      const session = await loadSession(pool, sessionId, validation.body.orgId);
      if (!session) {
        return reply.code(404).send({ error: "interview not found" });
      }
      if (isTerminalSession(session)) {
        return reply.code(410).send(terminalSessionReply());
      }

      const inviteToken = generateInviteToken();
      const inviteStmt = candidateInviteInsertForSessionStatement({
        sessionId,
        candidateEmail: session.candidate_email,
        token: inviteToken,
      });
      await withInterviewerTransaction(pool, async (client) => {
        await client.query(inviteStmt.sql, [...inviteStmt.params]);
        await persistOpsEvent(client, {
          sessionId,
          eventType: "candidate_invite_created_by_interviewer",
          payload: {
            interviewer_email: validation.body.interviewerEmail,
            interviewer_user_id: validation.body.interviewerUserId,
          },
        });
      });
      const inviteExpiresAt = inviteStmt.params[5];

      return reply.code(201).send({
        invitePath: invitePath(inviteToken),
        inviteToken,
        inviteExpiresAt,
      });
    },
  );

  app.post<{ Params: InterviewerParams; Body: unknown }>(
    "/internal/interviews/:sessionId/interviewer/join",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        return reply.code(400).send({ error: "missing session id" });
      }

      const validation = validateBaseBody(request.body);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.reason });
      }

      const pool = getPool();
      const session = await loadSession(pool, sessionId, validation.body.orgId);
      if (!session) {
        return reply.code(404).send({ error: "interview not found" });
      }
      if (isTerminalSession(session)) {
        return reply.code(410).send(terminalSessionReply());
      }

      let room: string;
      try {
        const readiness = await ensureRoomReady(
          liveKitConfig,
          sessionId,
          buildWorkerDispatchMetadata(sessionRecord(session)),
          { hadPreviousRoom: Boolean(session.room_name), dispatchAgent: false },
        );
        room = readiness.room;
      } catch (error) {
        request.log.error({ err: error, sessionId }, "interviewer room readiness failed");
        return reply.code(503).send({
          error: "interview room could not be prepared; please try again shortly",
        });
      }

      const roomStmt = sessionRoomUpdateStatement(sessionId, room);
      await pool.query(roomStmt.sql, [...roomStmt.params]);
      const aiInterviewerState = await loadAiInterviewerState(pool, sessionId);

      const token = await buildInterviewerJoinToken(liveKitConfig, {
        sessionId,
        room,
        interviewerUserId: validation.body.interviewerUserId,
        interviewerEmail: validation.body.interviewerEmail,
      });

      return reply.code(200).send({
        sessionId,
        room,
        liveKitUrl: liveKitConfig.host,
        token,
        aiInterviewerState,
      });
    },
  );

  app.post<{ Params: InterviewerParams; Body: unknown }>(
    "/internal/interviews/:sessionId/interviewer/connected",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        return reply.code(400).send({ error: "missing session id" });
      }

      const validation = validateBaseBody(request.body);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.reason });
      }

      const pool = getPool();
      const session = await loadSession(pool, sessionId, validation.body.orgId);
      if (!session) {
        return reply.code(404).send({ error: "interview not found" });
      }
      if (isTerminalSession(session)) {
        return reply.code(410).send(terminalSessionReply());
      }

      let room = session.room_name?.trim() ?? "";
      if (!room) {
        try {
          const readiness = await ensureRoomReady(
            liveKitConfig,
            sessionId,
            buildWorkerDispatchMetadata(sessionRecord(session)),
            { hadPreviousRoom: false, dispatchAgent: false },
          );
          room = readiness.room;
        } catch (error) {
          request.log.error({ err: error, sessionId }, "interviewer room acknowledgement readiness failed");
          return reply.code(503).send({
            error: "interview room could not be prepared; please try again shortly",
          });
        }

        const roomStmt = sessionRoomUpdateStatement(sessionId, room);
        await pool.query(roomStmt.sql, [...roomStmt.params]);
      }

      await withInterviewerTransaction(pool, async (client) => {
        await persistOpsEvent(client, {
          sessionId,
          eventType: "interviewer_joined",
          payload: {
            interviewer_email: validation.body.interviewerEmail,
            interviewer_user_id: validation.body.interviewerUserId,
            room,
          },
        });
      });

      return reply.code(200).send({
        sessionId,
        room,
      });
    },
  );

  app.post<{ Params: InterviewerParams; Body: unknown }>(
    "/internal/interviews/:sessionId/ai-control",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        return reply.code(400).send({ error: "missing session id" });
      }

      const validation = validateAiControlBody(request.body);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.reason });
      }

      const pool = getPool();
      const session = await loadSession(pool, sessionId, validation.body.orgId);
      if (!session) {
        return reply.code(404).send({ error: "interview not found" });
      }
      if (isTerminalSession(session)) {
        return reply.code(410).send(terminalSessionReply());
      }

      const requestedState = aiControlStateFromAction(validation.body.action);
      const requestedAt = new Date().toISOString();
      const stateStmt = aiControlStateUpsertStatement({
        sessionId,
        requestedState,
        requestedByUserId: validation.body.interviewerUserId,
        requestedByEmail: validation.body.interviewerEmail,
        requestedAt,
      });
      await withInterviewerTransaction(pool, async (client) => {
        await client.query(stateStmt.sql, [...stateStmt.params]);
        await persistOpsEvent(client, {
          sessionId,
          eventType: aiControlEventType(validation.body.action),
          payload: {
            interviewer_email: validation.body.interviewerEmail,
            interviewer_user_id: validation.body.interviewerUserId,
            requested_state: requestedState,
          },
        });
      });

      return reply.code(200).send({
        sessionId,
        aiInterviewerState: requestedState,
        requestedAt,
      });
    },
  );
}
