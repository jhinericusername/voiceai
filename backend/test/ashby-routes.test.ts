import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("../src/db/pool.js", () => ({
  getPool: () => ({ query: queryMock }),
}));

const FAKE_LK = { host: "wss://example", apiKey: "key", apiSecret: "secret" };
const previousIntegrationSecret = process.env.PUDDLE_INTEGRATION_SECRET_KEY;
const previousBackendToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;

describe("Ashby backend routes", () => {
  beforeEach(() => {
    delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
  });

  afterEach(() => {
    queryMock.mockReset();
    if (previousIntegrationSecret === undefined) {
      delete process.env.PUDDLE_INTEGRATION_SECRET_KEY;
    } else {
      process.env.PUDDLE_INTEGRATION_SECRET_KEY = previousIntegrationSecret;
    }
    if (previousBackendToken === undefined) {
      delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    } else {
      process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousBackendToken;
    }
  });

  it("rejects invalid company state input", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/company-state",
        headers: { "content-type": "application/json" },
        payload: { emailDomain: "bad-domain" },
      });

      expect(res.statusCode).toBe(400);
      expect(queryMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("rejects malformed webhook payloads", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/webhook",
        headers: { "content-type": "application/json" },
        payload: { payload: { data: {} } },
      });

      expect(res.statusCode).toBe(400);
      expect(queryMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("rejects invalid score values before DB access", async () => {
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/scores",
        headers: { "content-type": "application/json" },
        payload: {
          emailDomain: "usepuddle.com",
          applicationId: "app_1",
          roleId: "role_1",
          reviewerEmail: "reviewer@usepuddle.com",
          problemSolving: 4.25,
          agency: 3,
          competitiveness: 3,
          curiosity: 3,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(queryMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("returns 409 when setup finds an identity conflict", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    queryMock.mockResolvedValueOnce({
      rows: [{ integration_id: null, identity_conflict: true }],
      rowCount: 1,
    });
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/setup",
        headers: { "content-type": "application/json" },
        payload: {
          organizationId: "org_123",
          emailDomain: "usepuddle.com",
          ashbyApiKey: "ashby-secret",
          selectedJobIds: ["job_1"],
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain("identity conflict");
      expect(queryMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("rejects webhooks when the integration cannot be resolved", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/webhook",
        headers: { "content-type": "application/json" },
        payload: {
          integrationId: "missing_int",
          payload: {
            webhookActionId: "action_1",
            action: "applicationUpdate",
            data: {},
          },
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("not configured");
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(String(queryMock.mock.calls[0]?.[0])).toContain("WHERE integration_id = $1");
    } finally {
      await app.close();
    }
  });

  it("rejects ping webhooks when the integration cannot be resolved", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/webhook",
        headers: { "content-type": "application/json" },
        payload: {
          companyDomain: "usepuddle.com",
          payload: {
            action: "ping",
            data: {},
          },
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("not configured");
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(String(queryMock.mock.calls[0]?.[0])).toContain("ashby_company_integrations");
    } finally {
      await app.close();
    }
  });

  it("reprocesses duplicate webhook events that have not been marked processed", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ integration_id: "int_1" }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ inserted: false, processed_at: null }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/webhook",
        headers: { "content-type": "application/json" },
        payload: {
          integrationId: "int_1",
          payload: {
            webhookActionId: "action_1",
            action: "applicationUpdate",
            data: {},
          },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, action: "applicationUpdate" });
      expect(queryMock).toHaveBeenCalledTimes(3);
      expect(String(queryMock.mock.calls[2]?.[0])).toContain("processed_at = now()");
    } finally {
      await app.close();
    }
  });
});
