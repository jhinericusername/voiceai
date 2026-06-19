import type { FastifyInstance } from "fastify";
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
  type AiControlAction,
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

async function loadSession(sessionId: string, orgId: string): Promise<InterviewerSessionRow | undefined> {
  const stmt = interviewerSessionStatement(sessionId, orgId);
  const { rows } = await getPool().query<InterviewerSessionRow>(stmt.sql, [...stmt.params]);
  return rows[0];
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

      const session = await loadSession(sessionId, validation.body.orgId);
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
      await getPool().query(inviteStmt.sql, [...inviteStmt.params]);
      const inviteExpiresAt = inviteStmt.params[5];

      await persistOpsEvent(getPool(), {
        sessionId,
        eventType: "candidate_invite_created_by_interviewer",
        payload: {
          interviewer_email: validation.body.interviewerEmail,
          interviewer_user_id: validation.body.interviewerUserId,
        },
      });

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

      const session = await loadSession(sessionId, validation.body.orgId);
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
      await getPool().query(roomStmt.sql, [...roomStmt.params]);

      const token = await buildInterviewerJoinToken(liveKitConfig, {
        sessionId,
        room,
        interviewerUserId: validation.body.interviewerUserId,
        interviewerEmail: validation.body.interviewerEmail,
      });

      await persistOpsEvent(getPool(), {
        sessionId,
        eventType: "interviewer_joined",
        payload: {
          interviewer_email: validation.body.interviewerEmail,
          interviewer_user_id: validation.body.interviewerUserId,
          room,
        },
      });

      return reply.code(200).send({
        sessionId,
        room,
        liveKitUrl: liveKitConfig.host,
        token,
        aiInterviewerState: "not_started",
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

      const session = await loadSession(sessionId, validation.body.orgId);
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
      await getPool().query(stateStmt.sql, [...stateStmt.params]);

      await persistOpsEvent(getPool(), {
        sessionId,
        eventType: aiControlEventType(validation.body.action),
        payload: {
          interviewer_email: validation.body.interviewerEmail,
          interviewer_user_id: validation.body.interviewerUserId,
          requested_state: requestedState,
        },
      });

      return reply.code(200).send({
        sessionId,
        aiInterviewerState: requestedState,
        requestedAt,
      });
    },
  );
}
