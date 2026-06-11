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

  it("rejects malformed webhook payloads after resolving the integration", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ integration_id: "int_1" }], rowCount: 1 });

    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/integrations/ashby/webhook",
        headers: { "content-type": "application/json" },
        payload: { integrationId: "int_1", payload: { data: {} } },
      });

      expect(res.statusCode).toBe(400);
      expect(queryMock).toHaveBeenCalledTimes(1);
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
      expect(clientQueryMock).toHaveBeenCalledTimes(4);
      expect(clientQueryMock.mock.calls[0]?.[0]).toBe("BEGIN");
      expect(String(clientQueryMock.mock.calls[1]?.[0])).toContain("pg_advisory_xact_lock");
      expect(String(clientQueryMock.mock.calls[2]?.[0])).toContain("ashby_api_key_ciphertext");
      expect(clientQueryMock.mock.calls[3]?.[0]).toBe("COMMIT");
      expect(releaseMock).toHaveBeenCalledTimes(1);
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
      });

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
      .mockResolvedValueOnce({ rows: [{ integration_id: "int_1" }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            integration_id: "int_1",
            ashby_api_key_ciphertext: encryptIntegrationSecret("ashby-key", "test-secret"),
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
