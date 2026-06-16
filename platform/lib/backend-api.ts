import "server-only";

const DEFAULT_BACKEND_BASE_URL = "http://localhost:8080";

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production";
}

export function backendBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const rawBaseUrl = (env.PUDDLE_BACKEND_BASE_URL ?? DEFAULT_BACKEND_BASE_URL).trim();
  return new URL(rawBaseUrl).toString().replace(/\/$/, "");
}

export function backendHeaders(
  contentType = "application/json",
  env: NodeJS.ProcessEnv = process.env,
): HeadersInit {
  const headers: Record<string, string> = { "content-type": contentType };
  const token = env.PUDDLE_BACKEND_INTERNAL_TOKEN?.trim();
  if (!token && isProduction(env)) {
    throw new Error("PUDDLE_BACKEND_INTERNAL_TOKEN must be set in production");
  }

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}
