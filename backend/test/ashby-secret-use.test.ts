import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encryptIntegrationSecret } from "../src/ashby/crypto.js";
import {
  ASHBY_SECRET_DECRYPTION_PURPOSES,
  decryptAshbyApiKey,
  decryptAshbyWebhookSecret,
} from "../src/ashby/secret-use.js";

describe("Ashby secret decryption purposes", () => {
  it("documents the complete allowed decrypt purpose list", () => {
    expect(ASHBY_SECRET_DECRYPTION_PURPOSES).toEqual({
      apiKey: ["selected-job-validation", "active-application-sync"],
      webhookSecret: ["webhook-setup-display", "webhook-signature-verification"],
    });
  });

  it("decrypts API keys only through an explicit purpose wrapper", () => {
    const encrypted = encryptIntegrationSecret("ashby-key", "test-secret");

    expect(
      decryptAshbyApiKey({
        ciphertext: encrypted,
        secretKey: "test-secret",
        purpose: "selected-job-validation",
      }),
    ).toBe("ashby-key");
    expect(
      decryptAshbyApiKey({
        ciphertext: encrypted,
        secretKey: "test-secret",
        purpose: "active-application-sync",
      }),
    ).toBe("ashby-key");
  });

  it("rejects unknown API key decrypt purposes at runtime", () => {
    const encrypted = encryptIntegrationSecret("ashby-key", "test-secret");

    expect(() =>
      decryptAshbyApiKey({
        ciphertext: encrypted,
        secretKey: "test-secret",
        purpose: "legacy-setup" as never,
      }),
    ).toThrow(/Unsupported Ashby API key decrypt purpose/);
  });

  it("decrypts webhook secrets only through an explicit purpose wrapper", () => {
    const encrypted = encryptIntegrationSecret("webhook-secret", "test-secret");

    expect(
      decryptAshbyWebhookSecret({
        ciphertext: encrypted,
        secretKey: "test-secret",
        purpose: "webhook-setup-display",
      }),
    ).toBe("webhook-secret");
    expect(
      decryptAshbyWebhookSecret({
        ciphertext: encrypted,
        secretKey: "test-secret",
        purpose: "webhook-signature-verification",
      }),
    ).toBe("webhook-secret");
  });

  it("rejects unknown webhook secret decrypt purposes at runtime", () => {
    const encrypted = encryptIntegrationSecret("webhook-secret", "test-secret");

    expect(() =>
      decryptAshbyWebhookSecret({
        ciphertext: encrypted,
        secretKey: "test-secret",
        purpose: "legacy-setup" as never,
      }),
    ).toThrow(/Unsupported Ashby webhook secret decrypt purpose/);
  });

  it("keeps direct decryptIntegrationSecret calls out of route handlers", () => {
    const routesSource = readFileSync(
      join(import.meta.dirname, "..", "src", "ashby", "routes.ts"),
      "utf-8",
    );

    expect(routesSource).not.toMatch(/\bdecryptIntegrationSecret\(/);
    expect(routesSource).toContain("decryptAshbyApiKey");
    expect(routesSource).toContain("decryptAshbyWebhookSecret");
  });
});
