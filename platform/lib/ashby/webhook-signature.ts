import { createHmac, timingSafeEqual } from "node:crypto";

function signatureBytes(value: string): Buffer | null {
  const normalized = value.trim().replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(normalized)) {
    return null;
  }
  return Buffer.from(normalized, "hex");
}

export function ashbyWebhookDigest(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyAshbyWebhookSignature({
  body,
  secret,
  signature,
}: {
  readonly body: string;
  readonly secret: string;
  readonly signature: string | null;
}): boolean {
  if (!secret.trim() || !signature) {
    return false;
  }

  const provided = signatureBytes(signature);
  const expected = signatureBytes(ashbyWebhookDigest(body, secret));
  if (!provided || !expected || provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}
