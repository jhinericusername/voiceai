import type { FastifyInstance } from "fastify";
import { getPool } from "../db/pool.js";
import { roomName, type LiveKitConfig } from "../livekit/provision.js";
import {
  buildSessionRecord,
  createSessionInsert,
  type SessionInput,
} from "./sessions.js";

// POST /sessions — create a scheduled session. Room readiness is handled when
// the candidate joins so pre-created rooms cannot expire before the interview.
export function registerSchedulerRoutes(
  app: FastifyInstance,
  _liveKitConfig: LiveKitConfig,
): void {
  app.post<{ Body: SessionInput }>("/sessions", async (request, reply) => {
    const record = buildSessionRecord(request.body);
    const insert = createSessionInsert(record);
    await getPool().query(insert.sql, [...insert.params]);
    return reply.code(201).send({
      sessionId: record.sessionId,
      room: roomName(record.sessionId),
    });
  });
}
