import type { FastifyInstance } from "fastify";
import { getPool } from "../db/pool.js";
import { liveKitRecordingsEnabledFromEnv } from "../livekit/egress.js";
import { provisionRoom, type LiveKitConfig } from "../livekit/provision.js";
import {
  buildSessionRecord,
  createSessionInsert,
  buildWorkerDispatchMetadata,
  sessionRoomUpdateStatement,
  type SessionInput,
} from "./sessions.js";
import {
  expectedRecordingArtifacts,
  recordingArtifactUpsertStatement,
  recordingUpsertStatement,
} from "../recordings/repository.js";

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
    const pool = getPool();
    if (liveKitRecordingsEnabledFromEnv()) {
      const roomUpdate = sessionRoomUpdateStatement(record.sessionId, room);
      await pool.query(roomUpdate.sql, [...roomUpdate.params]);
      const recording = recordingUpsertStatement({
        sessionId: record.sessionId,
        status: "pending",
      });
      await pool.query(recording.sql, [...recording.params]);
      for (const artifact of expectedRecordingArtifacts(record.orgId, record.sessionId)) {
        const stmt = recordingArtifactUpsertStatement(artifact);
        await pool.query(stmt.sql, [...stmt.params]);
      }
    }
    return reply.code(201).send({ sessionId: record.sessionId, room });
  });
}
