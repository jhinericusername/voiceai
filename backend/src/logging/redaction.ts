import type { FastifyServerOptions } from "fastify";

export const SECRET_REDACTION_CENSOR = "[REDACTED]";

export const BACKEND_SECRET_REDACTION_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["ashby-signature"]',
  "headers.authorization",
  "headers.cookie",
  'headers["ashby-signature"]',
  "body.ashbyApiKey",
  "body.webhookSecret",
  "body.signature",
  "body.rawBody",
  "payload.ashbyApiKey",
  "payload.webhookSecret",
  "payload.signature",
  "payload.rawBody",
  "ashbyApiKey",
  "webhookSecret",
  "signature",
  "rawBody",
  "authorization",
  "cookie",
  "token",
] as const;

type FastifyLoggerOptions = Exclude<FastifyServerOptions["logger"], boolean | undefined>;

export function backendLoggerOptions(): FastifyLoggerOptions {
  return {
    redact: {
      paths: [...BACKEND_SECRET_REDACTION_PATHS],
      censor: SECRET_REDACTION_CENSOR,
    },
  };
}

export function safeErrorLogFields(error: unknown): { readonly errorType: string } {
  return {
    errorType: error instanceof Error ? error.name : typeof error,
  };
}
