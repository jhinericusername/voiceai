import type { FastifyInstance } from "fastify";
import { getPool } from "../db/pool.js";
import { provisionRoom, type LiveKitConfig } from "../livekit/provision.js";
import {
  buildSessionRecord,
  createSessionInsert,
  buildWorkerDispatchMetadata,
  type SessionInput,
} from "./sessions.js";

// POST /sessions — create a session, provision the room, dispatch the worker.
export function registerSchedulerRoutes(
  app: FastifyInstance,
  liveKitConfig: LiveKitConfig,
): void {
  app.post<{ Body: SessionInput }>("/sessions", async (request, reply) => {
    const record = buildSessionRecord(request.body);
    const insert = createSessionInsert(record);
    await getPool().query(insert.sql, [...insert.params]);
    const { room } = await provisionRoom(
      liveKitConfig,
      record.sessionId,
      buildWorkerDispatchMetadata(record),
    );
    return reply.code(201).send({ sessionId: record.sessionId, room });
  });
}
