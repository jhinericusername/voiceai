import "server-only";

export function backendBaseUrl(): string {
  return (process.env.PUDDLE_BACKEND_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
}

export function backendHeaders(contentType = "application/json"): HeadersInit {
  const headers: Record<string, string> = { "content-type": contentType };
  const token = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN?.trim();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}
