import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptIntegrationSecret } from "../src/ashby/crypto.js";
import { ashbyWebhookDigest } from "../src/ashby/webhook-signature.js";
import { buildServer } from "../src/server.js";

const { clientQueryMock, connectMock, queryMock, releaseMock } = vi.hoisted(() => {
  const clientQueryMock = vi.fn();
  const releaseMock = vi.fn();
  const connectMock = vi.fn(async () => ({
    query: clientQueryMock,
    release: releaseMock,
  }));
  return {
    clientQueryMock,
    connectMock,
    queryMock: vi.fn(),
    releaseMock,
  };
});

vi.mock("../src/db/pool.js", () => ({
  getPool: () => ({ connect: connectMock, query: queryMock }),
}));

const FAKE_LK = { host: "wss://example", apiKey: "key", apiSecret: "secret" };
const previousIntegrationSecret = process.env.PUDDLE_INTEGRATION_SECRET_KEY;
const previousBackendToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;

describe("Ashby backend routes", () => {
  beforeEach(() => {
    delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
  });

  afterEach(() => {
    clientQueryMock.mockReset();
    connectMock.mockClear();
    queryMock.mockReset();
    releaseMock.mockClear();
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

  it("returns the full Ashby company-state contract for configured integrations", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          integration_id: "int_1",
          email_domain: "usepuddle.com",
          selected_job_ids: ["job_1", "job_2"],
          ashby_webhook_secret_ciphertext: "encrypted-webhook",
          connected_at: "2026-06-10T14:00:00.000Z",
          last_ping_at: "2026-06-10T14:05:00.000Z",
          last_sync_at: "2026-06-10T14:10:00.000Z",
          setup_status: "connected",
        },
      ],
      rowCount: 1,
    });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/company-state",
        headers: { "content-type": "application/json" },
        payload: { emailDomain: "usepuddle.com", organizationId: null },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        connected: true,
        setupStatus: "connected",
        integrationId: "int_1",
        emailDomain: "usepuddle.com",
        selectedJobIds: ["job_1", "job_2"],
        lastPingAt: "2026-06-10T14:05:00.000Z",
        lastSyncAt: "2026-06-10T14:10:00.000Z",
        webhookUrlPath: "/api/ashby/webhook?integrationId=int_1",
      });
    } finally {
      await app.close();
    }
  });

  it("does not report migrated connected integrations complete when webhook secret is missing", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          integration_id: "int_1",
          email_domain: "usepuddle.com",
          selected_job_ids: ["job_1"],
          ashby_webhook_secret_ciphertext: null,
          connected_at: "2026-06-10T14:00:00.000Z",
          last_ping_at: "2026-06-10T14:05:00.000Z",
          last_sync_at: "2026-06-10T14:10:00.000Z",
          setup_status: "connected",
        },
      ],
      rowCount: 1,
    });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/company-state",
        headers: { "content-type": "application/json" },
        payload: { emailDomain: "usepuddle.com", organizationId: null },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        connected: false,
        setupStatus: "job_selection_pending",
        lastPingAt: null,
        lastSyncAt: null,
      });
    } finally {
      await app.close();
    }
  });

  it("returns non-connected Ashby company-state defaults when no integration exists", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/company-state",
        headers: { "content-type": "application/json" },
        payload: { emailDomain: "usepuddle.com", organizationId: null },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        connected: false,
        setupStatus: "job_selection_pending",
        integrationId: null,
        emailDomain: "usepuddle.com",
        selectedJobIds: [],
        lastPingAt: null,
        lastSyncAt: null,
        webhookUrlPath: null,
      });
    } finally {
      await app.close();
    }
  });

  it("rejects webhook envelopes without signed raw bodies after resolving the integration", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ integration_id: "int_1" }], rowCount: 1 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/webhook",
        headers: { "content-type": "application/json" },
        payload: { integrationId: "int_1", payload: { data: {} } },
      });

      expect(res.statusCode).toBe(401);
      expect(queryMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("rejects parsed-only ping payloads without marking setup connected", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ integration_id: "int_1" }], rowCount: 1 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/webhook",
        headers: { "content-type": "application/json" },
        payload: {
          integrationId: "int_1",
          payload: { action: "ping", data: { webhookId: "hook_1" } },
        },
      });

      expect(res.statusCode).toBe(401);
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(String(queryMock.mock.calls[0]?.[0])).not.toContain("setup_status = 'connected'");
    } finally {
      await app.close();
    }
  });

  it("rejects Ashby webhooks with invalid per-company signatures before parsing JSON", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          integration_id: "int_1",
          ashby_webhook_secret_ciphertext: encryptIntegrationSecret(
            "webhook-secret",
            "test-secret",
          ),
        },
      ],
      rowCount: 1,
    });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/webhook",
        headers: { "content-type": "application/json" },
        payload: {
          integrationId: "int_1",
          rawBody: "{not json",
          signature: "sha256=0000000000000000000000000000000000000000000000000000000000000000",
        },
      });

      expect(res.statusCode).toBe(401);
      expect(queryMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("marks setup connected when a signed ping is received", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    const rawBody = JSON.stringify({ action: "ping", data: { webhookId: "hook_1" } });
    const signature = `sha256=${ashbyWebhookDigest(rawBody, "webhook-secret")}`;
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            integration_id: "int_1",
            ashby_webhook_secret_ciphertext: encryptIntegrationSecret(
              "webhook-secret",
              "test-secret",
            ),
          },
        ],
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
          rawBody,
          signature,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(String(queryMock.mock.calls[1]?.[0])).toContain("setup_status = 'connected'");
    } finally {
      await app.close();
    }
  });

  it("ignores signed application updates while setup is pending without writing application rows", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    const rawBody = JSON.stringify({
      webhookActionId: "action_pending",
      action: "applicationUpdate",
      data: {
        application: {
          id: "app_1",
          candidate: {
            id: "cand_1",
            name: "Maya Chen",
            primaryEmailAddress: "maya@example.com",
          },
          jobId: "job_1",
          status: "Active",
          updatedAt: "2026-06-10T14:20:00.000Z",
        },
      },
    });
    const signature = `sha256=${ashbyWebhookDigest(rawBody, "webhook-secret")}`;
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          integration_id: "int_1",
          ashby_webhook_secret_ciphertext: encryptIntegrationSecret(
            "webhook-secret",
            "test-secret",
          ),
        },
      ],
      rowCount: 1,
    });
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          {
            integration_id: "int_1",
            selected_job_ids: ["job_1"],
            setup_status: "pending_webhook",
            connected_at: null,
            last_ping_at: null,
            last_sync_at: null,
            ashby_webhook_secret_ciphertext: encryptIntegrationSecret(
              "webhook-secret",
              "test-secret",
            ),
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/webhook",
        headers: { "content-type": "application/json" },
        payload: {
          integrationId: "int_1",
          rawBody,
          signature,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, ignored: true, action: "applicationUpdate" });
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(clientQueryMock).toHaveBeenCalledTimes(3);
      expect(clientQueryMock.mock.calls[0]?.[0]).toBe("BEGIN");
      expect(String(clientQueryMock.mock.calls[1]?.[0])).toContain("FOR UPDATE");
      expect(clientQueryMock.mock.calls[2]?.[0]).toBe("COMMIT");
      const clientSql = clientQueryMock.mock.calls.map((call) => String(call[0])).join("\n");
      expect(clientSql).not.toContain("INSERT INTO ashby_webhook_events");
      expect(clientSql).not.toContain("INSERT INTO ashby_applications");
      expect(clientSql).not.toContain("processed_at = now()");
      expect(releaseMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("processes ready signed application updates after locking the integration row", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    const rawBody = JSON.stringify({
      webhookActionId: "action_ready",
      action: "applicationUpdate",
      data: {
        application: {
          id: "app_1",
          candidate: {
            id: "cand_1",
            name: "Maya Chen",
            primaryEmailAddress: "maya@example.com",
          },
          jobId: "job_1",
          status: "Active",
          updatedAt: "2026-06-10T14:20:00.000Z",
        },
      },
    });
    const signature = `sha256=${ashbyWebhookDigest(rawBody, "webhook-secret")}`;
    const readyIntegration = {
      integration_id: "int_1",
      selected_job_ids: ["job_1"],
      setup_status: "connected",
      connected_at: "2026-06-10T14:05:00.000Z",
      last_ping_at: "2026-06-10T14:05:00.000Z",
      last_sync_at: "2026-06-10T14:10:00.000Z",
      ashby_webhook_secret_ciphertext: encryptIntegrationSecret(
        "webhook-secret",
        "test-secret",
      ),
    };
    queryMock.mockResolvedValueOnce({
      rows: [readyIntegration],
      rowCount: 1,
    });
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [readyIntegration], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ inserted: true, processed_at: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/webhook",
        headers: { "content-type": "application/json" },
        payload: {
          integrationId: "int_1",
          rawBody,
          signature,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, action: "applicationUpdate" });
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(clientQueryMock).toHaveBeenCalledTimes(6);
      expect(clientQueryMock.mock.calls[0]?.[0]).toBe("BEGIN");
      expect(String(clientQueryMock.mock.calls[1]?.[0])).toContain("FOR UPDATE");
      expect(String(clientQueryMock.mock.calls[2]?.[0])).toContain("INSERT INTO ashby_webhook_events");
      expect(String(clientQueryMock.mock.calls[3]?.[0])).toContain("INSERT INTO ashby_applications");
      expect(clientQueryMock.mock.calls[3]?.[1]?.[0]).toBe("app_1");
      expect(String(clientQueryMock.mock.calls[4]?.[0])).toContain("processed_at = now()");
      expect(clientQueryMock.mock.calls[5]?.[0]).toBe("COMMIT");
      expect(releaseMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("marks ready signed application updates for unselected jobs processed without writing application rows", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    const rawBody = JSON.stringify({
      webhookActionId: "action_unselected_job",
      action: "applicationUpdate",
      data: {
        application: {
          id: "app_2",
          candidate: {
            id: "cand_2",
            name: "Jon Bell",
            primaryEmailAddress: "jon@example.com",
          },
          jobId: "job_2",
          status: "Active",
          updatedAt: "2026-06-10T14:25:00.000Z",
        },
      },
    });
    const signature = `sha256=${ashbyWebhookDigest(rawBody, "webhook-secret")}`;
    const readyIntegration = {
      integration_id: "int_1",
      selected_job_ids: ["job_1"],
      setup_status: "connected",
      connected_at: "2026-06-10T14:05:00.000Z",
      last_ping_at: "2026-06-10T14:05:00.000Z",
      last_sync_at: "2026-06-10T14:10:00.000Z",
      ashby_webhook_secret_ciphertext: encryptIntegrationSecret(
        "webhook-secret",
        "test-secret",
      ),
    };
    queryMock.mockResolvedValueOnce({
      rows: [readyIntegration],
      rowCount: 1,
    });
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [readyIntegration], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ inserted: true, processed_at: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/webhook",
        headers: { "content-type": "application/json" },
        payload: {
          integrationId: "int_1",
          rawBody,
          signature,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, action: "applicationUpdate" });
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(clientQueryMock).toHaveBeenCalledTimes(5);
      expect(clientQueryMock.mock.calls[0]?.[0]).toBe("BEGIN");
      expect(String(clientQueryMock.mock.calls[1]?.[0])).toContain("FOR UPDATE");
      expect(String(clientQueryMock.mock.calls[2]?.[0])).toContain("INSERT INTO ashby_webhook_events");
      expect(String(clientQueryMock.mock.calls[3]?.[0])).toContain("processed_at = now()");
      expect(clientQueryMock.mock.calls[4]?.[0]).toBe("COMMIT");
      const clientSql = clientQueryMock.mock.calls.map((call) => String(call[0])).join("\n");
      expect(clientSql).not.toContain("INSERT INTO ashby_applications");
      expect(releaseMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("verifies signed Ashby webhooks using the exact whitespace-preserving raw body", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    const rawBody = ` \n${JSON.stringify({ action: "ping", data: { webhookId: "hook_1" } })}\n `;
    const signature = `sha256=${ashbyWebhookDigest(rawBody, "webhook-secret")}`;
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            integration_id: "int_1",
            ashby_webhook_secret_ciphertext: encryptIntegrationSecret(
              "webhook-secret",
              "test-secret",
            ),
          },
        ],
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
          rawBody,
          signature,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(String(queryMock.mock.calls[1]?.[0])).toContain("setup_status = 'connected'");
    } finally {
      await app.close();
    }
  });

  it("rejects raw Ashby webhooks with missing signatures instead of using parsed payload fallback", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          integration_id: "int_1",
          ashby_webhook_secret_ciphertext: encryptIntegrationSecret(
            "webhook-secret",
            "test-secret",
          ),
        },
      ],
      rowCount: 1,
    });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/webhook",
        headers: { "content-type": "application/json" },
        payload: {
          integrationId: "int_1",
          rawBody: "   ",
          payload: { action: "ping", data: { webhookId: "hook_1" } },
        },
      });

      expect(res.statusCode).toBe(401);
      expect(queryMock).toHaveBeenCalledTimes(1);
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
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{ integration_id: null, identity_conflict: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
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
      expect(queryMock).not.toHaveBeenCalled();
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(clientQueryMock).toHaveBeenCalledTimes(3);
      expect(clientQueryMock.mock.calls[0]?.[0]).toBe("BEGIN");
      expect(String(clientQueryMock.mock.calls[1]?.[0])).toContain("ashby_api_key_ciphertext");
      expect(clientQueryMock.mock.calls[2]?.[0]).toBe("ROLLBACK");
      expect(releaseMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("onboards an Ashby API key and returns jobs without leaking the API key", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    const previousFetch = global.fetch;
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          results: [{ id: "job_1", name: "Founding Engineer", status: "Open" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          {
            integration_id: "int_1",
            ashby_webhook_secret_ciphertext: "encrypted-webhook",
            identity_conflict: false,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/onboarding/api-key",
        headers: { "content-type": "application/json" },
        payload: {
          emailDomain: "usepuddle.com",
          organizationId: null,
          reviewerEmail: "admin@usepuddle.com",
          ashbyApiKey: "ashby-secret",
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({
        integrationId: "int_1",
        emailDomain: "usepuddle.com",
        setupStatus: "job_selection_pending",
        jobs: [{ id: "job_1", name: "Founding Engineer", status: "Open" }],
      });
      expect(JSON.stringify(res.json())).not.toContain("ashby-secret");
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(queryMock).not.toHaveBeenCalled();
      expect(clientQueryMock).toHaveBeenCalledTimes(5);
      expect(clientQueryMock.mock.calls[0]?.[0]).toBe("BEGIN");
      expect(String(clientQueryMock.mock.calls[1]?.[0])).toContain("pg_advisory_xact_lock");
      expect(String(clientQueryMock.mock.calls[2]?.[0])).toContain("ashby_api_key_ciphertext");
      expect(String(clientQueryMock.mock.calls[3]?.[0])).toContain("UPDATE ashby_applications");
      expect(String(clientQueryMock.mock.calls[3]?.[0])).toContain("status = $2");
      expect(clientQueryMock.mock.calls[3]?.[1]).toEqual(["int_1", "Stale"]);
      expect(clientQueryMock.mock.calls[4]?.[0]).toBe("COMMIT");
      expect(releaseMock).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = previousFetch;
      await app.close();
    }
  });

  it("rejects API key onboarding without storing the key when Ashby returns no jobs", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    const previousFetch = global.fetch;
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/onboarding/api-key",
        headers: { "content-type": "application/json" },
        payload: {
          emailDomain: "usepuddle.com",
          organizationId: null,
          reviewerEmail: "admin@usepuddle.com",
          ashbyApiKey: "ashby-secret",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: "No Ashby jobs were returned. Confirm this API key can read Ashby jobs, then try again.",
      });
      expect(connectMock).not.toHaveBeenCalled();
      expect(queryMock).not.toHaveBeenCalled();
      expect(clientQueryMock).not.toHaveBeenCalled();
      expect(releaseMock).not.toHaveBeenCalled();
    } finally {
      global.fetch = previousFetch;
      await app.close();
    }
  });

  it("rolls back and releases the checked-out client when API key onboarding storage fails", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    const previousFetch = global.fetch;
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          results: [{ id: "job_1", name: "Founding Engineer", status: "Open" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockRejectedValueOnce(new Error("lock failed"))
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/onboarding/api-key",
        headers: { "content-type": "application/json" },
        payload: {
          emailDomain: "usepuddle.com",
          organizationId: null,
          reviewerEmail: "admin@usepuddle.com",
          ashbyApiKey: "ashby-secret",
        },
      });

      expect(res.statusCode).toBe(500);
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(queryMock).not.toHaveBeenCalled();
      expect(clientQueryMock).toHaveBeenCalledTimes(3);
      expect(clientQueryMock.mock.calls[0]?.[0]).toBe("BEGIN");
      expect(String(clientQueryMock.mock.calls[1]?.[0])).toContain("pg_advisory_xact_lock");
      expect(clientQueryMock.mock.calls[2]?.[0]).toBe("ROLLBACK");
      expect(releaseMock).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = previousFetch;
      await app.close();
    }
  });

  it("stores selected jobs and returns webhook setup values", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    const decryptedWebhookSecret = "webhook-secret";
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          integration_id: "int_1",
          email_domain: "usepuddle.com",
          ashby_webhook_secret_ciphertext: "encrypted-webhook",
        },
      ],
      rowCount: 1,
    });
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          {
            integration_id: "int_1",
            email_domain: "usepuddle.com",
            ashby_webhook_secret_ciphertext: encryptIntegrationSecret(
              decryptedWebhookSecret,
              "test-secret",
            ),
            selected_job_ids: ["job_1"],
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/onboarding/jobs",
        headers: { "content-type": "application/json" },
        payload: {
          emailDomain: "usepuddle.com",
          organizationId: null,
          reviewerEmail: "admin@usepuddle.com",
          selectedJobIds: ["job_1"],
          publicBaseUrl: "https://app.usepuddle.com",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        integrationId: "int_1",
        webhookUrl: "https://app.usepuddle.com/api/ashby/webhook?integrationId=int_1",
        webhookSecret: decryptedWebhookSecret,
        requiredEvents: [
          "ping",
          "applicationSubmit",
          "applicationUpdate",
          "candidateStageChange",
          "candidateDelete",
          "candidateMerge",
          "candidateHire",
        ],
      });
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(clientQueryMock).toHaveBeenCalledTimes(4);
      expect(clientQueryMock.mock.calls[0]?.[0]).toBe("BEGIN");
      expect(String(clientQueryMock.mock.calls[1]?.[0])).toContain("selected_job_ids = $2");
      expect(String(clientQueryMock.mock.calls[2]?.[0])).toContain("UPDATE ashby_applications");
      expect(clientQueryMock.mock.calls[2]?.[1]).toEqual(["int_1", "Stale"]);
      expect(clientQueryMock.mock.calls[3]?.[0]).toBe("COMMIT");
      expect(releaseMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("rolls back selected job reconfiguration when staling active applications fails", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    const encryptedWebhookSecret = encryptIntegrationSecret("webhook-secret", "test-secret");
    const updatedIntegration = {
      integration_id: "int_1",
      email_domain: "usepuddle.com",
      ashby_webhook_secret_ciphertext: encryptedWebhookSecret,
      selected_job_ids: ["job_1"],
    };
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            integration_id: "int_1",
            email_domain: "usepuddle.com",
            ashby_webhook_secret_ciphertext: "encrypted-webhook",
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [updatedIntegration], rowCount: 1 })
      .mockRejectedValueOnce(new Error("stale failed"));
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [updatedIntegration], rowCount: 1 })
      .mockRejectedValueOnce(new Error("stale failed"))
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/onboarding/jobs",
        headers: { "content-type": "application/json" },
        payload: {
          emailDomain: "usepuddle.com",
          organizationId: null,
          reviewerEmail: "admin@usepuddle.com",
          selectedJobIds: ["job_1"],
          publicBaseUrl: "https://app.usepuddle.com",
        },
      });

      expect(res.statusCode).toBe(500);
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(clientQueryMock).toHaveBeenCalledTimes(4);
      expect(clientQueryMock.mock.calls[0]?.[0]).toBe("BEGIN");
      expect(String(clientQueryMock.mock.calls[1]?.[0])).toContain("selected_job_ids = $2");
      expect(String(clientQueryMock.mock.calls[2]?.[0])).toContain("UPDATE ashby_applications");
      expect(clientQueryMock.mock.calls[2]?.[1]).toEqual(["int_1", "Stale"]);
      expect(clientQueryMock.mock.calls[3]?.[0]).toBe("ROLLBACK");
      expect(releaseMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("stores legacy setup values and marks stale active applications during reconfiguration", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{ integration_id: "int_1", identity_conflict: false }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

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

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({
        integrationId: "int_1",
        emailDomain: "usepuddle.com",
        selectedJobIds: ["job_1"],
      });
      expect(queryMock).not.toHaveBeenCalled();
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(clientQueryMock).toHaveBeenCalledTimes(4);
      expect(clientQueryMock.mock.calls[0]?.[0]).toBe("BEGIN");
      expect(String(clientQueryMock.mock.calls[1]?.[0])).toContain("ashby_api_key_ciphertext");
      expect(String(clientQueryMock.mock.calls[2]?.[0])).toContain("UPDATE ashby_applications");
      expect(clientQueryMock.mock.calls[2]?.[1]).toEqual(["int_1", "Stale"]);
      expect(clientQueryMock.mock.calls[3]?.[0]).toBe("COMMIT");
      expect(releaseMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("rolls back legacy setup when staling active applications fails", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    queryMock
      .mockResolvedValueOnce({
        rows: [{ integration_id: "int_1", identity_conflict: false }],
        rowCount: 1,
      })
      .mockRejectedValueOnce(new Error("stale failed"));
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{ integration_id: "int_1", identity_conflict: false }],
        rowCount: 1,
      })
      .mockRejectedValueOnce(new Error("stale failed"))
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

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

      expect(res.statusCode).toBe(500);
      expect(queryMock).not.toHaveBeenCalled();
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(clientQueryMock).toHaveBeenCalledTimes(4);
      expect(clientQueryMock.mock.calls[0]?.[0]).toBe("BEGIN");
      expect(String(clientQueryMock.mock.calls[1]?.[0])).toContain("ashby_api_key_ciphertext");
      expect(String(clientQueryMock.mock.calls[2]?.[0])).toContain("UPDATE ashby_applications");
      expect(clientQueryMock.mock.calls[2]?.[1]).toEqual(["int_1", "Stale"]);
      expect(clientQueryMock.mock.calls[3]?.[0]).toBe("ROLLBACK");
      expect(releaseMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("rejects invalid job selection input before DB access", async () => {
    const cases = [
      {
        name: "invalid emailDomain",
        payload: {
          emailDomain: "bad-domain",
          organizationId: null,
          reviewerEmail: "admin@usepuddle.com",
          selectedJobIds: ["job_1"],
          publicBaseUrl: "https://app.usepuddle.com",
        },
      },
      {
        name: "missing publicBaseUrl",
        payload: {
          emailDomain: "usepuddle.com",
          organizationId: null,
          reviewerEmail: "admin@usepuddle.com",
          selectedJobIds: ["job_1"],
        },
      },
      {
        name: "invalid local protocol",
        payload: {
          emailDomain: "usepuddle.com",
          organizationId: null,
          reviewerEmail: "admin@usepuddle.com",
          selectedJobIds: ["job_1"],
          publicBaseUrl: "ftp://localhost",
        },
      },
      {
        name: "missing selected jobs",
        payload: {
          emailDomain: "usepuddle.com",
          organizationId: null,
          reviewerEmail: "admin@usepuddle.com",
          selectedJobIds: [],
          publicBaseUrl: "https://app.usepuddle.com",
        },
      },
      {
        name: "missing reviewer",
        payload: {
          emailDomain: "usepuddle.com",
          organizationId: null,
          selectedJobIds: ["job_1"],
          publicBaseUrl: "https://app.usepuddle.com",
        },
      },
    ];

    const app = buildServer(FAKE_LK);
    try {
      for (const testCase of cases) {
        queryMock.mockClear();
        connectMock.mockClear();
        clientQueryMock.mockClear();

        const res = await app.inject({
          method: "POST",
          url: "/integrations/ashby/onboarding/jobs",
          headers: { "content-type": "application/json" },
          payload: testCase.payload,
        });

        expect(res.statusCode, testCase.name).toBe(400);
        expect(queryMock, testCase.name).not.toHaveBeenCalled();
        expect(connectMock, testCase.name).not.toHaveBeenCalled();
        expect(clientQueryMock, testCase.name).not.toHaveBeenCalled();
      }
    } finally {
      await app.close();
    }
  });

  it("marks Ashby integrations synced after syncing active applications", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    const previousFetch = global.fetch;
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            integration_id: "int_1",
            connected_at: "2026-06-10T14:05:00.000Z",
            last_ping_at: "2026-06-10T14:05:00.000Z",
            setup_status: "connected",
            ashby_webhook_secret_ciphertext: encryptIntegrationSecret(
              "webhook-secret",
              "test-secret",
            ),
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            integration_id: "int_1",
            ashby_api_key_ciphertext: encryptIntegrationSecret("ashby-key", "test-secret"),
            ashby_webhook_secret_ciphertext: encryptIntegrationSecret("webhook-secret", "test-secret"),
            selected_job_ids: ["job_1"],
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/sync-active-applications",
        headers: { "content-type": "application/json" },
        payload: {
          emailDomain: "usepuddle.com",
          organizationId: null,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, syncedCount: 0 });
      expect(queryMock).toHaveBeenCalledTimes(3);
      expect(String(queryMock.mock.calls[2]?.[0])).toContain("last_sync_at = now()");
    } finally {
      global.fetch = previousFetch;
      await app.close();
    }
  });

  it("rejects active application sync before webhook ping is verified", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    const previousFetch = global.fetch;
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    queryMock.mockResolvedValueOnce({ rows: [{ integration_id: "int_1", connected_at: null }], rowCount: 1 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/sync-active-applications",
        headers: { "content-type": "application/json" },
        payload: {
          emailDomain: "usepuddle.com",
          organizationId: null,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain("webhook ping");
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(String(queryMock.mock.calls[0]?.[0])).toContain("ashby_company_integrations");
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = previousFetch;
      await app.close();
    }
  });

  it("rejects active application sync when a migrated row is missing the webhook secret", async () => {
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    const previousFetch = global.fetch;
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          integration_id: "int_1",
          connected_at: "2026-06-10T14:05:00.000Z",
          last_ping_at: "2026-06-10T14:05:00.000Z",
          setup_status: "connected",
          ashby_webhook_secret_ciphertext: null,
        },
      ],
      rowCount: 1,
    });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/sync-active-applications",
        headers: { "content-type": "application/json" },
        payload: {
          emailDomain: "usepuddle.com",
          organizationId: null,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain("webhook ping");
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = previousFetch;
      await app.close();
    }
  });

  it("rejects application search until the integration is connected, verified, synced, and has a webhook secret", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            integration_id: "int_1",
            connected_at: "2026-06-10T14:05:00.000Z",
            last_ping_at: "2026-06-10T14:05:00.000Z",
            last_sync_at: null,
            setup_status: "connected",
            ashby_webhook_secret_ciphertext: "encrypted-webhook",
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ application_id: "app_1" }], rowCount: 1 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/applications/search",
        headers: { "content-type": "application/json" },
        payload: {
          emailDomain: "usepuddle.com",
          organizationId: null,
          query: "maya",
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain("setup is not complete");
      expect(queryMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("rejects score writes while an integration is pending reconfiguration", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            integration_id: "int_1",
            connected_at: null,
            last_ping_at: null,
            last_sync_at: null,
            setup_status: "pending_webhook",
            ashby_webhook_secret_ciphertext: "encrypted-webhook",
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ score_id: "score_1", total_score: 12 }], rowCount: 1 });

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
          problemSolving: 3,
          agency: 3,
          competitiveness: 3,
          curiosity: 3,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain("setup is not complete");
      expect(queryMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("rejects recent screens until the integration is fully synced and has a webhook secret", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            integration_id: "int_1",
            connected_at: "2026-06-10T14:05:00.000Z",
            last_ping_at: "2026-06-10T14:05:00.000Z",
            last_sync_at: "2026-06-10T14:10:00.000Z",
            setup_status: "connected",
            ashby_webhook_secret_ciphertext: null,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ score_id: "score_1" }], rowCount: 1 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/recent-screens",
        headers: { "content-type": "application/json" },
        payload: {
          emailDomain: "usepuddle.com",
          organizationId: null,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toContain("setup is not complete");
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
    process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
    const rawBody = JSON.stringify({
      webhookActionId: "action_1",
      action: "applicationUpdate",
      data: {},
    });
    const signature = `sha256=${ashbyWebhookDigest(rawBody, "webhook-secret")}`;
    const readyIntegration = {
      integration_id: "int_1",
      connected_at: "2026-06-10T14:05:00.000Z",
      last_ping_at: "2026-06-10T14:05:00.000Z",
      last_sync_at: "2026-06-10T14:10:00.000Z",
      setup_status: "connected",
      ashby_webhook_secret_ciphertext: encryptIntegrationSecret(
        "webhook-secret",
        "test-secret",
      ),
    };
    queryMock.mockResolvedValueOnce({
      rows: [readyIntegration],
      rowCount: 1,
    });
    clientQueryMock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [readyIntegration], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ inserted: false, processed_at: null }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/webhook",
        headers: { "content-type": "application/json" },
        payload: {
          integrationId: "int_1",
          rawBody,
          signature,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, action: "applicationUpdate" });
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(clientQueryMock).toHaveBeenCalledTimes(5);
      expect(clientQueryMock.mock.calls[0]?.[0]).toBe("BEGIN");
      expect(String(clientQueryMock.mock.calls[1]?.[0])).toContain("FOR UPDATE");
      expect(String(clientQueryMock.mock.calls[2]?.[0])).toContain("INSERT INTO ashby_webhook_events");
      expect(String(clientQueryMock.mock.calls[3]?.[0])).toContain("processed_at = now()");
      expect(clientQueryMock.mock.calls[4]?.[0]).toBe("COMMIT");
      expect(releaseMock).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
