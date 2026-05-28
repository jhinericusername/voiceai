import { createHash, randomBytes } from "node:crypto";

const INVITE_TOKEN_BYTES = 32;

export function generateInviteToken(): string {
  return `inv_${randomBytes(INVITE_TOKEN_BYTES).toString("base64url")}`;
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
