import { describe, expect, it } from "vitest";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  integrationSecretKeyFromEnv,
} from "../src/ashby/crypto.js";

describe("Ashby integration secret encryption", () => {
  it("round-trips encrypted secrets", () => {
    const encrypted = encryptIntegrationSecret("ashby-key", "local-secret");

    expect(encrypted).toMatch(/^v1:/);
    expect(encrypted).not.toContain("ashby-key");
    expect(decryptIntegrationSecret(encrypted, "local-secret")).toBe("ashby-key");
  });

  it("rejects the wrong secret key", () => {
    const encrypted = encryptIntegrationSecret("ashby-key", "local-secret");

    expect(() => decryptIntegrationSecret(encrypted, "other-secret")).toThrow();
  });

  it("requires a configured integration secret key", () => {
    expect(() => integrationSecretKeyFromEnv({})).toThrow(/PUDDLE_INTEGRATION_SECRET_KEY/);
    expect(() =>
      integrationSecretKeyFromEnv({ PUDDLE_INTEGRATION_SECRET_KEY: "   " }),
    ).toThrow(/PUDDLE_INTEGRATION_SECRET_KEY/);
    expect(integrationSecretKeyFromEnv({ PUDDLE_INTEGRATION_SECRET_KEY: " secret " })).toBe(
      "secret",
    );
  });
});
