import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function keyFromSecret(secret: string): Buffer {
  if (!secret.trim()) {
    throw new Error("PUDDLE_INTEGRATION_SECRET_KEY must be set");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptIntegrationSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptIntegrationSecret(encoded: string, secret: string): string {
  const [version, ivText, tagText, ciphertextText] = encoded.split(":");
  if (version !== VERSION || !ivText || !tagText || !ciphertextText) {
    throw new Error("Invalid encrypted integration secret");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyFromSecret(secret),
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function generateIntegrationSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function integrationSecretKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.PUDDLE_INTEGRATION_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error("PUDDLE_INTEGRATION_SECRET_KEY must be set");
  }
  return secret;
}
