// The documented REST API boundary with the cofounder's Puddle platform.
// The version is pinned so the platform integrates against a stable contract.
export const INTEGRATION_API_VERSION = "2026-05-20";

export interface CreateSessionRequest {
  readonly orgId: string;
  readonly candidateEmail: string;
  readonly scriptVersion: string;
  readonly scheduledAt: string;
  readonly inviteTtlSeconds?: number;
}

export interface CreateSessionResponse {
  readonly sessionId: string;
  readonly room: string;
  readonly inviteToken: string;
  readonly invitePath: string;
  readonly inviteExpiresAt: string;
}

export type ContractValidation = { ok: true } | { ok: false; reason: string };

export function validateCreateSessionRequest(
  body: CreateSessionRequest,
): ContractValidation {
  const required: (keyof CreateSessionRequest)[] = [
    "orgId",
    "candidateEmail",
    "scriptVersion",
    "scheduledAt",
  ];
  for (const field of required) {
    if (!body[field] || !String(body[field]).trim()) {
      return { ok: false, reason: `missing required field: ${field}` };
    }
  }
  if (
    body.inviteTtlSeconds !== undefined &&
    (!Number.isFinite(body.inviteTtlSeconds) || body.inviteTtlSeconds < 60)
  ) {
    return { ok: false, reason: "inviteTtlSeconds must be at least 60 seconds" };
  }
  return { ok: true };
}

export interface InternalAssessment {
  readonly sessionId: string;
  readonly scriptVersion: string;
  readonly categoryScores: readonly {
    readonly category: string;
    readonly score: number;
    readonly confidence: number;
    readonly lowConfidence: boolean;
  }[];
  readonly meetsBareMinimum: boolean;
  readonly integrityFlags: readonly string[];
  readonly reviewerEmail: string | null;
  readonly signedOffAt: string | null;
}

export interface AssessmentResponse {
  readonly apiVersion: string;
  readonly sessionId: string;
  readonly scriptVersion: string;
  readonly recommendation: "meets_bar" | "below_bar";
  readonly categoryScores: InternalAssessment["categoryScores"];
  readonly integrityFlags: readonly string[];
  readonly humanSignedOff: boolean;
  readonly signedOffAt: string | null;
}

// The platform only ever receives a human-reviewed recommendation — never an
// autonomous decision. `humanSignedOff` makes the review state explicit.
export function toAssessmentResponse(
  assessment: InternalAssessment,
): AssessmentResponse {
  return {
    apiVersion: INTEGRATION_API_VERSION,
    sessionId: assessment.sessionId,
    scriptVersion: assessment.scriptVersion,
    recommendation: assessment.meetsBareMinimum ? "meets_bar" : "below_bar",
    categoryScores: assessment.categoryScores,
    integrityFlags: assessment.integrityFlags,
    humanSignedOff: assessment.reviewerEmail !== null,
    signedOffAt: assessment.signedOffAt,
  };
}
