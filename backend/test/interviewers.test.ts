import Fastify from "fastify";
import { TokenVerifier } from "livekit-server-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCandidateInviteRoutes } from "../src/invites/routes.js";
import type { CandidateInviteRow } from "../src/invites/repository.js";
import { hashInviteToken } from "../src/invites/tokens.js";
import {
  aiControlStateFromAction,
  aiControlStateUpsertStatement,
  candidateInviteInsertForSessionStatement,
  hasInterviewerJoinedStatement,
  interviewerSessionStatement,
  latestAiControlStateStatement,
} from "../src/interviewers/repository.js";
import { registerInterviewerRoutes } from "../src/interviewers/routes.js";

const { queryMock, clientQueryMock, connectMock, releaseMock, ensureRoomReadyMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  clientQueryMock: vi.fn(),
  connectMock: vi.fn(),
  releaseMock: vi.fn(),
  ensureRoomReadyMock: vi.fn(),
}));

vi.mock("../src/db/pool.js", () => ({
  getPool: () => ({ query: queryMock, connect: connectMock }),
}));

vi.mock("../src/livekit/provision.js", async () => {
  const actual = await vi.importActual<typeof import("../src/livekit/provision.js")>(
    "../src/livekit/provision.js",
  );
  return {
    ...actual,
    ensureRoomReady: ensureRoomReadyMock,
  };
});

const FAKE_LK = { host: "wss://livekit.example", apiKey: "key", apiSecret: "secret" };

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    session_id: "sess1",
    org_id: "org1",
    candidate_email: "candidate@example.com",
    script_version: "pilot-v1",
    status: "scheduled",
    scheduled_at: "2026-05-25T12:00:00Z",
    room_name: null,
    ...overrides,
  };
}

function candidateInviteRow(overrides: Partial<CandidateInviteRow> = {}): CandidateInviteRow {
  return {
    invite_id: "invite1",
    session_id: "sess1",
    org_id: "org1",
    script_version: "pilot-v1",
    candidate_email: "candidate@example.com",
    session_status: "scheduled",
    scheduled_at: null,
    room_name: null,
    status: "active",
    not_before: "2026-01-01T00:00:00.000Z",
    expires_at: "2027-01-01T00:00:00.000Z",
    revoked_at: null,
    join_count: 0,
    ...overrides,
  };
}

const CANDIDATE_JOIN_PAYLOAD = {
  consent: {
    aiDisclosureAcknowledged: true,
    recordingConsented: true,
    dataUseAcknowledged: true,
    consentedAt: "2026-06-01T12:00:00.000Z",
  },
};

beforeEach(() => {
  vi.stubEnv("PUDDLE_RECORDINGS_ENABLED", "false");
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  clientQueryMock.mockReset();
  clientQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  connectMock.mockReset();
  connectMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock });
  releaseMock.mockReset();
  ensureRoomReadyMock.mockReset();
  ensureRoomReadyMock.mockResolvedValue({
    room: "interview-sess1",
    roomCreated: true,
    dispatchCreated: false,
    roomRecreated: false,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function clientSqls(): string[] {
  return clientQueryMock.mock.calls.map(([sql]) => String(sql));
}

function expectClientSqlOrder(...fragments: string[]): void {
  const sqls = clientSqls();
  const indexes = fragments.map((fragment) =>
    sqls.findIndex((sql) => sql.includes(fragment)),
  );
  for (const index of indexes) {
    expect(index).toBeGreaterThanOrEqual(0);
  }
  expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
}

function setupCandidateJoinQueries(input: {
  readonly interviewerJoined: boolean;
  readonly failSkipEvent?: boolean;
}): void {
  const invite = candidateInviteRow(input.interviewerJoined ? { room_name: "interview-sess1" } : {});

  queryMock.mockImplementation(async (sql: string, params?: readonly unknown[]) => {
    if (sql.includes("FROM candidate_invites")) {
      return { rows: [invite], rowCount: 1 };
    }
    if (sql.includes("payload->>'event_type' = 'human_interviewer_joined'")) {
      return {
        rows: input.interviewerJoined ? [{ exists: true }] : [],
        rowCount: input.interviewerJoined ? 1 : 0,
      };
    }
    if (sql.includes("INSERT INTO events")) {
      const payload = JSON.parse(String(params?.[2] ?? "{}")) as { event_type?: string };
      if (
        input.failSkipEvent &&
        payload.event_type === "ai_interviewer_auto_dispatch_skipped"
      ) {
        throw new Error("skip event insert failed");
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SELECT entry_hash")) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 1 };
  });
}

function insertedEventPayloads(): Array<Record<string, unknown>> {
  return queryMock.mock.calls.flatMap(([sql, params]) => {
    if (!String(sql).includes("INSERT INTO events") || !Array.isArray(params)) {
      return [];
    }
    return [JSON.parse(String(params[2])) as Record<string, unknown>];
  });
}

function clientInsertedEventPayloads(): Array<Record<string, unknown>> {
  return clientQueryMock.mock.calls.flatMap(([sql, params]) => {
    if (!String(sql).includes("INSERT INTO events") || !Array.isArray(params)) {
      return [];
    }
    return [JSON.parse(String(params[2])) as Record<string, unknown>];
  });
}

function markedCandidateInviteUsed(): boolean {
  return queryMock.mock.calls.some(([sql, params]) => {
    return (
      String(sql).includes("UPDATE candidate_invites") &&
      Array.isArray(params) &&
      params[0] === "invite1"
    );
  });
}

describe("interviewer repository", () => {
  it("queries one same-org interviewer session by session id and org id", () => {
    const stmt = interviewerSessionStatement("sess1", "org1");

    expect(stmt.sql).toContain("FROM sessions");
    expect(stmt.sql).toContain("session_id = $1");
    expect(stmt.sql).toContain("org_id = $2");
    expect(stmt.sql).toContain("room_name");
    expect(stmt.params).toEqual(["sess1", "org1"]);
  });

  it("inserts candidate invites with a token hash instead of the raw token", () => {
    const stmt = candidateInviteInsertForSessionStatement({
      sessionId: "sess1",
      candidateEmail: "candidate@example.com",
      token: "inv_raw_secret",
      now: new Date("2026-05-25T12:00:00Z"),
      ttlSeconds: 600,
    });

    expect(stmt.sql).toContain("INSERT INTO candidate_invites");
    expect(stmt.sql).toContain("token_hash");
    expect(stmt.params).toContain(hashInviteToken("inv_raw_secret"));
    expect(stmt.params).not.toContain("inv_raw_secret");
    expect(stmt.params).toContain("2026-05-25T12:10:00.000Z");
  });

  it("maps AI control actions to requested state", () => {
    expect(aiControlStateFromAction("start")).toBe("running");
    expect(aiControlStateFromAction("resume")).toBe("running");
    expect(aiControlStateFromAction("stop")).toBe("stopped");
  });

  it("upserts the latest requested AI control state", () => {
    const stmt = aiControlStateUpsertStatement({
      sessionId: "sess1",
      requestedState: "running",
      requestedByUserId: "user1",
      requestedByEmail: "interviewer@example.com",
      requestedAt: "2026-05-25T12:00:00.000Z",
    });

    expect(stmt.sql).toContain("INSERT INTO interview_ai_control_state");
    expect(stmt.sql).toContain("ON CONFLICT (session_id) DO UPDATE SET");
    expect(stmt.sql).toContain("requested_state = EXCLUDED.requested_state");
    expect(stmt.sql).toContain("updated_at = now()");
    expect(stmt.params).toEqual([
      "sess1",
      "running",
      "user1",
      "interviewer@example.com",
      "2026-05-25T12:00:00.000Z",
    ]);
  });

  it("queries the latest requested AI control state for a session", () => {
    const stmt = latestAiControlStateStatement("sess1");

    expect(stmt.sql).toContain("FROM interview_ai_control_state");
    expect(stmt.sql).toContain("session_id = $1");
    expect(stmt.sql).toContain("ORDER BY requested_at DESC");
    expect(stmt.sql).toContain("LIMIT 1");
    expect(stmt.params).toEqual(["sess1"]);
  });

  it("checks whether an interviewer has already joined by ops event name", () => {
    const stmt = hasInterviewerJoinedStatement("sess1");

    expect(stmt.sql).toContain("FROM events");
    expect(stmt.sql).toContain("kind = 'ops'");
    expect(stmt.sql).toContain("payload->>'event_type' = 'human_interviewer_joined'");
    expect(stmt.sql).toContain("LIMIT 1");
    expect(stmt.params).toEqual(["sess1"]);
  });
});

describe("candidate auto-dispatch guard", () => {
  it("uses interviewer join events as the durable human-present signal", () => {
    const stmt = hasInterviewerJoinedStatement("sess-human");

    expect(stmt.sql).toContain("human_interviewer_joined");
    expect(stmt.sql).toContain("LIMIT 1");
    expect(stmt.params).toEqual(["sess-human"]);
  });
});

describe("candidate join auto-dispatch behavior", () => {
  it("dispatches the AI interviewer when no interviewer join event exists", async () => {
    setupCandidateJoinQueries({ interviewerJoined: false });
    const app = Fastify();
    registerCandidateInviteRoutes(app, FAKE_LK);

    const res = await app.inject({
      method: "POST",
      url: "/candidate/invites/inv_test/join",
      payload: CANDIDATE_JOIN_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      sessionId: "sess1",
      room: "interview-sess1",
      liveKitUrl: "wss://livekit.example",
      token: expect.any(String),
    });
    expect(ensureRoomReadyMock).toHaveBeenCalledWith(
      FAKE_LK,
      "sess1",
      expect.any(String),
      { hadPreviousRoom: false, dispatchAgent: true },
    );
    expect(markedCandidateInviteUsed()).toBe(true);
    expect(insertedEventPayloads()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "candidate_first_join" }),
      ]),
    );
    expect(
      insertedEventPayloads().some(
        (payload) => payload.event_type === "ai_interviewer_auto_dispatch_skipped",
      ),
    ).toBe(false);
    await app.close();
  });

  it("skips AI auto-dispatch when an interviewer join event exists", async () => {
    setupCandidateJoinQueries({ interviewerJoined: true });
    const app = Fastify();
    registerCandidateInviteRoutes(app, FAKE_LK);

    const res = await app.inject({
      method: "POST",
      url: "/candidate/invites/inv_test/join",
      payload: CANDIDATE_JOIN_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().token).toEqual(expect.any(String));
    expect(ensureRoomReadyMock).toHaveBeenCalledWith(
      FAKE_LK,
      "sess1",
      expect.any(String),
      { hadPreviousRoom: true, dispatchAgent: false },
    );
    expect(markedCandidateInviteUsed()).toBe(true);
    expect(insertedEventPayloads()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "candidate_first_join" }),
        expect.objectContaining({
          event_type: "ai_interviewer_auto_dispatch_skipped",
          reason: "human_interviewer_joined",
          invite_id: "invite1",
          room: "interview-sess1",
        }),
      ]),
    );
    await app.close();
  });

  it("still lets the candidate join when the skip audit event fails", async () => {
    setupCandidateJoinQueries({ interviewerJoined: true, failSkipEvent: true });
    const app = Fastify();
    registerCandidateInviteRoutes(app, FAKE_LK);

    const res = await app.inject({
      method: "POST",
      url: "/candidate/invites/inv_test/join",
      payload: CANDIDATE_JOIN_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().token).toEqual(expect.any(String));
    expect(ensureRoomReadyMock).toHaveBeenCalledWith(
      FAKE_LK,
      "sess1",
      expect.any(String),
      { hadPreviousRoom: true, dispatchAgent: false },
    );
    expect(markedCandidateInviteUsed()).toBe(true);
    expect(insertedEventPayloads()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: "candidate_first_join" }),
      ]),
    );
    await app.close();
  });
});

describe("interviewer internal routes", () => {
  it("rejects interviewer join when no same-org session exists", async () => {
    const app = Fastify();
    registerInterviewerRoutes(app, FAKE_LK);

    const res = await app.inject({
      method: "POST",
      url: "/internal/interviews/sess1/interviewer/join",
      payload: {
        orgId: "wrong-org",
        interviewerEmail: "interviewer@example.com",
        interviewerUserId: "user1",
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "interview not found" });
    await app.close();
  });

  it("mints a candidate invite and records interviewer metadata", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM sessions")) {
        return { rows: [sessionRow()], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT entry_hash")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    const app = Fastify();
    registerInterviewerRoutes(app, FAKE_LK);

    const res = await app.inject({
      method: "POST",
      url: "/internal/interviews/sess1/candidate-invites",
      payload: {
        orgId: "org1",
        interviewerEmail: "interviewer@example.com",
        interviewerUserId: "user1",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.invitePath).toBe(`/interview/${encodeURIComponent(body.inviteToken)}`);
    expect(body.inviteExpiresAt).toEqual(expect.any(String));
    expectClientSqlOrder(
      "BEGIN",
      "INSERT INTO candidate_invites",
      "INSERT INTO events",
      "INSERT INTO audit_log",
      "COMMIT",
    );
    const eventCall = clientQueryMock.mock.calls.find(([sql, params]) =>
      String(sql).includes("INSERT INTO events") &&
      String(params?.[2] ?? "").includes("candidate_invite_created_by_interviewer"),
    );
    expect(eventCall).toBeDefined();
    expect(JSON.parse(eventCall?.[1]?.[2] as string)).toMatchObject({
      event_type: "candidate_invite_created_by_interviewer",
      interviewer_email: "interviewer@example.com",
      interviewer_user_id: "user1",
    });
    await app.close();
  });

  it("rolls back candidate invite insert when event persistence fails", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM sessions")) {
        return { rows: [sessionRow()], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO events")) {
        throw new Error("event insert failed");
      }
      return { rows: [], rowCount: 1 };
    });
    const app = Fastify();
    registerInterviewerRoutes(app, FAKE_LK);

    const res = await app.inject({
      method: "POST",
      url: "/internal/interviews/sess1/candidate-invites",
      payload: {
        orgId: "org1",
        interviewerEmail: "interviewer@example.com",
        interviewerUserId: "user1",
      },
    });

    expect(res.statusCode).toBe(500);
    expectClientSqlOrder("BEGIN", "INSERT INTO candidate_invites", "INSERT INTO events", "ROLLBACK");
    expect(clientSqls()).not.toContain("COMMIT");
    expect(releaseMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("prepares interviewer join room without dispatching the AI agent or recording human presence", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM sessions")) {
        return { rows: [sessionRow({ room_name: "interview-sess1" })], rowCount: 1 };
      }
      if (sql.includes("FROM interview_ai_control_state")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT entry_hash")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    const app = Fastify();
    registerInterviewerRoutes(app, FAKE_LK);

    const res = await app.inject({
      method: "POST",
      url: "/internal/interviews/sess1/interviewer/join",
      payload: {
        orgId: "org1",
        interviewerEmail: "interviewer@example.com",
        interviewerUserId: "user1",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      sessionId: "sess1",
      room: "interview-sess1",
      liveKitUrl: "wss://livekit.example",
      aiInterviewerState: "not_started",
    });
    expect(res.json().token).toEqual(expect.any(String));
    const verifier = new TokenVerifier("key", "secret");
    const claims = await verifier.verify(res.json().token);
    expect(JSON.parse(String(claims.metadata))).toMatchObject({
      participant_kind: "interviewer",
      session_id: "sess1",
      interviewer_user_id: "user1",
    });
    expect(ensureRoomReadyMock).toHaveBeenCalledWith(
      FAKE_LK,
      "sess1",
      expect.any(String),
      { hadPreviousRoom: true, dispatchAgent: false },
    );
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("UPDATE sessions SET room_name"))).toBe(true);
    const eventCall = queryMock.mock.calls.find(([sql, params]) =>
      String(sql).includes("INSERT INTO events") &&
      String(params?.[2] ?? "").includes("human_interviewer_joined"),
    );
    expect(eventCall).toBeUndefined();
    await app.close();
  });

  it("records interviewer human presence only after the room connected acknowledgement", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM sessions")) {
        return { rows: [sessionRow({ room_name: "interview-sess1" })], rowCount: 1 };
      }
      if (sql.includes("SELECT entry_hash")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    const app = Fastify();
    registerInterviewerRoutes(app, FAKE_LK);

    const res = await app.inject({
      method: "POST",
      url: "/internal/interviews/sess1/interviewer/connected",
      payload: {
        orgId: "org1",
        interviewerEmail: "interviewer@example.com",
        interviewerUserId: "user1",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      sessionId: "sess1",
      room: "interview-sess1",
    });
    expect(ensureRoomReadyMock).not.toHaveBeenCalled();
    expectClientSqlOrder(
      "BEGIN",
      "INSERT INTO events",
      "SELECT entry_hash",
      "INSERT INTO audit_log",
      "COMMIT",
    );
    expect(clientInsertedEventPayloads()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "human_interviewer_joined",
          interviewer_email: "interviewer@example.com",
          interviewer_user_id: "user1",
          room: "interview-sess1",
        }),
      ]),
    );
    await app.close();
  });

  it("rolls back interviewer presence acknowledgement when audit persistence fails", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM sessions")) {
        return { rows: [sessionRow({ room_name: "interview-sess1" })], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO audit_log")) {
        throw new Error("audit insert failed");
      }
      return { rows: [], rowCount: 1 };
    });
    const app = Fastify();
    registerInterviewerRoutes(app, FAKE_LK);

    const res = await app.inject({
      method: "POST",
      url: "/internal/interviews/sess1/interviewer/connected",
      payload: {
        orgId: "org1",
        interviewerEmail: "interviewer@example.com",
        interviewerUserId: "user1",
      },
    });

    expect(res.statusCode).toBe(500);
    expectClientSqlOrder(
      "BEGIN",
      "INSERT INTO events",
      "SELECT entry_hash",
      "INSERT INTO audit_log",
      "ROLLBACK",
    );
    expect(clientInsertedEventPayloads()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "human_interviewer_joined",
          interviewer_email: "interviewer@example.com",
          interviewer_user_id: "user1",
          room: "interview-sess1",
        }),
      ]),
    );
    expect(clientSqls()).not.toContain("COMMIT");
    expect(insertedEventPayloads()).toEqual([]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it.each(["running", "stopped"] as const)(
    "returns persisted %s AI control state on interviewer join",
    async (requestedState) => {
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes("FROM sessions")) {
          return { rows: [sessionRow({ room_name: "interview-sess1" })], rowCount: 1 };
        }
        if (sql.includes("FROM interview_ai_control_state")) {
          return { rows: [{ requested_state: requestedState }], rowCount: 1 };
        }
        if (sql.includes("SELECT entry_hash")) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      });
      const app = Fastify();
      registerInterviewerRoutes(app, FAKE_LK);

      const res = await app.inject({
        method: "POST",
        url: "/internal/interviews/sess1/interviewer/join",
        payload: {
          orgId: "org1",
          interviewerEmail: "interviewer@example.com",
          interviewerUserId: "user1",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        sessionId: "sess1",
        aiInterviewerState: requestedState,
      });
      expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("FROM interview_ai_control_state"))).toBe(true);
      await app.close();
    },
  );

  it("records AI control state and ops audit event", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM sessions")) {
        return { rows: [sessionRow()], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT entry_hash")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    const app = Fastify();
    registerInterviewerRoutes(app, FAKE_LK);

    const res = await app.inject({
      method: "POST",
      url: "/internal/interviews/sess1/ai-control",
      payload: {
        orgId: "org1",
        interviewerEmail: "interviewer@example.com",
        interviewerUserId: "user1",
        action: "resume",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      sessionId: "sess1",
      aiInterviewerState: "running",
      requestedAt: expect.any(String),
    });
    expectClientSqlOrder(
      "BEGIN",
      "INSERT INTO interview_ai_control_state",
      "INSERT INTO events",
      "INSERT INTO audit_log",
      "COMMIT",
    );
    const stateCall = clientQueryMock.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO interview_ai_control_state"),
    );
    expect(stateCall?.[1]).toEqual([
      "sess1",
      "running",
      "user1",
      "interviewer@example.com",
      expect.any(String),
    ]);
    const eventCall = clientQueryMock.mock.calls.find(([sql, params]) =>
      String(sql).includes("INSERT INTO events") &&
      String(params?.[2] ?? "").includes("ai_interviewer_resume_requested"),
    );
    expect(eventCall).toBeDefined();
    expect(JSON.parse(eventCall?.[1]?.[2] as string)).toMatchObject({
      event_type: "ai_interviewer_resume_requested",
      interviewer_email: "interviewer@example.com",
      interviewer_user_id: "user1",
      requested_state: "running",
    });
    await app.close();
  });

  it("rolls back AI control state when event persistence fails", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM sessions")) {
        return { rows: [sessionRow()], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO events")) {
        throw new Error("event insert failed");
      }
      return { rows: [], rowCount: 1 };
    });
    const app = Fastify();
    registerInterviewerRoutes(app, FAKE_LK);

    const res = await app.inject({
      method: "POST",
      url: "/internal/interviews/sess1/ai-control",
      payload: {
        orgId: "org1",
        interviewerEmail: "interviewer@example.com",
        interviewerUserId: "user1",
        action: "start",
      },
    });

    expect(res.statusCode).toBe(500);
    expectClientSqlOrder(
      "BEGIN",
      "INSERT INTO interview_ai_control_state",
      "INSERT INTO events",
      "ROLLBACK",
    );
    expect(clientSqls()).not.toContain("COMMIT");
    expect(releaseMock).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("rejects terminal sessions with the candidate join ended response", async () => {
    queryMock.mockResolvedValue({ rows: [sessionRow({ status: "review_ready" })], rowCount: 1 });
    const app = Fastify();
    registerInterviewerRoutes(app, FAKE_LK);

    const res = await app.inject({
      method: "POST",
      url: "/internal/interviews/sess1/ai-control",
      payload: {
        orgId: "org1",
        interviewerEmail: "interviewer@example.com",
        interviewerUserId: "user1",
        action: "stop",
      },
    });

    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({
      error: "This interview session has ended.",
      code: "session_ended",
    });
    await app.close();
  });
});
