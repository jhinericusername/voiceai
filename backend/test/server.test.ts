import { describe, it, expect } from "vitest";
import { buildServer, liveKitConfigFromEnv } from "../src/server.js";

const FAKE_LK = { host: "wss://example", apiKey: "key", apiSecret: "secret" };

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
});
