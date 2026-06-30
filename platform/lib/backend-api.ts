import "server-only";

const DEFAULT_BACKEND_BASE_URL = "http://localhost:8080";
export const DEFAULT_BACKEND_FETCH_TIMEOUT_MS = 15_000;

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production";
}

function backendFetchTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const rawTimeout = env.PUDDLE_BACKEND_FETCH_TIMEOUT_MS?.trim();
  if (!rawTimeout) {
    return DEFAULT_BACKEND_FETCH_TIMEOUT_MS;
  }

  const parsedTimeoutMs = Number(rawTimeout);
  if (!Number.isFinite(parsedTimeoutMs) || parsedTimeoutMs <= 0) {
    return DEFAULT_BACKEND_FETCH_TIMEOUT_MS;
  }

  const timeoutMs = Math.floor(parsedTimeoutMs);
  if (timeoutMs <= 0) {
    return DEFAULT_BACKEND_FETCH_TIMEOUT_MS;
  }

  return timeoutMs;
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

export async function backendFetch(
  input: string | URL,
  init: RequestInit = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  const timeoutMs = backendFetchTimeoutMs(env);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;

  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (timeoutSignal.aborted) {
      throw new Error(`Backend request timed out after ${timeoutMs}ms`, { cause: error });
    }
    throw error;
  }
}
