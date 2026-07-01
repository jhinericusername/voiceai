import { backendBaseUrl, backendFetch, backendHeaders } from "@/lib/backend-api";

export function dashboardOrgId(input: {
  readonly organizationId?: string | null;
  readonly userId: string;
}): string {
  const organizationId = input.organizationId?.trim();
  if (!organizationId) {
    throw new Error("Signed-in user does not belong to a WorkOS organization.");
  }

  return organizationId;
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
  readonly external_source: string | null;
  readonly external_id: string | null;
  readonly source_metadata: unknown;
  readonly recording_status: string | null;
  readonly egress_id: string | null;
  readonly category_scores: unknown;
  readonly meets_bare_minimum: boolean | null;
  readonly integrity_flags: unknown;
  readonly reviewer_email: string | null;
  readonly signed_off_at: string | null;
  readonly has_recommendation_packet: boolean;
  readonly needs_human_review: boolean;
}

export interface RealRoomRecordingListItem {
  readonly session_id: string;
  readonly org_id: string;
  readonly candidate_email: string;
  readonly script_version: string;
  readonly status: string;
  readonly room_name: string | null;
  readonly scheduled_at: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly external_source: string | null;
  readonly external_id: string | null;
  readonly source_metadata: unknown;
  readonly recording_status: string;
  readonly egress_id: string | null;
  readonly recording_started_at: string | null;
  readonly recording_ended_at: string | null;
  readonly error_message: string | null;
  readonly composite_video_status: string | null;
  readonly composite_video_size_bytes: number | string | null;
  readonly composite_video_duration_seconds: number | string | null;
  readonly transcript_turn_count: number;
}

export interface RealInterviewDetail extends RealInterviewListItem {
  readonly error_message: string | null;
  readonly recommendation_packet: {
    readonly recommendationId: string;
    readonly recommendation: "advance" | "hold" | "pass";
    readonly confidence: number | string | null;
    readonly source: "historical_fireflies" | "puddle_live" | "manual_retry" | string;
    readonly rubricVersionId: string;
    readonly categoryScores: unknown;
    readonly evidence: unknown;
    readonly scorecardJson: unknown;
    readonly warnings: unknown;
    readonly latestFeedback: {
      readonly feedbackId: string;
      readonly recommendationId: string;
      readonly reviewerEmail: string;
      readonly reviewerDecision: "advance" | "hold" | "pass" | "needs_more_review";
      readonly overrideReason: string | null;
      readonly dimensionFeedback: unknown;
      readonly createdAt: string;
    } | null;
    readonly modelMetadata: unknown;
    readonly createdAt: string;
    readonly updatedAt: string;
  } | null;
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
  readonly candidateAudioUrl: string | null;
}

export async function getRealInterviews(input: {
  readonly orgId: string;
}): Promise<readonly RealInterviewListItem[]> {
  const params = new URLSearchParams({ orgId: input.orgId });
  const response = await backendFetch(`${backendBaseUrl()}/internal/interviews?${params}`, {
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

export async function getRoomRecordings(input: {
  readonly orgId: string;
  readonly limit?: number;
  readonly offset?: number;
}): Promise<readonly RealRoomRecordingListItem[]> {
  const params = new URLSearchParams({ orgId: input.orgId });
  if (typeof input.limit === "number" && Number.isFinite(input.limit)) {
    params.set("limit", String(input.limit));
  }
  if (typeof input.offset === "number" && Number.isFinite(input.offset)) {
    params.set("offset", String(input.offset));
  }
  const response = await backendFetch(`${backendBaseUrl()}/internal/room-recordings?${params}`, {
    headers: backendHeaders(),
    cache: "no-store",
  });

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new Error(`backend returned ${response.status}`);
  }

  const payload = (await response.json()) as {
    readonly recordings?: readonly RealRoomRecordingListItem[];
  };
  return payload.recordings ?? [];
}

export async function getRoomRecordingsPage(input: {
  readonly orgId: string;
  readonly limit: number;
  readonly offset: number;
}): Promise<{
  readonly recordings: readonly RealRoomRecordingListItem[];
  readonly hasMore: boolean;
  readonly nextOffset: number;
}> {
  const limit = Math.max(1, Math.floor(input.limit));
  const offset = Math.max(0, Math.floor(input.offset));
  const rows = await getRoomRecordings({ orgId: input.orgId, limit: limit + 1, offset });
  const recordings = rows.slice(0, limit);

  return {
    recordings,
    hasMore: rows.length > limit,
    nextOffset: offset + recordings.length,
  };
}

export async function getRealInterview(
  sessionId: string,
  input: {
    readonly orgId: string;
  },
): Promise<RealInterviewDetail | null> {
  const params = new URLSearchParams({ orgId: input.orgId });
  const response = await backendFetch(
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

export interface RoleRubricSubDimension {
  readonly key: string;
  readonly name: string;
  readonly anchors: Record<string, string>;
}

export interface RoleRubricDimension {
  readonly key: string;
  readonly name: string;
  readonly meaning: string;
  readonly anchors: Record<string, string>;
  readonly sub_dimensions?: readonly RoleRubricSubDimension[];
}

export interface RoleRubricQuestion {
  readonly question_id: string;
  readonly verbatim_text: string;
  readonly rubric_categories: readonly string[];
  readonly target_evidence: readonly string[];
}

export interface RoleRubric {
  readonly script_version: string;
  readonly role: {
    readonly organization_id: string;
    readonly ashby_job_id: string;
    readonly title: string;
  };
  readonly dimensions: readonly RoleRubricDimension[];
  readonly questions: readonly RoleRubricQuestion[];
  readonly bare_minimum_rule: string;
  readonly recommendation_thresholds: {
    readonly minimum_confidence: number;
  };
  readonly disallowed_signals: readonly string[];
  readonly generation_context: {
    readonly historical_session_count: number;
    readonly matched_application_count: number;
  };
}

export interface RoleGradingProfile {
  readonly profile_id: string;
  readonly organization_id: string;
  readonly ashby_integration_id: string;
  readonly ashby_job_id: string;
  readonly status: string;
  readonly active_rubric_version_id: string | null;
  readonly draft_rubric_version_id: string | null;
  readonly active_rubric: RoleRubric | null;
  readonly draft_rubric: RoleRubric | null;
}

export async function getGradingCompanyState(input: {
  readonly orgId: string;
}): Promise<readonly RoleGradingProfile[]> {
  const response = await backendFetch(`${backendBaseUrl()}/grading/company-state`, {
    method: "POST",
    headers: backendHeaders(),
    body: JSON.stringify({ organizationId: input.orgId }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`backend returned ${response.status}`);
  }

  const payload = (await response.json()) as {
    readonly profiles?: readonly RoleGradingProfile[];
  };
  return payload.profiles ?? [];
}
