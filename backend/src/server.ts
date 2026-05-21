import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { getPool } from "./db/pool.js";
import { provisionRoom, type LiveKitConfig } from "./livekit/provision.js";
import { registerSchedulerRoutes } from "./scheduler/routes.js";
import {
  buildSessionRecord,
  createSessionInsert,
  buildWorkerDispatchMetadata,
} from "./scheduler/sessions.js";
import { registerIntegrationRoutes } from "./integration/routes.js";
import type { CreateSessionRequest } from "./integration/contract.js";

// Reads the LiveKit credentials the room-provisioning code needs from the env.
// Throws if any are missing — the server must never start half-configured.
export function liveKitConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LiveKitConfig {
  const host = env.LIVEKIT_URL;
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;
  if (!host || !apiKey || !apiSecret) {
    throw new Error(
      "LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must all be set",
    );
  }
  return { host, apiKey, apiSecret };
}

// Creates one interview session: generates the session id, persists the row,
// provisions the LiveKit room, and dispatches the agent worker. This is the
// single create-session operation behind the platform integration endpoint.
export async function createSession(
  liveKitConfig: LiveKitConfig,
  input: CreateSessionRequest,
): Promise<{ sessionId: string; room: string }> {
  const record = buildSessionRecord({ ...input, sessionId: randomUUID() });
  const insert = createSessionInsert(record);
  await getPool().query(insert.sql, [...insert.params]);
  const { room } = await provisionRoom(
    liveKitConfig,
    record.sessionId,
    buildWorkerDispatchMetadata(record),
  );
  return { sessionId: record.sessionId, room };
}

// Builds the Fastify app with the Scheduler/API and platform-integration
// routes registered. Pure construction — no network I/O until a route is hit.
export function buildServer(liveKitConfig: LiveKitConfig): FastifyInstance {
  const app = Fastify({ logger: true });
  registerSchedulerRoutes(app, liveKitConfig);
  registerIntegrationRoutes(app, (body) => createSession(liveKitConfig, body));
  return app;
}

async function start(): Promise<void> {
  const app = buildServer(liveKitConfigFromEnv());
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? "0.0.0.0";
  await app.listen({ port, host });
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  start().catch((err) => {
    console.error("server failed to start:", err);
    process.exit(1);
  });
}
