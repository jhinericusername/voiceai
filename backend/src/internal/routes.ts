import type { FastifyInstance } from "fastify";
import { getPool } from "../db/pool.js";
import { persistOpsEvent } from "../events/repository.js";
import { sessionStatusUpdateStatement } from "../scheduler/sessions.js";

interface InternalSessionParams {
  readonly sessionId: string;
}

interface InternalSessionEventBody {
  readonly eventType?: string;
  readonly payload?: Record<string, unknown>;
  readonly status?: "incomplete";
  readonly endedAt?: string;
}

function validEventType(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{1,80}$/.test(value);
}

export function registerInternalSessionRoutes(app: FastifyInstance): void {
  app.post<{ Params: InternalSessionParams; Body: InternalSessionEventBody }>(
    "/internal/sessions/:sessionId/events",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        return reply.code(400).send({ error: "missing session id" });
      }

      if (!validEventType(request.body?.eventType)) {
        return reply.code(400).send({ error: "missing or invalid eventType" });
      }

      const pool = getPool();
      if (request.body.status !== undefined) {
        if (request.body.status !== "incomplete") {
          return reply.code(400).send({ error: "unsupported session status" });
        }
        const statusStmt = sessionStatusUpdateStatement(sessionId, request.body.status, {
          endedAt: request.body.endedAt ?? new Date().toISOString(),
        });
        await pool.query(statusStmt.sql, [...statusStmt.params]);
      }

      await persistOpsEvent(pool, {
        sessionId,
        eventType: request.body.eventType,
        payload: {
          ...(request.body.payload ?? {}),
          ...(request.body.status ? { status: request.body.status } : {}),
        },
      });

      return reply.code(202).send({ ok: true });
    },
  );
}
