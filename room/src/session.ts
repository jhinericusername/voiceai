export interface JoinDetails {
  readonly sessionId: string;
  readonly room: string;
  readonly token: string;
  readonly wsUrl: string;
}

// Validates and narrows a backend create-session response into JoinDetails.
export function parseSessionResponse(body: unknown): JoinDetails {
  const b = body as Record<string, unknown>;
  for (const field of ["sessionId", "room", "token", "wsUrl"] as const) {
    if (typeof b[field] !== "string" || !b[field]) {
      throw new Error(`create-session response missing field: ${field}`);
    }
  }
  return {
    sessionId: b.sessionId as string,
    room: b.room as string,
    token: b.token as string,
    wsUrl: b.wsUrl as string,
  };
}

// Calls the backend to create a session and returns the join details.
export async function createSession(
  backendUrl: string,
  input: {
    orgId: string;
    candidateEmail: string;
    scriptVersion: string;
    scheduledAt: string;
  },
): Promise<JoinDetails> {
  const res = await fetch(`${backendUrl}/integration/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`create-session failed: ${res.status}`);
  }
  return parseSessionResponse(await res.json());
}
