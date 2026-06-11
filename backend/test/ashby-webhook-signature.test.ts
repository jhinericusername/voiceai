import { describe, expect, it } from "vitest";
import { ashbyWebhookDigest, verifyAshbyWebhookSignature } from "../src/ashby/webhook-signature.js";

describe("Ashby webhook signature verification", () => {
  it("verifies sha256 signatures over the raw body", () => {
    const body = JSON.stringify({ action: "ping", data: { id: "hook_1" } });
    const secret = "webhook-secret";
    const signature = `sha256=${ashbyWebhookDigest(body, secret)}`;

    expect(verifyAshbyWebhookSignature({ body, secret, signature })).toBe(true);
  });

  it("rejects missing, malformed, or mismatched signatures", () => {
    const body = JSON.stringify({ action: "ping" });
    expect(verifyAshbyWebhookSignature({ body, secret: "secret", signature: null })).toBe(false);
    expect(verifyAshbyWebhookSignature({ body, secret: "secret", signature: "bad" })).toBe(false);
    expect(
      verifyAshbyWebhookSignature({
        body,
        secret: "secret",
        signature: `sha256=${ashbyWebhookDigest(body, "other-secret")}`,
      }),
    ).toBe(false);
  });
});
