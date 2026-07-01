import { decryptIntegrationSecret } from "./crypto.js";

export const ASHBY_SECRET_DECRYPTION_PURPOSES = {
  apiKey: ["selected-job-validation", "active-application-sync", "rubric-job-list"],
  webhookSecret: ["webhook-setup-display", "webhook-signature-verification"],
} as const;

export type AshbyApiKeyDecryptionPurpose =
  (typeof ASHBY_SECRET_DECRYPTION_PURPOSES.apiKey)[number];

export type AshbyWebhookSecretDecryptionPurpose =
  (typeof ASHBY_SECRET_DECRYPTION_PURPOSES.webhookSecret)[number];

function assertAllowedPurpose<T extends string>(
  purpose: string,
  allowed: readonly T[],
  label: string,
): asserts purpose is T {
  if (!allowed.includes(purpose as T)) {
    throw new Error(`Unsupported ${label} decrypt purpose: ${purpose}`);
  }
}

export function decryptAshbyApiKey(input: {
  readonly ciphertext: string;
  readonly secretKey: string;
  readonly purpose: AshbyApiKeyDecryptionPurpose;
}): string {
  assertAllowedPurpose(
    input.purpose,
    ASHBY_SECRET_DECRYPTION_PURPOSES.apiKey,
    "Ashby API key",
  );
  return decryptIntegrationSecret(input.ciphertext, input.secretKey);
}

export function decryptAshbyWebhookSecret(input: {
  readonly ciphertext: string;
  readonly secretKey: string;
  readonly purpose: AshbyWebhookSecretDecryptionPurpose;
}): string {
  assertAllowedPurpose(
    input.purpose,
    ASHBY_SECRET_DECRYPTION_PURPOSES.webhookSecret,
    "Ashby webhook secret",
  );
  return decryptIntegrationSecret(input.ciphertext, input.secretKey);
}
