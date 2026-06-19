import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashInviteToken } from "../src/invites/tokens.js";
import {
  aiControlStateFromAction,
  aiControlStateUpsertStatement,
  candidateInviteInsertForSessionStatement,
  hasInterviewerJoinedStatement,
  interviewerSessionStatement,
} from "../src/interviewers/repository.js";
import { registerInterviewerRoutes } from "../src/interviewers/routes.js";

const { queryMock, ensureRoomReadyMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  ensureRoomReadyMock: vi.fn(),
}));

vi.mock("../src/db/pool.js", () => ({
  getPool: () => ({ query: queryMock }),
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

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  ensureRoomReadyMock.mockReset();
  ensureRoomReadyMock.mockResolvedValue({
    room: "interview-sess1",
    roomCreated: true,
    dispatchCreated: false,
    roomRecreated: false,
  });
});

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

  it("checks whether an interviewer has already joined by ops event name", () => {
    const stmt = hasInterviewerJoinedStatement("sess1");

    expect(stmt.sql).toContain("FROM events");
    expect(stmt.sql).toContain("kind = 'ops'");
    expect(stmt.sql).toContain("payload->>'event_type' = 'interviewer_joined'");
    expect(stmt.sql).toContain("LIMIT 1");
    expect(stmt.params).toEqual(["sess1"]);
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
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO candidate_invites"))).toBe(true);
    const eventCall = queryMock.mock.calls.find(([sql, params]) =>
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

  it("prepares interviewer join room without dispatching the AI agent", async () => {
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
    expect(ensureRoomReadyMock).toHaveBeenCalledWith(
      FAKE_LK,
      "sess1",
      expect.any(String),
      { hadPreviousRoom: true, dispatchAgent: false },
    );
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("UPDATE sessions SET room_name"))).toBe(true);
    const eventCall = queryMock.mock.calls.find(([sql, params]) =>
      String(sql).includes("INSERT INTO events") &&
      String(params?.[2] ?? "").includes("interviewer_joined"),
    );
    expect(eventCall).toBeDefined();
    await app.close();
  });

  it("records AI control state and ops audit event", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM sessions")) {
        return { rows: [sessionRow()], rowCount: 1 };
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
    const stateCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO interview_ai_control_state"),
    );
    expect(stateCall?.[1]).toEqual([
      "sess1",
      "running",
      "user1",
      "interviewer@example.com",
      expect.any(String),
    ]);
    const eventCall = queryMock.mock.calls.find(([sql, params]) =>
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
