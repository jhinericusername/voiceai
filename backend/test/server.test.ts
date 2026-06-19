import Fastify from "fastify";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { backendLoggerOptions, SECRET_REDACTION_CENSOR } from "../src/logging/redaction.js";
import { buildServer, liveKitConfigFromEnv } from "../src/server.js";

const {
  queryMock,
  clientQueryMock,
  connectMock,
  releaseMock,
  artifactSendMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  clientQueryMock: vi.fn(),
  connectMock: vi.fn(),
  releaseMock: vi.fn(),
  artifactSendMock: vi.fn(),
}));

vi.mock("../src/db/pool.js", () => ({
  getPool: () => ({ query: queryMock, connect: connectMock }),
}));

vi.mock("../src/storage/artifactStore.js", () => ({
  createArtifactS3Client: () => ({ send: artifactSendMock }),
  artifactS3Key: (storagePath: string) => storagePath.replace(/^\/+/, ""),
  putJsonArtifact: async (
    client: { send: (command: { input: Record<string, unknown> }) => Promise<unknown> },
    input: {
      readonly bucket: string;
      readonly storagePath: string;
      readonly body: unknown;
    },
  ) => {
    await client.send({
      input: {
        Bucket: input.bucket,
        Key: input.storagePath.replace(/^\/+/, ""),
        Body: `${JSON.stringify(input.body, null, 2)}\n`,
        ContentType: "application/json",
      },
    });
  },
  putJsonLinesArtifact: async (
    client: { send: (command: { input: Record<string, unknown> }) => Promise<unknown> },
    input: {
      readonly bucket: string;
      readonly storagePath: string;
      readonly rows: readonly unknown[];
    },
  ) => {
    const body = input.rows.map((row) => JSON.stringify(row)).join("\n");
    await client.send({
      input: {
        Bucket: input.bucket,
        Key: input.storagePath.replace(/^\/+/, ""),
        Body: body ? `${body}\n` : "",
        ContentType: "application/x-ndjson",
      },
    });
  },
}));

const FAKE_LK = { host: "wss://example", apiKey: "key", apiSecret: "secret" };

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  clientQueryMock.mockReset();
  clientQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  releaseMock.mockReset();
  connectMock.mockReset();
  connectMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock });
  artifactSendMock.mockReset();
  artifactSendMock.mockResolvedValue({});
});

function clientSqls(): string[] {
  return clientQueryMock.mock.calls.map(([sql]) => String(sql));
}

function clientQueryContaining(fragment: string): [unknown, unknown?] {
  const call = clientQueryMock.mock.calls.find(([sql]) => String(sql).includes(fragment));
  expect(call).toBeDefined();
  return call as [unknown, unknown?];
}

function expectOpsEventParams(): unknown[] {
  return clientQueryContaining("INSERT INTO events")[1] as unknown[];
}

function expectOpsEventPayload(): Record<string, unknown> {
  const params = expectOpsEventParams();
  expect(params[2]).toEqual(expect.any(String));
  return JSON.parse(params[2] as string) as Record<string, unknown>;
}

function expectSqlOrder(...fragments: string[]): void {
  const sqls = clientSqls();
  const indexes = fragments.map((fragment) =>
    sqls.findIndex((sql) => sql.includes(fragment)),
  );
  for (const index of indexes) {
    expect(index).toBeGreaterThanOrEqual(0);
  }
  expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
}

function expectTransactionCommitted(): void {
  expect(clientSqls()).toContain("BEGIN");
  expect(clientSqls()).toContain("COMMIT");
  expect(clientSqls()).not.toContain("ROLLBACK");
  expectSqlOrder("BEGIN", "INSERT INTO events", "COMMIT");
  expect(releaseMock).toHaveBeenCalledTimes(1);
  expect(releaseMock.mock.calls[0]).toEqual([]);
}

function expectNoDbAccess(): void {
  expect(queryMock).not.toHaveBeenCalled();
  expect(connectMock).not.toHaveBeenCalled();
  expect(clientQueryMock).not.toHaveBeenCalled();
  expect(releaseMock).not.toHaveBeenCalled();
}

function buildServerWithoutInternalAuth(): {
  readonly app: ReturnType<typeof buildServer>;
  readonly close: () => Promise<void>;
} {
  const previousToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
  delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
  const app = buildServer(FAKE_LK);
  return {
    app,
    close: async () => {
      if (previousToken === undefined) {
        delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
      } else {
        process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousToken;
      }
      await app.close();
    },
  };
}

describe("liveKitConfigFromEnv", () => {
  it("throws when LiveKit env vars are missing", () => {
    expect(() => liveKitConfigFromEnv({})).toThrow(/LIVEKIT/);
  });

  it("reads LiveKit config from the environment", () => {
    const cfg = liveKitConfigFromEnv({
      LIVEKIT_URL: "wss://example",
      LIVEKIT_API_KEY: "key",
      LIVEKIT_API_SECRET: "secret",
    });
    expect(cfg).toEqual({ host: "wss://example", apiKey: "key", apiSecret: "secret" });
  });
});

describe("buildServer", () => {
  it("configures explicit backend secret redaction", () => {
    const loggerOptions = backendLoggerOptions();
    expect(loggerOptions.redact).toMatchObject({
      censor: SECRET_REDACTION_CENSOR,
    });

    expect(loggerOptions.redact.paths).toEqual(
      expect.arrayContaining([
        "req.headers.authorization",
        "req.headers.cookie",
        'req.headers["ashby-signature"]',
        "body.ashbyApiKey",
        "body.webhookSecret",
        "body.signature",
        "body.rawBody",
        "payload.ashbyApiKey",
        "payload.webhookSecret",
        "payload.signature",
        "payload.rawBody",
      ]),
    );
  });

  it("redacts representative secret fields from backend log output", async () => {
    const chunks: string[] = [];
    const app = Fastify({
      logger: {
        ...backendLoggerOptions(),
        stream: {
          write: (chunk: string) => {
            chunks.push(chunk);
          },
        },
      },
    });

    app.log.info(
      {
        req: {
          headers: {
            authorization: "Bearer internal-secret",
            cookie: "session=secret-cookie",
            "ashby-signature": "signature-secret",
          },
        },
        body: {
          ashbyApiKey: "ashby-secret",
          webhookSecret: "webhook-secret",
          rawBody: "raw-secret",
          signature: "body-signature-secret",
        },
        payload: {
          ashbyApiKey: "payload-ashby-secret",
          webhookSecret: "payload-webhook-secret",
        },
        token: "internal-token-secret",
      },
      "redaction check",
    );
    await app.close();

    const output = chunks.join("");
    expect(output).toContain(SECRET_REDACTION_CENSOR);
    expect(output).not.toContain("internal-secret");
    expect(output).not.toContain("secret-cookie");
    expect(output).not.toContain("signature-secret");
    expect(output).not.toContain("ashby-secret");
    expect(output).not.toContain("webhook-secret");
    expect(output).not.toContain("raw-secret");
    expect(output).not.toContain("internal-token-secret");
  });

  it("serves a lightweight health check", async () => {
    const app = buildServer(FAKE_LK);
    const res = await app.inject({
      method: "GET",
      url: "/healthz",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("fails closed in production when the backend internal token is missing", () => {
    const previousToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    const previousNodeEnv = process.env.NODE_ENV;
    delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    process.env.NODE_ENV = "production";
    try {
      expect(() => buildServer(FAKE_LK)).toThrow(/PUDDLE_BACKEND_INTERNAL_TOKEN/);
    } finally {
      if (previousToken === undefined) {
        delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
      } else {
        process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousToken;
      }
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it("rejects an invalid platform create-session request with 400", async () => {
    const previousToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integration/sessions",
        headers: { "content-type": "application/json" },
        payload: {
          orgId: "org1",
          candidateEmail: "",
          scriptVersion: "pilot-v1",
          scheduledAt: "2026-05-21T15:00:00Z",
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("candidateEmail");
    } finally {
      if (previousToken === undefined) {
        delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
      } else {
        process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousToken;
      }
      await app.close();
    }
  });

  it("persists Ashby source metadata for platform-created interview sessions", async () => {
    const previousToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    const app = buildServer(FAKE_LK);
    try {
      const sourceMetadata = {
        ashby: {
          selected: {
            applicationId: "app_1",
            candidateId: "cand_1",
            candidateName: "Maya Chen",
            jobId: "job_1",
            currentStage: "Initial Screen",
          },
        },
      };
      const res = await app.inject({
        method: "POST",
        url: "/integration/sessions",
        headers: { "content-type": "application/json" },
        payload: {
          orgId: "org1",
          candidateEmail: "maya@example.com",
          scriptVersion: "pilot-v1",
          scheduledAt: "2026-05-21T15:00:00Z",
          sourceMetadata,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(queryMock).toHaveBeenCalledTimes(2);
      expect(String(queryMock.mock.calls[0]?.[0])).toContain("source_metadata");
      expect((queryMock.mock.calls[0]?.[1] as unknown[]).at(-1)).toBe(
        JSON.stringify(sourceMetadata),
      );
    } finally {
      if (previousToken === undefined) {
        delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
      } else {
        process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousToken;
      }
      await app.close();
    }
  });

  it("registers the streaming finalization route and rejects invalid completion reasons", async () => {
    const previousToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/sess1/finalize",
        headers: { "content-type": "application/json" },
        payload: {
          completionReason: "unknown",
          scriptVersion: "pilot-v1",
          finalTurnCount: 0,
          integrityFlags: [],
          agentEventCount: 0,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("completionReason");
    } finally {
      if (previousToken === undefined) {
        delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
      } else {
        process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousToken;
      }
      await app.close();
    }
  });

  it("rejects malformed streaming finalization payloads before persistence", async () => {
    const previousToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/sess1/finalize",
        headers: { "content-type": "application/json" },
        payload: {
          completionReason: "completed",
          scriptVersion: "pilot-v1",
          finalTurnCount: 0,
          integrityFlags: [],
          agentEventCount: 0,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("scoreCheckpointCount");
    } finally {
      if (previousToken === undefined) {
        delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
      } else {
        process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousToken;
      }
      await app.close();
    }
  });

  it("registers dashboard interview routes behind internal auth", async () => {
    const previousToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = "test-token";
    const app = buildServer(FAKE_LK);
    try {
      expect(app.hasRoute({ method: "GET", url: "/internal/interviews" })).toBe(true);
      expect(app.hasRoute({ method: "GET", url: "/internal/interviews/:sessionId" })).toBe(
        true,
      );
      const res = await app.inject({
        method: "GET",
        url: "/internal/interviews",
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "unauthorized" });
    } finally {
      if (previousToken === undefined) {
        delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
      } else {
        process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousToken;
      }
      await app.close();
    }
  });

  it("rejects dashboard interview reads without an organization scope", async () => {
    const previousToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    const app = buildServer(FAKE_LK);
    try {
      const listRes = await app.inject({
        method: "GET",
        url: "/internal/interviews",
      });
      expect(listRes.statusCode).toBe(400);
      expect(listRes.json()).toEqual({ error: "orgId is required" });

      const detailRes = await app.inject({
        method: "GET",
        url: "/internal/interviews/sess1",
      });
      expect(detailRes.statusCode).toBe(400);
      expect(detailRes.json()).toEqual({ error: "orgId is required" });
    } finally {
      if (previousToken === undefined) {
        delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
      } else {
        process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousToken;
      }
      await app.close();
    }
  });

  it("requires internal auth when the backend token is configured", async () => {
    const previousToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = "test-token";
    const app = buildServer(FAKE_LK);
    try {
      const unauthenticated = await app.inject({
        method: "POST",
        url: "/integration/sessions",
        headers: { "content-type": "application/json" },
        payload: {
          orgId: "org1",
          candidateEmail: "",
          scriptVersion: "pilot-v1",
          scheduledAt: "2026-05-21T15:00:00Z",
        },
      });
      expect(unauthenticated.statusCode).toBe(401);

      const authenticated = await app.inject({
        method: "POST",
        url: "/integration/sessions",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        payload: {
          orgId: "org1",
          candidateEmail: "",
          scriptVersion: "pilot-v1",
          scheduledAt: "2026-05-21T15:00:00Z",
        },
      });
      expect(authenticated.statusCode).toBe(400);
    } finally {
      if (previousToken === undefined) {
        delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
      } else {
        process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousToken;
      }
      await app.close();
    }
  });

  it("requires internal auth for plural integrations routes", async () => {
    const previousToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = "test-token";
    const app = buildServer(FAKE_LK);
    try {
      const unauthenticated = await app.inject({
        method: "POST",
        url: "/integrations/ashby/company-state",
        headers: { "content-type": "application/json" },
        payload: { emailDomain: "usepuddle.com" },
      });
      expect(unauthenticated.statusCode).toBe(401);
    } finally {
      if (previousToken === undefined) {
        delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
      } else {
        process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousToken;
      }
      await app.close();
    }
  });

  it("persists streaming transcript turns and emits an ops event", async () => {
    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/transcript-turns",
        headers: { "content-type": "application/json" },
        payload: {
          turnIndex: 2,
          speaker: "candidate",
          questionId: "q1",
          text: "I scaled the ingestion pipeline.",
          occurredAt: "2026-06-11T04:18:22.000Z",
          offsetMs: 42000,
          source: "deepgram:nova-3",
        },
      });

      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ ok: true });
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(clientQueryContaining("INSERT INTO transcript_turns")[1]).toEqual([
        "session-1",
        2,
        "candidate",
        "q1",
        "I scaled the ingestion pipeline.",
        "2026-06-11T04:18:22.000Z",
        42000,
        "deepgram:nova-3",
      ]);
      expect(expectOpsEventParams().slice(0, 2)).toEqual(["session-1", "ops"]);
      expect(expectOpsEventPayload()).toEqual({
        event_type: "transcript_turn_persisted",
        turn_index: 2,
        speaker: "candidate",
        question_id: "q1",
        source: "deepgram:nova-3",
        unreliable: false,
      });
      clientQueryContaining("INSERT INTO audit_log");
      expectSqlOrder("BEGIN", "INSERT INTO transcript_turns", "INSERT INTO events", "COMMIT");
      expectTransactionCommitted();
    } finally {
      await close();
    }
  });

  it("persists true streaming transcript unreliable flags in ops events", async () => {
    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/transcript-turns",
        headers: { "content-type": "application/json" },
        payload: {
          turnIndex: 3,
          speaker: "candidate",
          text: "The transcript might be wrong here.",
          unreliable: true,
        },
      });

      expect(res.statusCode).toBe(202);
      expect(expectOpsEventParams().slice(0, 2)).toEqual(["session-1", "ops"]);
      expect(expectOpsEventPayload()).toEqual({
        event_type: "transcript_turn_persisted",
        turn_index: 3,
        speaker: "candidate",
        question_id: null,
        source: "livekit",
        unreliable: true,
      });
      expectTransactionCommitted();
    } finally {
      await close();
    }
  });

  it("rejects invalid streaming transcript turns before DB access", async () => {
    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/transcript-turns",
        headers: { "content-type": "application/json" },
        payload: {
          turnIndex: -1,
          speaker: "candidate",
          text: "Invalid.",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("turnIndex");
      expectNoDbAccess();
    } finally {
      await close();
    }
  });

  it("rejects invalid optional streaming transcript fields before DB access", async () => {
    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/transcript-turns",
        headers: { "content-type": "application/json" },
        payload: {
          turnIndex: 1,
          speaker: "candidate",
          text: "Valid required fields.",
          source: "",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("source");
      expectNoDbAccess();
    } finally {
      await close();
    }
  });

  it("rejects non-boolean streaming transcript unreliable flags before DB access", async () => {
    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/transcript-turns",
        headers: { "content-type": "application/json" },
        payload: {
          turnIndex: 1,
          speaker: "candidate",
          text: "Valid required fields.",
          unreliable: "true",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("unreliable");
      expectNoDbAccess();
    } finally {
      await close();
    }
  });

  it("requires internal auth for new internal session artifact endpoints", async () => {
    const previousToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = "test-token";
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/transcript-turns",
        headers: { "content-type": "application/json" },
        payload: {
          turnIndex: 1,
          speaker: "candidate",
          text: "Valid required fields.",
        },
      });

      expect(res.statusCode).toBe(401);
      expectNoDbAccess();
    } finally {
      if (previousToken === undefined) {
        delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
      } else {
        process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousToken;
      }
      await app.close();
    }
  });

  it("requires internal auth for interviewer internal routes", async () => {
    const previousToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = "test-token";
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/interviews/session-1/ai-control",
        headers: { "content-type": "application/json" },
        payload: {
          orgId: "org1",
          interviewerEmail: "interviewer@example.com",
          interviewerUserId: "user1",
          action: "start",
        },
      });

      expect(res.statusCode).toBe(401);
      expectNoDbAccess();
    } finally {
      if (previousToken === undefined) {
        delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
      } else {
        process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousToken;
      }
      await app.close();
    }
  });

  it("persists agent events and emits an ops event", async () => {
    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/agent-events",
        headers: { "content-type": "application/json" },
        payload: {
          sequence: 3,
          turnIndex: 3,
          utterance: "Can you explain the tradeoff?",
          reasonCode: "PROBE_LOW_CONFIDENCE",
          questionId: "q2",
          category: "technical_depth",
          missingElement: "tradeoff",
          occurredAt: "2026-06-11T04:18:31.000Z",
        },
      });

      expect(res.statusCode).toBe(202);
      expect(clientQueryContaining("INSERT INTO agent_events")[1]).toEqual([
        "session-1",
        3,
        3,
        "Can you explain the tradeoff?",
        "PROBE_LOW_CONFIDENCE",
        "q2",
        "technical_depth",
        "tradeoff",
        "2026-06-11T04:18:31.000Z",
      ]);
      expect(expectOpsEventParams().slice(0, 2)).toEqual(["session-1", "ops"]);
      expect(expectOpsEventPayload()).toEqual({
        event_type: "agent_event_persisted",
        sequence: 3,
        reason_code: "PROBE_LOW_CONFIDENCE",
        question_id: "q2",
      });
      expectSqlOrder("BEGIN", "INSERT INTO agent_events", "INSERT INTO events", "COMMIT");
      expectTransactionCommitted();
    } finally {
      await close();
    }
  });

  it("rejects invalid agent events before DB access", async () => {
    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/agent-events",
        headers: { "content-type": "application/json" },
        payload: {
          sequence: 3,
          reasonCode: "PROBE_LOW_CONFIDENCE",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("utterance");
      expectNoDbAccess();
    } finally {
      await close();
    }
  });

  it("persists score checkpoints and emits an ops event", async () => {
    const assessments = [
      {
        category: "technical_depth",
        provisionalScore: 3,
        confidence: 0.82,
        evidenceQuotes: ["I scaled the ingestion pipeline."],
        missingOrAmbiguous: [],
      },
    ];
    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/score-checkpoints",
        headers: { "content-type": "application/json" },
        payload: {
          sequence: 1,
          questionId: "q2",
          model: "gpt-5",
          assessments,
        },
      });

      expect(res.statusCode).toBe(202);
      expect(clientQueryContaining("INSERT INTO score_checkpoints")[1]).toEqual([
        "session-1",
        1,
        "q2",
        "gpt-5",
        JSON.stringify(assessments),
      ]);
      expect(expectOpsEventParams().slice(0, 2)).toEqual(["session-1", "ops"]);
      expect(expectOpsEventPayload()).toEqual({
        event_type: "score_checkpoint_persisted",
        sequence: 1,
        question_id: "q2",
        model: "gpt-5",
        assessment_count: 1,
      });
      expectSqlOrder("BEGIN", "INSERT INTO score_checkpoints", "INSERT INTO events", "COMMIT");
      expectTransactionCommitted();
    } finally {
      await close();
    }
  });

  it("rejects invalid score checkpoints before DB access", async () => {
    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/score-checkpoints",
        headers: { "content-type": "application/json" },
        payload: {
          sequence: 1,
          questionId: "q2",
          model: "gpt-5",
          assessments: [],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("assessments");
      expectNoDbAccess();
    } finally {
      await close();
    }
  });

  it("rejects score checkpoint session ID mismatches before DB access", async () => {
    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/score-checkpoints",
        headers: { "content-type": "application/json" },
        payload: {
          sessionId: "session-2",
          sequence: 1,
          questionId: "q2",
          model: "gpt-5",
          assessments: [
            {
              category: "technical_depth",
              provisionalScore: 3,
              confidence: 0.82,
              evidenceQuotes: [],
              missingOrAmbiguous: [],
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("sessionId");
      expectNoDbAccess();
    } finally {
      await close();
    }
  });

  it("persists completed finalization events, final artifacts, and recording_finalizing status", async () => {
    const previousBucket = process.env.PUDDLE_ARTIFACTS_BUCKET;
    process.env.PUDDLE_ARTIFACTS_BUCKET = "artifact-bucket";
    clientQueryMock.mockImplementation(async (sql: unknown) => {
      const sqlText = String(sql);
      if (sqlText.includes("FROM sessions")) {
        return {
          rows: [
            {
              session_id: "session-1",
              org_id: "org1",
              script_version: "pilot-v1",
            },
          ],
          rowCount: 1,
        };
      }
      if (sqlText.includes("FROM transcript_turns")) {
        return {
          rows: [
            {
              session_id: "session-1",
              turn_index: 0,
              speaker: "candidate",
              question_id: "q1",
              text: "I scaled the ingestion pipeline.",
              occurred_at: "2026-06-11T04:16:00.000Z",
              offset_ms: 12000,
              source: "deepgram:nova-3",
            },
          ],
          rowCount: 1,
        };
      }
      if (sqlText.includes("FROM agent_events")) {
        return {
          rows: [],
          rowCount: 0,
        };
      }
      if (sqlText.includes("FROM score_checkpoints")) {
        return {
          rows: [
            {
              session_id: "session-1",
              sequence: 0,
              question_id: "q1",
              model: "gpt-5",
              assessments: [
                {
                  category: "technical_depth",
                  provisionalScore: 3,
                  confidence: 0.8,
                  evidenceQuotes: ["I scaled the ingestion pipeline."],
                  missingOrAmbiguous: [],
                },
              ],
            },
          ],
          rowCount: 1,
        };
      }
      if (sqlText.includes("FROM recording_artifacts")) {
        return {
          rows: [
            { kind: "composite_video", status: "available" },
            { kind: "transcript", status: "available" },
            { kind: "scores", status: "available" },
            { kind: "integrity_flags", status: "available" },
            { kind: "agent_events", status: "available" },
          ],
          rowCount: 5,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/finalize",
        headers: { "content-type": "application/json" },
        payload: {
          completionReason: "completed",
          scriptVersion: "pilot-v1",
          finalTurnCount: 1,
          integrityFlags: [],
          agentEventCount: 0,
          scoreCheckpointCount: 1,
        },
      });

      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ ok: true, status: "recording_finalizing" });
      expect(expectOpsEventParams().slice(0, 2)).toEqual(["session-1", "ops"]);
      expect(expectOpsEventPayload()).toEqual({
        event_type: "interview_finalization_requested",
        completion_reason: "completed",
        script_version: "pilot-v1",
        final_turn_count: 1,
        integrity_flags: [],
        agent_event_count: 0,
        score_checkpoint_count: 1,
      });
      const statusParams = clientQueryContaining("UPDATE sessions SET status = $2")[1] as unknown[];
      expect(statusParams[0]).toBe("session-1");
      expect(statusParams[1]).toBe("recording_finalizing");
      expect(typeof statusParams[3]).toBe("string");
      clientQueryContaining("FROM sessions WHERE session_id = $1");
      clientQueryContaining("FROM transcript_turns WHERE session_id = $1 ORDER BY turn_index ASC");
      clientQueryContaining("FROM agent_events WHERE session_id = $1 ORDER BY sequence ASC");
      clientQueryContaining("FROM score_checkpoints WHERE session_id = $1 ORDER BY sequence ASC");
      clientQueryContaining("INSERT INTO assessments");
      clientQueryContaining("SELECT kind, status FROM recording_artifacts WHERE session_id = $1");
      expect(artifactSendMock).toHaveBeenCalledTimes(4);
      expect(artifactSendMock.mock.calls.map(([command]) => command.input.Key)).toEqual([
        "org1/interviews/session-1/transcripts/transcript.v1.json",
        "org1/interviews/session-1/events/agent_events.jsonl",
        "org1/interviews/session-1/assessment/scores.json",
        "org1/interviews/session-1/assessment/integrity_flags.json",
      ]);
      expectSqlOrder(
        "BEGIN",
        "INSERT INTO events",
        "UPDATE sessions SET status = $2",
        "FROM sessions WHERE session_id = $1",
        "INSERT INTO assessments",
        "SELECT kind, status FROM recording_artifacts",
        "COMMIT",
      );
      expectTransactionCommitted();
    } finally {
      if (previousBucket === undefined) {
        delete process.env.PUDDLE_ARTIFACTS_BUCKET;
      } else {
        process.env.PUDDLE_ARTIFACTS_BUCKET = previousBucket;
      }
      await close();
    }
  });

  it("rolls back completed finalization when durable rows are missing before sending artifacts", async () => {
    const previousBucket = process.env.PUDDLE_ARTIFACTS_BUCKET;
    process.env.PUDDLE_ARTIFACTS_BUCKET = "artifact-bucket";
    clientQueryMock.mockImplementation(async (sql: unknown) => {
      const sqlText = String(sql);
      if (sqlText.includes("FROM sessions")) {
        return {
          rows: [
            {
              session_id: "session-1",
              org_id: "org1",
              script_version: "pilot-v1",
            },
          ],
          rowCount: 1,
        };
      }
      if (sqlText.includes("FROM transcript_turns")) {
        return { rows: [], rowCount: 0 };
      }
      if (sqlText.includes("FROM agent_events")) {
        return { rows: [], rowCount: 0 };
      }
      if (sqlText.includes("FROM score_checkpoints")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/finalize",
        headers: { "content-type": "application/json" },
        payload: {
          completionReason: "completed",
          scriptVersion: "pilot-v1",
          finalTurnCount: 1,
          integrityFlags: [],
          agentEventCount: 0,
          scoreCheckpointCount: 0,
        },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().message).toContain("finalTurnCount");
      clientQueryContaining("FROM sessions WHERE session_id = $1");
      clientQueryContaining("FROM transcript_turns WHERE session_id = $1 ORDER BY turn_index ASC");
      clientQueryContaining("FROM agent_events WHERE session_id = $1 ORDER BY sequence ASC");
      clientQueryContaining("FROM score_checkpoints WHERE session_id = $1 ORDER BY sequence ASC");
      expect(clientSqls().some((sql) => sql.includes("INSERT INTO assessments"))).toBe(false);
      expect(clientSqls().some((sql) => sql.includes("FROM recording_artifacts"))).toBe(false);
      expect(artifactSendMock).not.toHaveBeenCalled();
      expect(clientSqls()).toContain("ROLLBACK");
      expect(clientSqls()).not.toContain("COMMIT");
      expect(releaseMock).toHaveBeenCalledTimes(1);
    } finally {
      if (previousBucket === undefined) {
        delete process.env.PUDDLE_ARTIFACTS_BUCKET;
      } else {
        process.env.PUDDLE_ARTIFACTS_BUCKET = previousBucket;
      }
      await close();
    }
  });

  it("rejects invalid finalization payloads before DB access", async () => {
    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/finalize",
        headers: { "content-type": "application/json" },
        payload: {
          completionReason: "unknown",
          scriptVersion: "pilot-v1",
          finalTurnCount: 12,
          integrityFlags: [],
          agentEventCount: 4,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("completionReason");
      expectNoDbAccess();
    } finally {
      await close();
    }
  });

  it("rejects completed finalization without scoreCheckpointCount before DB access", async () => {
    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/finalize",
        headers: { "content-type": "application/json" },
        payload: {
          completionReason: "completed",
          scriptVersion: "pilot-v1",
          finalTurnCount: 12,
          integrityFlags: [],
          agentEventCount: 4,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("scoreCheckpointCount");
      expectNoDbAccess();
    } finally {
      await close();
    }
  });

  it("marks non-completed finalized sessions incomplete and emits an ops event", async () => {
    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/finalize",
        headers: { "content-type": "application/json" },
        payload: {
          completionReason: "candidate_disconnected",
          scriptVersion: "pilot-v1",
          finalTurnCount: 7,
          integrityFlags: ["candidate_disconnected"],
          agentEventCount: 3,
        },
      });

      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ ok: true, status: "incomplete" });
      const statusCall = clientQueryContaining("UPDATE sessions SET status = $2");
      const statusParams = statusCall[1] as unknown[];
      expect(statusParams[0]).toBe("session-1");
      expect(statusParams[1]).toBe("incomplete");
      expect(typeof statusParams[3]).toBe("string");
      expect(expectOpsEventParams().slice(0, 2)).toEqual(["session-1", "ops"]);
      expect(expectOpsEventPayload()).toEqual({
        event_type: "interview_finalization_requested",
        completion_reason: "candidate_disconnected",
        script_version: "pilot-v1",
        final_turn_count: 7,
        integrity_flags: ["candidate_disconnected"],
        agent_event_count: 3,
      });
      expect(clientSqls().some((sql) => sql.includes("FROM sessions"))).toBe(false);
      expect(clientSqls().some((sql) => sql.includes("INSERT INTO assessments"))).toBe(false);
      expect(clientSqls().some((sql) => sql.includes("recording_artifacts"))).toBe(false);
      expect(artifactSendMock).not.toHaveBeenCalled();
      expectSqlOrder("BEGIN", "INSERT INTO events", "UPDATE sessions SET status = $2", "COMMIT");
      expectTransactionCommitted();
    } finally {
      await close();
    }
  });

  it("persists generic internal session events with status updates transactionally", async () => {
    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/events",
        headers: { "content-type": "application/json" },
        payload: {
          eventType: "candidate_disconnected",
          payload: { room_name: "room-session-1" },
          status: "incomplete",
          endedAt: "2026-06-11T04:20:00.000Z",
        },
      });

      expect(res.statusCode).toBe(202);
      const statusCall = clientQueryContaining("UPDATE sessions SET status = $2");
      expect(statusCall[1]).toEqual([
        "session-1",
        "incomplete",
        null,
        "2026-06-11T04:20:00.000Z",
      ]);
      expect(expectOpsEventParams().slice(0, 2)).toEqual(["session-1", "ops"]);
      expect(expectOpsEventPayload()).toEqual({
        event_type: "candidate_disconnected",
        room_name: "room-session-1",
        status: "incomplete",
      });
      clientQueryContaining("INSERT INTO audit_log");
      expectSqlOrder("BEGIN", "UPDATE sessions SET status = $2", "INSERT INTO events", "COMMIT");
      expectTransactionCommitted();
    } finally {
      await close();
    }
  });

  it("does not roll back or double-release when release throws after commit", async () => {
    releaseMock.mockImplementationOnce(() => {
      throw new Error("release unavailable");
    });

    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/events",
        headers: { "content-type": "application/json" },
        payload: {
          eventType: "candidate_disconnected",
          payload: { room_name: "room-session-1" },
        },
      });

      expect(res.statusCode).toBe(202);
      expect(clientSqls()).toContain("COMMIT");
      expect(clientSqls()).not.toContain("ROLLBACK");
      expect(releaseMock).toHaveBeenCalledTimes(1);
      expect(releaseMock.mock.calls[0]).toEqual([]);
    } finally {
      await close();
    }
  });

  it("rolls back and releases the client when ops persistence fails after artifact insert", async () => {
    clientQueryMock.mockImplementation(async (sql: unknown) => {
      if (String(sql).includes("INSERT INTO audit_log")) {
        throw new Error("audit unavailable");
      }
      return { rows: [], rowCount: 0 };
    });

    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/transcript-turns",
        headers: { "content-type": "application/json" },
        payload: {
          turnIndex: 2,
          speaker: "candidate",
          text: "This should roll back.",
        },
      });

      expect(res.statusCode).toBe(500);
      clientQueryContaining("INSERT INTO transcript_turns");
      clientQueryContaining("INSERT INTO events");
      expect(clientSqls()).toContain("ROLLBACK");
      expect(clientSqls()).not.toContain("COMMIT");
      expect(releaseMock).toHaveBeenCalledTimes(1);
      expect(releaseMock.mock.calls[0]).toEqual([]);
    } finally {
      await close();
    }
  });

  it("preserves the original error and destroys the client when rollback fails", async () => {
    const auditFailure = new Error("audit unavailable");
    const rollbackFailure = new Error("rollback unavailable");
    clientQueryMock.mockImplementation(async (sql: unknown) => {
      const sqlText = String(sql);
      if (sqlText.includes("INSERT INTO audit_log")) {
        throw auditFailure;
      }
      if (sqlText === "ROLLBACK") {
        throw rollbackFailure;
      }
      return { rows: [], rowCount: 0 };
    });

    const { app, close } = buildServerWithoutInternalAuth();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/session-1/events",
        headers: { "content-type": "application/json" },
        payload: {
          eventType: "candidate_disconnected",
          payload: { room_name: "room-session-1" },
          status: "incomplete",
        },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().message).toBe("audit unavailable");
      clientQueryContaining("UPDATE sessions SET status = $2");
      clientQueryContaining("INSERT INTO events");
      expect(clientSqls()).toContain("ROLLBACK");
      expect(clientSqls()).not.toContain("COMMIT");
      expect(releaseMock).toHaveBeenCalledWith(rollbackFailure);
      expect(releaseMock).toHaveBeenCalledTimes(1);
    } finally {
      await close();
    }
  });
});
