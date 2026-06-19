import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDraftRubric } from "../src/grading/rubric.js";
import { buildServer } from "../src/server.js";

const { clientQueryMock, connectMock, queryMock, releaseMock, sqlCalls, queryCalls, routeState } = vi.hoisted(() => {
  const sqlCalls: string[] = [];
  const queryCalls: Array<{ readonly sql: string; readonly params: readonly unknown[] }> = [];
  const routeState = {
    profileRows: [
      {
        profile_id: "profile_1",
        organization_id: "org_1",
        ashby_job_id: "job_1",
        draft_rubric_version_id: "rv_1",
      },
    ] as Array<Record<string, unknown>>,
    approveRows: [{ rubric_version_id: "rv_1", status: "approved" }] as Array<Record<string, unknown>>,
    approveRowCount: 1,
    activateRows: [{ profile_id: "profile_1", status: "recommendations_active" }] as Array<Record<string, unknown>>,
    activateRowCount: 1,
  };
  const queryMock = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
    sqlCalls.push(String(sql));
    queryCalls.push({ sql: String(sql), params });
    if (String(sql).includes("role_grading_profiles")) {
      return {
        rows: [
          {
            profile_id: "profile_1",
            organization_id: "org_1",
            ashby_job_id: "job_1",
            status: "draft_needed",
            active_rubric: null,
            draft_rubric: null,
          },
        ],
        rowCount: 1,
      };
    }
    if (String(sql).includes("reviewer_feedback")) {
      return {
        rows: [
          {
            feedback_id: "feedback_1",
            recommendation_id: "rec_1",
            reviewer_decision: "hold",
          },
        ],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
  const clientQueryMock = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
    sqlCalls.push(String(sql));
    queryCalls.push({ sql: String(sql), params });
    if (String(sql).includes("SELECT * FROM role_grading_profiles")) {
      return {
        rows: routeState.profileRows,
        rowCount: routeState.profileRows.length,
      };
    }
    if (String(sql).includes("MAX(version)")) {
      return { rows: [{ next_version: 2 }], rowCount: 1 };
    }
    if (String(sql).includes("UPDATE role_rubric_versions")) {
      return {
        rows: routeState.approveRows,
        rowCount: routeState.approveRowCount,
      };
    }
    if (String(sql).includes("UPDATE role_grading_profiles")) {
      return {
        rows: routeState.activateRows,
        rowCount: routeState.activateRowCount,
      };
    }
    return { rows: [], rowCount: 0 };
  });
  const releaseMock = vi.fn();
  const connectMock = vi.fn(async () => ({
    query: clientQueryMock,
    release: releaseMock,
  }));
  return { clientQueryMock, connectMock, queryMock, releaseMock, sqlCalls, queryCalls, routeState };
});

vi.mock("../src/db/pool.js", () => ({
  getPool: () => ({ connect: connectMock, query: queryMock }),
}));

const FAKE_LK = { host: "wss://example", apiKey: "key", apiSecret: "secret" };
const previousBackendToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;

describe("grading routes", () => {
  beforeEach(() => {
    delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    sqlCalls.length = 0;
    queryCalls.length = 0;
    routeState.profileRows = [
      {
        profile_id: "profile_1",
        organization_id: "org_1",
        ashby_job_id: "job_1",
        draft_rubric_version_id: "rv_1",
      },
    ];
    routeState.approveRows = [{ rubric_version_id: "rv_1", status: "approved" }];
    routeState.approveRowCount = 1;
    routeState.activateRows = [{ profile_id: "profile_1", status: "recommendations_active" }];
    routeState.activateRowCount = 1;
    queryMock.mockClear();
    clientQueryMock.mockClear();
    connectMock.mockClear();
    releaseMock.mockClear();
  });

  afterEach(() => {
    if (previousBackendToken === undefined) {
      delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    } else {
      process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousBackendToken;
    }
  });

  it("returns company grading state for an organization", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/company-state",
        headers: { "content-type": "application/json" },
        payload: { organizationId: "org_1" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        profiles: [
          {
            profile_id: "profile_1",
            organization_id: "org_1",
            ashby_job_id: "job_1",
            status: "draft_needed",
            active_rubric: null,
            draft_rubric: null,
          },
        ],
      });
      expect(sqlCalls.some((sql) => sql.includes("role_grading_profiles"))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("creates a draft rubric for a grading profile", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/profiles/profile_1/draft",
        headers: { "content-type": "application/json" },
        payload: {
          organizationId: "org_1",
          actorEmail: "reviewer@example.com",
          jobName: "Founding AI Engineer",
          historicalSessionCount: 12,
          matchedApplicationCount: 10,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        rubricVersionId: expect.any(String),
        rubric: {
          script_version: "job_1-v1",
          role: { organization_id: "org_1", ashby_job_id: "job_1", title: "Founding AI Engineer" },
        },
      });
      expect(sqlCalls.some((sql) => sql.includes("role_grading_profiles"))).toBe(true);
      expect(sqlCalls.some((sql) => sql.includes("role_rubric_versions"))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("approves a draft rubric and activates recommendations", async () => {
    const rubric = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/profiles/profile_1/approve",
        headers: { "content-type": "application/json" },
        payload: {
          organizationId: "org_1",
          actorEmail: "reviewer@example.com",
          rubricVersionId: "rv_1",
          rubric,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        profile: { profile_id: "profile_1", status: "recommendations_active" },
      });
      expect(sqlCalls.some((sql) => sql.includes("role_grading_profiles"))).toBe(true);
      expect(sqlCalls.some((sql) => sql.includes("role_rubric_versions"))).toBe(true);
      expect(
        queryCalls.find((call) => call.sql.includes("UPDATE role_rubric_versions"))?.params,
      ).toEqual([
        "rv_1",
        "profile_1",
        "org_1",
        JSON.stringify(rubric),
        "reviewer@example.com",
      ]);
      expect(
        queryCalls.find((call) => call.sql.includes("UPDATE role_grading_profiles"))?.params,
      ).toEqual(["profile_1", "org_1", "rv_1", "reviewer@example.com"]);
    } finally {
      await app.close();
    }
  });

  it("returns 404 when approving a missing grading profile", async () => {
    routeState.profileRows = [];
    const rubric = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/profiles/profile_1/approve",
        headers: { "content-type": "application/json" },
        payload: {
          organizationId: "org_1",
          actorEmail: "reviewer@example.com",
          rubricVersionId: "rv_1",
          rubric,
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "grading profile not found" });
      expect(sqlCalls).toContain("ROLLBACK");
      expect(sqlCalls.some((sql) => sql.includes("UPDATE role_rubric_versions"))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("returns 409 when approving a rubric version that is not the current draft", async () => {
    routeState.profileRows = [
      {
        profile_id: "profile_1",
        organization_id: "org_1",
        ashby_job_id: "job_1",
        draft_rubric_version_id: "rv_other",
      },
    ];
    const rubric = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/profiles/profile_1/approve",
        headers: { "content-type": "application/json" },
        payload: {
          organizationId: "org_1",
          actorEmail: "reviewer@example.com",
          rubricVersionId: "rv_1",
          rubric,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "rubric version is not the current draft" });
      expect(sqlCalls).toContain("ROLLBACK");
      expect(sqlCalls.some((sql) => sql.includes("UPDATE role_rubric_versions"))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("returns 409 when approval does not update the scoped draft rubric", async () => {
    routeState.approveRows = [];
    routeState.approveRowCount = 0;
    const rubric = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/profiles/profile_1/approve",
        headers: { "content-type": "application/json" },
        payload: {
          organizationId: "org_1",
          actorEmail: "reviewer@example.com",
          rubricVersionId: "rv_1",
          rubric,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "rubric version is not the current draft" });
      expect(sqlCalls).toContain("ROLLBACK");
      expect(sqlCalls.some((sql) => sql.includes("UPDATE role_grading_profiles"))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("returns 409 when activation does not update the scoped grading profile", async () => {
    routeState.activateRows = [];
    routeState.activateRowCount = 0;
    const rubric = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/profiles/profile_1/approve",
        headers: { "content-type": "application/json" },
        payload: {
          organizationId: "org_1",
          actorEmail: "reviewer@example.com",
          rubricVersionId: "rv_1",
          rubric,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "grading profile activation failed" });
      expect(sqlCalls).toContain("ROLLBACK");
    } finally {
      await app.close();
    }
  });

  it("stores reviewer feedback", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/rec_1/feedback",
        headers: { "content-type": "application/json" },
        payload: {
          sessionId: "sess_1",
          organizationId: "org_1",
          reviewerEmail: "reviewer@example.com",
          reviewerDecision: "hold",
          overrideReason: "Needs hiring manager review.",
          dimensionFeedback: {
            problem_solving: { correctedScore: 2.5, notes: "AI score was too generous." },
            agency: "Too high",
          },
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({
        feedback: {
          feedback_id: "feedback_1",
          recommendation_id: "rec_1",
          reviewer_decision: "hold",
        },
      });
      expect(sqlCalls.some((sql) => sql.includes("reviewer_feedback"))).toBe(true);
      expect(queryCalls.at(-1)?.params[7]).toBe(
        JSON.stringify({
          problem_solving: { correctedScore: 2.5, notes: "AI score was too generous." },
          agency: { notes: "Too high" },
        }),
      );
    } finally {
      await app.close();
    }
  });

  it("rejects missing reviewer feedback fields before querying the database", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/rec_1/feedback",
        headers: { "content-type": "application/json" },
        payload: {
          sessionId: "sess_1",
          organizationId: "org_1",
          reviewerDecision: "hold",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: "sessionId, organizationId, reviewerEmail, and reviewerDecision are required",
      });
      expect(sqlCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("rejects invalid reviewer feedback decisions before querying the database", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/rec_1/feedback",
        headers: { "content-type": "application/json" },
        payload: {
          sessionId: "sess_1",
          organizationId: "org_1",
          reviewerEmail: "reviewer@example.com",
          reviewerDecision: "maybe",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "reviewerDecision is invalid" });
      expect(sqlCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("rejects non-object dimension feedback before querying the database", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/rec_1/feedback",
        headers: { "content-type": "application/json" },
        payload: {
          sessionId: "sess_1",
          organizationId: "org_1",
          reviewerEmail: "reviewer@example.com",
          reviewerDecision: "hold",
          dimensionFeedback: ["agency"],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "dimensionFeedback must be an object" });
      expect(sqlCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("rejects non-half-step reviewer scores before querying the database", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/recommendations/rec_1/feedback",
        headers: { "content-type": "application/json" },
        payload: {
          sessionId: "sess_1",
          organizationId: "org_1",
          reviewerEmail: "reviewer@example.com",
          reviewerDecision: "hold",
          dimensionFeedback: { agency: { correctedScore: 2.25 } },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: "dimensionFeedback.agency.correctedScore must be a half-step score from 1 to 4",
      });
      expect(sqlCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("rejects invalid draft counts before opening a transaction", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/profiles/profile_1/draft",
        headers: { "content-type": "application/json" },
        payload: {
          organizationId: "org_1",
          actorEmail: "reviewer@example.com",
          historicalSessionCount: -1,
          matchedApplicationCount: 10,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "historicalSessionCount must be a finite non-negative integer" });
      expect(connectMock).not.toHaveBeenCalled();
      expect(sqlCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("rejects missing organization id", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/grading/company-state",
        headers: { "content-type": "application/json" },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "organizationId is required" });
      expect(sqlCalls).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
