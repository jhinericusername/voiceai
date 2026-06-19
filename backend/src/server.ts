import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { getPool } from "./db/pool.js";
import { roomName, type LiveKitConfig } from "./livekit/provision.js";
import { registerLiveKitWebhookRoutes } from "./livekit/webhooks.js";
import { registerSchedulerRoutes } from "./scheduler/routes.js";
import {
  buildSessionRecord,
  createSessionInsert,
} from "./scheduler/sessions.js";
import { registerIntegrationRoutes } from "./integration/routes.js";
import type { CreateSessionRequest, CreateSessionResponse } from "./integration/contract.js";
import { registerCandidateInviteRoutes } from "./invites/routes.js";
import { registerInternalSessionRoutes } from "./internal/routes.js";
import { registerInterviewerRoutes } from "./interviewers/routes.js";
import { registerDashboardRoutes } from "./dashboard/routes.js";
import {
  buildCandidateInviteRecord,
  createCandidateInviteInsert,
  invitePath,
} from "./invites/repository.js";
import { generateInviteToken } from "./invites/tokens.js";
import { registerInternalAuth } from "./integration/internal-auth.js";
import { registerAshbyRoutes } from "./ashby/routes.js";
import { registerGradingRoutes } from "./grading/routes.js";
import { backendLoggerOptions } from "./logging/redaction.js";

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

// Creates one interview session and invite. LiveKit room/agent provisioning is
// intentionally deferred until the candidate joins, so rooms cannot expire
// while waiting for a candidate to open the invite.
export async function createSession(
  _liveKitConfig: LiveKitConfig,
  input: CreateSessionRequest,
): Promise<CreateSessionResponse> {
  const record = buildSessionRecord({ ...input, sessionId: randomUUID() });
  const insert = createSessionInsert(record);
  const pool = getPool();
  await pool.query(insert.sql, [...insert.params]);

  const inviteToken = generateInviteToken();
  const invite = buildCandidateInviteRecord({
    sessionId: record.sessionId,
    candidateEmail: record.candidateEmail,
    token: inviteToken,
    ttlSeconds: input.inviteTtlSeconds,
  });
  const inviteInsert = createCandidateInviteInsert(invite);
  await pool.query(inviteInsert.sql, [...inviteInsert.params]);

  return {
    sessionId: record.sessionId,
    room: roomName(record.sessionId),
    inviteToken,
    invitePath: invitePath(inviteToken),
    inviteExpiresAt: invite.expiresAt,
  };
}

// Builds the Fastify app with the Scheduler/API and platform-integration
// routes registered. Pure construction — no network I/O until a route is hit.
export function buildServer(liveKitConfig: LiveKitConfig): FastifyInstance {
  const app = Fastify({ logger: backendLoggerOptions() });
  // Local dev: the room app runs on Vite (default :5173). Production deploys
  // override CORS_ORIGINS with a comma-separated allowlist of public origins.
  const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  void app.register(cors, { origin: corsOrigins });
  app.addContentTypeParser(
    "application/webhook+json",
    { parseAs: "string" },
    (_request, body, done) => {
      done(null, body);
    },
  );
  registerInternalAuth(app);
  app.get("/healthz", async () => ({ ok: true }));
  registerSchedulerRoutes(app, liveKitConfig);
  registerIntegrationRoutes(app, (body) => createSession(liveKitConfig, body));
  registerCandidateInviteRoutes(app, liveKitConfig);
  registerInternalSessionRoutes(app);
  registerInterviewerRoutes(app, liveKitConfig);
  registerDashboardRoutes(app);
  registerLiveKitWebhookRoutes(app, liveKitConfig);
  registerAshbyRoutes(app);
  registerGradingRoutes(app);
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
