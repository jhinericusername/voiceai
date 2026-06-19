export type GradingProfileStatus =
  | "draft_needed"
  | "draft_ready"
  | "approval_required"
  | "recommendations_active"
  | "paused";

export type RubricVersionStatus = "draft" | "approved" | "archived";
export type RecommendationValue = "advance" | "hold" | "pass";
export type ReviewerDecision = RecommendationValue | "needs_more_review";
export type RecommendationSource = "historical_fireflies" | "puddle_live" | "manual_retry";

export interface GradingProfileInput {
  readonly profileId: string;
  readonly organizationId: string;
  readonly ashbyIntegrationId: string;
  readonly ashbyJobId: string;
  readonly actorEmail: string;
}

export interface RubricVersionInput {
  readonly rubricVersionId: string;
  readonly profileId: string;
  readonly organizationId: string;
  readonly ashbyJobId: string;
  readonly version: number;
  readonly status: RubricVersionStatus;
  readonly rubric: unknown;
  readonly generationInputs: unknown;
  readonly approvedByEmail?: string | null;
  readonly approvedAt?: string | null;
}

export interface RecommendationInput {
  readonly recommendationId: string;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly ashbyJobId: string;
  readonly rubricVersionId: string;
  readonly source: RecommendationSource;
  readonly recommendation: RecommendationValue;
  readonly confidence: number;
  readonly categoryScores: unknown;
  readonly evidence: unknown;
  readonly scorecardJson: unknown;
  readonly warnings: unknown;
  readonly modelMetadata: unknown;
}

export interface ReviewerFeedbackInput {
  readonly feedbackId: string;
  readonly recommendationId: string;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly reviewerEmail: string;
  readonly reviewerDecision: ReviewerDecision;
  readonly overrideReason: string | null;
  readonly dimensionFeedback: unknown;
}
