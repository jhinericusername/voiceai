function backendBaseUrl(): string {
  return (process.env.PUDDLE_BACKEND_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
}

function backendHeaders(): HeadersInit {
  const token = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export function dashboardDemoFallbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PUDDLE_DASHBOARD_DEMO_FALLBACK === "true" || env.NODE_ENV !== "production";
}

export function dashboardOrgId(input: {
  readonly organizationId?: string | null;
  readonly userId: string;
}): string {
  return input.organizationId ?? `workos-user:${input.userId}`;
}

export interface RealInterviewListItem {
  readonly session_id: string;
  readonly org_id: string;
  readonly candidate_email: string;
  readonly script_version: string;
  readonly status: string;
  readonly room_name: string | null;
  readonly scheduled_at: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly recording_status: string | null;
  readonly egress_id: string | null;
  readonly category_scores: unknown;
  readonly meets_bare_minimum: boolean | null;
  readonly integrity_flags: unknown;
  readonly reviewer_email: string | null;
  readonly signed_off_at: string | null;
}

export interface RealInterviewDetail extends RealInterviewListItem {
  readonly error_message: string | null;
  readonly artifacts: readonly {
    readonly kind: string;
    readonly status: string;
    readonly storagePath: string;
    readonly contentType: string;
    readonly sizeBytes: number | null;
    readonly durationSeconds: number | null;
  }[];
  readonly transcript_turns: readonly {
    readonly turnIndex: number;
    readonly speaker: "agent" | "candidate";
    readonly questionId: string | null;
    readonly text: string;
    readonly occurredAt: string;
    readonly offsetMs: number | null;
  }[];
  readonly compositeVideoUrl: string | null;
}

export async function getRealInterviews(input: {
  readonly orgId: string;
}): Promise<readonly RealInterviewListItem[]> {
  const params = new URLSearchParams({ orgId: input.orgId });
  const response = await fetch(`${backendBaseUrl()}/internal/interviews?${params}`, {
    headers: backendHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`backend returned ${response.status}`);
  }

  const payload = (await response.json()) as {
    readonly interviews?: readonly RealInterviewListItem[];
  };
  return payload.interviews ?? [];
}

export async function getRealInterview(
  sessionId: string,
  input: {
    readonly orgId: string;
  },
): Promise<RealInterviewDetail | null> {
  const params = new URLSearchParams({ orgId: input.orgId });
  const response = await fetch(
    `${backendBaseUrl()}/internal/interviews/${encodeURIComponent(sessionId)}?${params}`,
    {
      headers: backendHeaders(),
      cache: "no-store",
    },
  );

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`backend returned ${response.status}`);
  }

  const payload = (await response.json()) as { readonly interview?: RealInterviewDetail };
  return payload.interview ?? null;
}
