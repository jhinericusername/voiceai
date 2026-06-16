import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDraftRubric } from "../src/grading/rubric.js";
import { buildServer } from "../src/server.js";

const { clientQueryMock, connectMock, queryMock, releaseMock, sqlCalls } = vi.hoisted(() => {
  const sqlCalls: string[] = [];
  const queryMock = vi.fn(async (sql: string) => {
    sqlCalls.push(String(sql));
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
  const clientQueryMock = vi.fn(async (sql: string) => {
    sqlCalls.push(String(sql));
    if (String(sql).includes("SELECT * FROM role_grading_profiles")) {
      return {
        rows: [{ profile_id: "profile_1", organization_id: "org_1", ashby_job_id: "job_1" }],
        rowCount: 1,
      };
    }
    if (String(sql).includes("MAX(version)")) {
      return { rows: [{ next_version: 2 }], rowCount: 1 };
    }
    if (String(sql).includes("UPDATE role_grading_profiles")) {
      return {
        rows: [{ profile_id: "profile_1", status: "recommendations_active" }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
  const releaseMock = vi.fn();
  const connectMock = vi.fn(async () => ({
    query: clientQueryMock,
    release: releaseMock,
  }));
  return { clientQueryMock, connectMock, queryMock, releaseMock, sqlCalls };
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
          dimensionFeedback: { agency: "Too high" },
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
