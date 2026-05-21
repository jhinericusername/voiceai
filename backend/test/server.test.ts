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
  it("rejects an invalid platform create-session request with 400", async () => {
    const app = buildServer(FAKE_LK);
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
    await app.close();
  });
});
