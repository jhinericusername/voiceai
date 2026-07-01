import Link from "next/link";
import { notFound } from "next/navigation";
import {
  dashboardOrgId,
  getRealInterview,
  type ImportedWeaveEvaluation,
  type RealInterviewDetail,
} from "../../backend-data";
import { requireDashboardUser } from "../../auth";
import {
  EmptyState,
  SectionPanel,
  StatusPill,
  formatDateTime,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../dashboard-ui";
import { InterviewPlaybackReview } from "./InterviewPlaybackReview";
import { HumanScoreReviewEditor } from "./HumanScoreReviewEditor";
import {
  normalizeReviewScore,
  reviewDimensionDefinitions,
  reviewDimensionKeyFromLabel,
  type ReviewDimensionDraft,
  type ReviewDimensionKey,
  type ReviewerDecision,
} from "./review-score-model";

export function generateStaticParams() {
  return [];
}

export default async function InterviewSessionPage({ params }: { readonly params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const { user, organizationId } = await requireDashboardUser();
  const orgId = dashboardOrgId({ organizationId, userId: user.id });
  let realInterview: RealInterviewDetail | null = null;

  try {
    realInterview = await getRealInterview(sessionId, { orgId });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Unable to load real interview detail", error);
    }
  }

  if (!realInterview) {
    notFound();
  }

  return (
    <RealInterviewDetailView
      realInterview={realInterview}
      organizationId={orgId}
      reviewerEmail={user.email?.trim() || user.id}
    />
  );
}

function RealInterviewDetailView({
  realInterview,
  organizationId,
  reviewerEmail,
}: {
  readonly realInterview: RealInterviewDetail;
  readonly organizationId: string;
  readonly reviewerEmail: string;
}) {
  const recommendation = realInterview.recommendation_packet
    ? formatRecommendationPacketStatus(realInterview.recommendation_packet)
    : realPacketRecommendation(realInterview);
  const generatedScoreRows = scorecardRowsFromRecommendationPacket(realInterview.recommendation_packet);
  const richScorecard = scorecardJsonFromRecommendationPacket(realInterview.recommendation_packet?.scorecardJson);
  const recommendationWarnings = formatRecommendationWarnings(realInterview.recommendation_packet?.warnings);
  const scoreSummary = formatCategoryScoreSummary(
    realInterview.recommendation_packet?.categoryScores ?? realInterview.category_scores,
  );
  const isHistoricalFireflies = realInterview.external_source === "fireflies";
  const transcriptTurns = [...realInterview.transcript_turns].sort(
    (first, second) => first.turnIndex - second.turnIndex,
  );
  const candidateLabel = realInterview.candidate_email?.trim() || "Candidate";
  const completedAt = realInterview.started_at ?? realInterview.scheduled_at;
  const videoArtifact = realInterview.artifacts.find((artifact) => artifact.kind === "composite_video");
  const audioArtifact = realInterview.artifacts.find((artifact) => artifact.kind === "candidate_audio");
  const playbackArtifact = videoArtifact ?? audioArtifact;
  const latestReviewerFeedback = latestReviewerFeedbackFromInterview(realInterview);
  const humanReviewDraft = humanReviewDraftFromInterview(realInterview, latestReviewerFeedback);
  const savedReviewerFeedbackStatus = formatSavedReviewerFeedbackStatus(latestReviewerFeedback);

  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
      <header className="puddle-dashboard-hero-card overflow-hidden rounded-md border border-cyan-200 bg-white/94 px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={formatBackendStatus(realInterview.status, "Unknown")} />
              <StatusPill status={recommendation} />
              {isHistoricalFireflies ? <StatusPill status="Historical Fireflies import" /> : null}
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Interview review</span>
            </div>
            <h1 className="mt-2 break-words text-2xl font-semibold text-slate-950 sm:text-3xl">
              {candidateLabel}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Review the recording, transcript, and recommendation for this interview.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/dashboard/review-queue" className={primaryButtonClass}>
              Review queue
            </Link>
            <Link href="/dashboard/roles" className={secondaryButtonClass}>
              Roles
            </Link>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Interview packet summary">
        <SummaryCard
          label="Status"
          value={formatBackendStatus(realInterview.status, "Unknown")}
          detail={realInterview.signed_off_at ? `Reviewed ${formatDateTime(realInterview.signed_off_at)}` : "Awaiting review"}
        />
        <SummaryCard
          label="Recording"
          value={playbackArtifact ? formatBackendStatus(playbackArtifact.status, "Available") : "Missing"}
          detail={playbackArtifact ? artifactKindLabel(playbackArtifact.kind) : "No playable media attached"}
        />
        <SummaryCard label="Score" value={scoreSummary} detail={recommendation} />
        <SummaryCard
          label="Started"
          value={formatNullableDate(completedAt)}
          detail={realInterview.ended_at ? `Ended ${formatDateTime(realInterview.ended_at)}` : "End time unavailable"}
        />
      </section>

      <InterviewPlaybackReview
        compositeVideoUrl={realInterview.compositeVideoUrl}
        candidateAudioUrl={realInterview.candidateAudioUrl}
        videoStatus={videoArtifact ? formatBackendStatus(videoArtifact.status, "Video") : "Video missing"}
        audioStatus={audioArtifact ? formatBackendStatus(audioArtifact.status, "Audio") : "Audio missing"}
        transcriptTurns={transcriptTurns}
        startedAt={completedAt}
      >
          {realInterview.imported_evaluation ? (
            <ImportedWeaveEvaluationPanel evaluation={realInterview.imported_evaluation} />
          ) : null}

          <SectionPanel
            title="AI recommendation"
            eyebrow="Generated scorecard"
            action={<StatusPill status={recommendation} />}
          >
            {realInterview.recommendation_packet ? (
              <div className="grid gap-4">
                <dl className="grid gap-3 sm:grid-cols-2">
                  <PacketMetaRow label="Recommendation" value={recommendation} />
                  <PacketMetaRow
                    label="Confidence"
                    value={formatRecommendationPacketConfidence(realInterview.recommendation_packet)}
                  />
                  <PacketMetaRow
                    label="Source"
                    value={formatRecommendationSource(realInterview.recommendation_packet.source)}
                  />
                  <PacketMetaRow
                    label="Generated"
                    value={formatDateTime(realInterview.recommendation_packet.updatedAt)}
                  />
                  <PacketMetaRow
                    label="Model"
                    value={formatRecommendationModel(realInterview.recommendation_packet.modelMetadata)}
                  />
                  <PacketMetaRow
                    label="Warnings"
                    value={recommendationWarnings.length ? `${recommendationWarnings.length} warning${recommendationWarnings.length === 1 ? "" : "s"}` : "No warnings"}
                  />
                </dl>

                {recommendationWarnings.length ? (
                  <div className="flex flex-wrap gap-2">
                    {recommendationWarnings.map((warning) => (
                      <StatusPill key={warning} status={formatBackendStatus(warning, "Warning")} />
                    ))}
                  </div>
                ) : null}

                {generatedScoreRows.length ? (
                  <div className="grid gap-3">
                    {generatedScoreRows.map((row) => (
                      <ScorecardDimensionRow key={row.key} row={row} />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="Generated scorecard pending"
                    detail="Scores and rationales appear here after an AI recommendation is generated for this interview."
                  />
                )}

                {richScorecard ? (
                  <div className="grid gap-4">
                    <ScorecardComment comment={richScorecard.comment} />
                    <MissingQuestionsSection questions={richScorecard.missingQuestions} />
                    <ScriptedAnswerDetectionSection detection={richScorecard.scriptedAnswerDetection} />
                    <FinalScoresSection finalScores={richScorecard.finalScores} />
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState
                title="AI recommendation pending"
                detail="Generate a recommendation for this interview to review the scorecard, rationale, evidence, and warnings."
              />
            )}
          </SectionPanel>

          <SectionPanel
            title="Human review corrections"
            eyebrow="Reviewer feedback"
            action={<StatusPill status={savedReviewerFeedbackStatus ? "Saved review" : "Draft review"} />}
          >
            {realInterview.recommendation_packet ? (
              <HumanScoreReviewEditor
                key={[
                  realInterview.recommendation_packet.recommendationId,
                  latestReviewerFeedback?.feedbackId ?? latestReviewerFeedback?.updatedAt ?? latestReviewerFeedback?.createdAt ?? "draft",
                ].join(":")}
                recommendationId={realInterview.recommendation_packet.recommendationId}
                sessionId={realInterview.session_id}
                organizationId={organizationId}
                reviewerEmail={reviewerEmail}
                initialDecision={humanReviewDraft.reviewerDecision}
                initialOverrideReason={humanReviewDraft.overrideReason}
                dimensions={humanReviewDraft.dimensions}
                savedStatus={savedReviewerFeedbackStatus}
              />
            ) : (
              <EmptyState
                title="Human review unavailable"
                detail="Reviewer corrections can be saved after a generated recommendation exists for this interview."
              />
            )}
          </SectionPanel>

          <SectionPanel title="Review packet" eyebrow="Summary">
            <dl className="grid gap-3 sm:grid-cols-2">
              <PacketMetaRow label="Candidate" value={candidateLabel} />
              <PacketMetaRow label="Reviewer" value={realInterview.reviewer_email ?? "Unassigned"} />
              <PacketMetaRow label="Integrity" value={formatUnknownCollection(realInterview.integrity_flags, "flags")} />
              {isHistoricalFireflies ? <PacketMetaRow label="Source" value="Fireflies historical import" /> : null}
              {realInterview.error_message ? <PacketMetaRow label="Error" value={realInterview.error_message} /> : null}
            </dl>
          </SectionPanel>

          <SectionPanel title="Artifacts" eyebrow="Packet contents">
            {realInterview.artifacts.length ? (
              <div className="grid gap-3">
                {realInterview.artifacts.map((artifact) => (
                  <div key={`${artifact.kind}-${artifact.storagePath}`} className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-950">{artifactKindLabel(artifact.kind)}</div>
                        <div className="mt-1 text-xs leading-5 text-slate-500">
                          {formatArtifactDetail(artifact.contentType, artifact.sizeBytes, artifact.durationSeconds)}
                        </div>
                      </div>
                      <StatusPill status={formatBackendStatus(artifact.status, "Unknown")} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Artifacts not created yet" detail="Recording and transcript artifacts appear here as the session moves through the lifecycle." />
            )}
          </SectionPanel>
      </InterviewPlaybackReview>
    </div>
  );
}

function formatBackendStatus(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }

  const normalized = trimmed.replace(/[_-]+/g, " ").toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatNullableDate(value: string | null): string {
  return value ? formatDateTime(value) : "Not set";
}

const IMPORTED_WEAVE_NUMERIC_SCORE_PATTERN = /^[-+]?(?:\d+|\d*\.\d+)$/;
const IMPORTED_WEAVE_SUFFIXED_SCORE_PATTERN = /^([-+]?(?:\d+|\d*\.\d+))\s*\/\s*([-+]?(?:\d+|\d*\.\d+))$/;
const NON_FINITE_IMPORTED_WEAVE_SCORE_LABELS = new Set(["nan", "infinity", "+infinity", "-infinity"]);

function normalizedImportedWeaveScoreNumber(value: number): string {
  return String(value).replace(/\.0$/, "");
}

function formatImportedWeaveNumericScore(value: string | number | null): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? normalizedImportedWeaveScoreNumber(value) : null;
  }

  const trimmed = value?.trim();
  if (!trimmed || NON_FINITE_IMPORTED_WEAVE_SCORE_LABELS.has(trimmed.toLowerCase())) {
    return null;
  }

  if (!IMPORTED_WEAVE_NUMERIC_SCORE_PATTERN.test(trimmed)) {
    return null;
  }

  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? normalizedImportedWeaveScoreNumber(numeric) : null;
}

function formatImportedWeaveSuffixedScore(value: string | number | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || NON_FINITE_IMPORTED_WEAVE_SCORE_LABELS.has(trimmed.toLowerCase())) {
    return null;
  }

  const match = trimmed.match(IMPORTED_WEAVE_SUFFIXED_SCORE_PATTERN);
  if (!match) {
    return null;
  }

  const score = Number(match[1]);
  const maxScore = Number(match[2]);
  if (!Number.isFinite(score) || !Number.isFinite(maxScore)) {
    return null;
  }

  return `${normalizedImportedWeaveScoreNumber(score)}/${normalizedImportedWeaveScoreNumber(maxScore)}`;
}

function formatImportedWeaveScore(value: string | number | null, suffix: string): string {
  const numericScore = formatImportedWeaveNumericScore(value);
  return numericScore ? `${numericScore}${suffix}` : formatImportedWeaveSuffixedScore(value) ?? "Not scored";
}

function scoreValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return scoreValue(record.score ?? record.value ?? record.rating);
  }

  return null;
}

function formatScoreLabel(value: string): string {
  const normalized = value.replace(/[_-]+/g, " ").trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatCategoryScoreSummary(categoryScores: unknown): string {
  if (!categoryScores) {
    return "Scores pending";
  }
  if (Array.isArray(categoryScores)) {
    return categoryScores.length ? `${categoryScores.length} scores` : "Scores pending";
  }
  if (typeof categoryScores !== "object") {
    return "Scorecard ready";
  }

  const scores = Object.entries(categoryScores as Record<string, unknown>)
    .map(([key, value]) => {
      const score = scoreValue(value);
      return score ? `${formatScoreLabel(key)} ${score}` : null;
    })
    .filter((value): value is string => Boolean(value));

  if (!scores.length) {
    return "Scorecard ready";
  }

  const visibleScores = scores.slice(0, 2).join(" / ");
  return scores.length > 2 ? `${visibleScores} +${scores.length - 2}` : visibleScores;
}

type RecommendationPacket = NonNullable<RealInterviewDetail["recommendation_packet"]>;

type GeneratedScorecardRow = {
  readonly key: string;
  readonly label: string;
  readonly score: string;
  readonly confidence: string | null;
  readonly rationale: string;
  readonly evidenceQuotes: readonly string[];
};

type RichScorecard = {
  readonly dimensionScores: readonly {
    readonly category: string;
    readonly score: number;
    readonly confidence: number | string | null;
    readonly notes: string;
    readonly evidenceQuotes: readonly string[];
  }[];
  readonly missingQuestions: readonly {
    readonly question: string;
    readonly asked: string;
    readonly notes: string;
  }[];
  readonly scriptedAnswerDetection: {
    readonly signals: readonly {
      readonly signal: string;
      readonly rating: string;
    }[];
    readonly summary: string;
    readonly confidence: string;
  };
  readonly finalScores: {
    readonly dimensions: readonly {
      readonly category: string;
      readonly score: number;
    }[];
    readonly totalScore: number;
    readonly maxScore: number;
  };
  readonly comment: string;
};

type SavedReviewerFeedback = {
  readonly feedbackId: string | null;
  readonly reviewerEmail: string | null;
  readonly reviewerDecision: ReviewerDecision | null;
  readonly overrideReason: string;
  readonly dimensionFeedback: unknown;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

type HumanReviewDraft = {
  readonly reviewerDecision: ReviewerDecision;
  readonly overrideReason: string;
  readonly dimensions: readonly ReviewDimensionDraft[];
};

type AiReviewDimension = {
  readonly score: number | null;
  readonly notes: string;
};

type SavedReviewDimension = {
  readonly score: number | null;
  readonly notes: string | null;
};

function latestReviewerFeedbackFromInterview(interview: RealInterviewDetail): SavedReviewerFeedback | null {
  const interviewRecord = interview as unknown as Record<string, unknown>;
  const recommendationRecord = isRecord(interview.recommendation_packet)
    ? (interview.recommendation_packet as Record<string, unknown>)
    : null;
  const candidates = [
    interviewRecord.latestFeedback,
    interviewRecord.latestReviewerFeedback,
    interviewRecord.latest_reviewer_feedback,
    interviewRecord.reviewerFeedback,
    interviewRecord.reviewer_feedback,
    interviewRecord.feedback,
    recommendationRecord?.latestFeedback,
    recommendationRecord?.latestReviewerFeedback,
    recommendationRecord?.latest_reviewer_feedback,
    recommendationRecord?.reviewerFeedback,
    recommendationRecord?.reviewer_feedback,
  ];

  for (const candidate of candidates) {
    const feedback = savedReviewerFeedbackFromUnknown(candidate);
    if (feedback) {
      return feedback;
    }
  }

  return null;
}

function savedReviewerFeedbackFromUnknown(value: unknown): SavedReviewerFeedback | null {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const feedback = savedReviewerFeedbackFromUnknown(item);
      return feedback ? [feedback] : [];
    })[0] ?? null;
  }
  if (!isRecord(value)) {
    return null;
  }

  const dimensionFeedback = value.dimensionFeedback ?? value.dimension_feedback;
  const reviewerDecision = reviewerDecisionFromUnknown(value.reviewerDecision ?? value.reviewer_decision);
  if (!reviewerDecision && !dimensionFeedback) {
    return null;
  }

  return {
    feedbackId: stringFromUnknown(value.feedbackId ?? value.feedback_id),
    reviewerEmail: stringFromUnknown(value.reviewerEmail ?? value.reviewer_email),
    reviewerDecision,
    overrideReason: stringFromUnknown(value.overrideReason ?? value.override_reason) ?? "",
    dimensionFeedback: dimensionFeedback ?? {},
    createdAt: stringFromUnknown(value.createdAt ?? value.created_at),
    updatedAt: stringFromUnknown(value.updatedAt ?? value.updated_at),
  };
}

function humanReviewDraftFromInterview(
  interview: RealInterviewDetail,
  savedFeedback: SavedReviewerFeedback | null,
): HumanReviewDraft {
  const aiDimensions = aiReviewDimensionsFromInterview(interview);
  const savedDimensions = savedFeedback
    ? savedReviewDimensionsFromFeedback(savedFeedback.dimensionFeedback)
    : new Map<ReviewDimensionKey, SavedReviewDimension>();

  return {
    reviewerDecision:
      savedFeedback?.reviewerDecision ??
      reviewerDecisionFromUnknown(interview.recommendation_packet?.recommendation) ??
      "needs_more_review",
    overrideReason: savedFeedback?.overrideReason ?? "",
    dimensions: reviewDimensionDefinitions.map((definition) => {
      const aiDimension = aiDimensions.get(definition.key) ?? { score: null, notes: "" };
      const savedDimension = savedDimensions.get(definition.key);
      return {
        key: definition.key,
        label: definition.label,
        score: normalizeReviewScore(savedDimension?.score ?? aiDimension.score),
        notes: savedDimension?.notes ?? aiDimension.notes,
        aiScore: aiDimension.score,
        aiNotes: aiDimension.notes,
      };
    }),
  };
}

function aiReviewDimensionsFromInterview(interview: RealInterviewDetail): ReadonlyMap<ReviewDimensionKey, AiReviewDimension> {
  const dimensions = new Map<ReviewDimensionKey, AiReviewDimension>();
  const scorecardJson = interview.recommendation_packet?.scorecardJson;

  if (isRecord(scorecardJson)) {
    addRichDimensionScores(dimensions, dimensionScoresFromUnknown(scorecardJson.dimensionScores));
    const finalScores = finalScoresFromUnknown(scorecardJson.finalScores);
    if (finalScores) {
      for (const score of finalScores.dimensions) {
        addAiReviewDimension(dimensions, score.category, score.score, null);
      }
    }
  }

  addCategoryScoresAsAiDimensions(dimensions, interview.recommendation_packet?.categoryScores);
  addCategoryScoresAsAiDimensions(dimensions, interview.category_scores);

  return dimensions;
}

function addRichDimensionScores(
  dimensions: Map<ReviewDimensionKey, AiReviewDimension>,
  scores: RichScorecard["dimensionScores"],
) {
  for (const score of scores) {
    addAiReviewDimension(dimensions, score.category, score.score, score.notes);
  }
}

function addCategoryScoresAsAiDimensions(
  dimensions: Map<ReviewDimensionKey, AiReviewDimension>,
  categoryScores: unknown,
) {
  if (Array.isArray(categoryScores)) {
    for (const item of categoryScores) {
      if (!isRecord(item)) {
        continue;
      }
      addAiReviewDimension(
        dimensions,
        stringFromUnknown(item.category ?? item.dimension ?? item.key ?? item.name),
        numberFromUnknown(item.score ?? item.value ?? item.rating),
        stringFromUnknown(item.notes ?? item.rationale ?? item.comment),
      );
    }
    return;
  }

  if (!isRecord(categoryScores)) {
    return;
  }

  for (const [category, value] of Object.entries(categoryScores)) {
    if (isRecord(value)) {
      addAiReviewDimension(
        dimensions,
        category,
        numberFromUnknown(value.score ?? value.value ?? value.rating),
        stringFromUnknown(value.notes ?? value.rationale ?? value.comment),
      );
    } else {
      addAiReviewDimension(dimensions, category, numberFromUnknown(value), null);
    }
  }
}

function addAiReviewDimension(
  dimensions: Map<ReviewDimensionKey, AiReviewDimension>,
  category: string | null,
  score: number | null,
  notes: string | null,
) {
  if (!category) {
    return;
  }

  const key = reviewDimensionKeyFromLabel(category);
  if (!key || dimensions.has(key)) {
    return;
  }

  dimensions.set(key, { score, notes: notes ?? "" });
}

function savedReviewDimensionsFromFeedback(dimensionFeedback: unknown): ReadonlyMap<ReviewDimensionKey, SavedReviewDimension> {
  const dimensions = new Map<ReviewDimensionKey, SavedReviewDimension>();
  addSavedReviewDimensions(dimensions, dimensionFeedback);
  return dimensions;
}

function addSavedReviewDimensions(
  dimensions: Map<ReviewDimensionKey, SavedReviewDimension>,
  dimensionFeedback: unknown,
) {
  if (Array.isArray(dimensionFeedback)) {
    for (const item of dimensionFeedback) {
      addSavedReviewDimensionItem(dimensions, null, item);
    }
    return;
  }

  if (!isRecord(dimensionFeedback)) {
    return;
  }

  const nested = dimensionFeedback.dimensions ?? dimensionFeedback.dimensionFeedback ?? dimensionFeedback.dimension_feedback;
  if (nested && nested !== dimensionFeedback) {
    addSavedReviewDimensions(dimensions, nested);
  }

  for (const definition of reviewDimensionDefinitions) {
    const item =
      dimensionFeedback[definition.key] ??
      dimensionFeedback[snakeReviewDimensionKey(definition.key)] ??
      dimensionFeedback[definition.label] ??
      dimensionFeedback[definition.label.toLowerCase()];
    addSavedReviewDimensionItem(dimensions, definition.key, item);
  }
}

function addSavedReviewDimensionItem(
  dimensions: Map<ReviewDimensionKey, SavedReviewDimension>,
  fallbackKey: ReviewDimensionKey | null,
  item: unknown,
) {
  if (!item) {
    return;
  }

  if (!isRecord(item)) {
    const score = numberFromUnknown(item);
    if (fallbackKey && score !== null) {
      dimensions.set(fallbackKey, { score, notes: null });
    }
    return;
  }

  const key =
    reviewDimensionKeyFromLabel(stringFromUnknown(item.key ?? item.category ?? item.dimension ?? item.label) ?? "") ??
    fallbackKey;
  if (!key || dimensions.has(key)) {
    return;
  }

  dimensions.set(key, {
    score: numberFromUnknown(item.correctedScore ?? item.corrected_score ?? item.score ?? item.value ?? item.rating),
    notes: optionalStringFromUnknown(item.notes ?? item.note ?? item.comment ?? item.rationale),
  });
}

function snakeReviewDimensionKey(key: ReviewDimensionKey): string {
  switch (key) {
    case "problemSolving":
      return "problem_solving";
    case "agency":
      return "agency";
    case "competitiveness":
      return "competitiveness";
    case "curious":
      return "curious";
  }
}

function reviewerDecisionFromUnknown(value: unknown): ReviewerDecision | null {
  switch (value) {
    case "advance":
    case "hold":
    case "pass":
    case "needs_more_review":
      return value;
    default:
      return null;
  }
}

function formatSavedReviewerFeedbackStatus(feedback: SavedReviewerFeedback | null): string | null {
  if (!feedback) {
    return null;
  }

  const timestamp = feedback.updatedAt ?? feedback.createdAt;
  const saved = timestamp ? `Saved ${formatDateTime(timestamp)}` : "Saved";
  return feedback.reviewerEmail ? `${saved} by ${feedback.reviewerEmail}` : saved;
}

function formatRecommendationPacketStatus(packet: RecommendationPacket): string {
  switch (packet.recommendation) {
    case "advance":
      return "Advance";
    case "hold":
      return "Hold";
    case "pass":
      return "Pass";
    default:
      return formatBackendStatus(packet.recommendation, "Pending");
  }
}

function formatRecommendationPacketConfidence(packet: RecommendationPacket): string {
  return formatConfidenceValue(packet.confidence) ?? "Confidence pending";
}

function formatConfidenceValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const percentage = value <= 1 ? value * 100 : value;
    return `${Math.round(percentage)}%`;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return formatConfidenceValue(numeric);
    }
    return value.trim();
  }

  return null;
}

function scorecardRowsFromRecommendationPacket(
  packet: RealInterviewDetail["recommendation_packet"],
): readonly GeneratedScorecardRow[] {
  const richScorecard = scorecardJsonFromRecommendationPacket(packet?.scorecardJson);
  if (richScorecard) {
    return richScorecard.dimensionScores.map((score, index) => ({
      key: `${score.category}-${index}`,
      label: formatScoreLabel(score.category),
      score: `${score.score} / 4`,
      confidence: formatConfidenceValue(score.confidence),
      rationale: score.notes,
      evidenceQuotes: score.evidenceQuotes,
    }));
  }

  if (!packet || !Array.isArray(packet.categoryScores)) {
    return [];
  }

  const evidenceByCategory = evidenceByCategoryMap(packet.evidence);

  return packet.categoryScores.flatMap((item, index) => {
    if (!isRecord(item)) {
      return [];
    }

    const category = stringFromUnknown(item.category) ?? `dimension_${index + 1}`;
    const evidence = evidenceByCategory.get(normalizedCategoryKey(category));
    const score = scoreValue(item.score ?? item.value ?? item.rating);
    const evidenceQuotes = firstNonEmptyStringArray([
      item.evidenceQuotes,
      item.evidence_quotes,
      evidence?.evidenceQuotes,
    ]);

    return [
      {
        key: `${category}-${index}`,
        label: formatScoreLabel(category),
        score: score ? `${score} / 4` : "Score pending",
        confidence: formatConfidenceValue(item.confidence),
        rationale:
          stringFromUnknown(item.rationale) ??
          evidence?.rationale ??
          "No generated rationale was stored for this dimension.",
        evidenceQuotes,
      },
    ];
  });
}

function scorecardJsonFromRecommendationPacket(
  scorecardJson: unknown,
): RichScorecard | null {
  if (!isRecord(scorecardJson)) {
    return null;
  }

  const dimensionScores = dimensionScoresFromUnknown(scorecardJson.dimensionScores);
  const missingQuestions = missingQuestionsFromUnknown(scorecardJson.missingQuestions);
  const scriptedAnswerDetection = scriptedAnswerDetectionFromUnknown(scorecardJson.scriptedAnswerDetection);
  const finalScores = finalScoresFromUnknown(scorecardJson.finalScores);
  const comment = stringFromUnknown(scorecardJson.comment);

  if (!dimensionScores.length || !scriptedAnswerDetection || !finalScores || !comment) {
    return null;
  }

  return {
    dimensionScores,
    missingQuestions,
    scriptedAnswerDetection,
    finalScores,
    comment,
  };
}

function dimensionScoresFromUnknown(value: unknown): RichScorecard["dimensionScores"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const category = stringFromUnknown(item.category);
    const score = numberFromUnknown(item.score);
    const notes = stringFromUnknown(item.notes);
    if (!category || score === null || !notes) {
      return [];
    }

    return [
      {
        category,
        score,
        confidence: item.confidence === undefined ? null : (item.confidence as number | string | null),
        notes,
        evidenceQuotes: firstNonEmptyStringArray([item.evidenceQuotes, item.evidence_quotes]),
      },
    ];
  });
}

function missingQuestionsFromUnknown(value: unknown): RichScorecard["missingQuestions"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const question = stringFromUnknown(item.question);
    const asked = stringFromUnknown(item.asked);
    const notes = stringFromUnknown(item.notes);
    return question && asked && notes ? [{ question, asked, notes }] : [];
  });
}

function scriptedAnswerDetectionFromUnknown(value: unknown): RichScorecard["scriptedAnswerDetection"] | null {
  if (!isRecord(value) || !Array.isArray(value.signals)) {
    return null;
  }

  const summary = stringFromUnknown(value.summary);
  const confidence = stringFromUnknown(value.confidence);
  if (!summary || !confidence) {
    return null;
  }

  const signals = value.signals.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const signal = stringFromUnknown(item.signal);
    const rating = stringFromUnknown(item.rating);
    return signal && rating ? [{ signal, rating }] : [];
  });

  return { signals, summary, confidence };
}

function finalScoresFromUnknown(value: unknown): RichScorecard["finalScores"] | null {
  if (!isRecord(value) || !Array.isArray(value.dimensions)) {
    return null;
  }

  const totalScore = numberFromUnknown(value.totalScore);
  const maxScore = numberFromUnknown(value.maxScore);
  if (totalScore === null || maxScore === null) {
    return null;
  }

  const dimensions = value.dimensions.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const category = stringFromUnknown(item.category);
    const score = numberFromUnknown(item.score);
    return category && score !== null ? [{ category, score }] : [];
  });

  return { dimensions, totalScore, maxScore };
}

function evidenceByCategoryMap(
  evidence: unknown,
): ReadonlyMap<string, { readonly evidenceQuotes: readonly string[]; readonly rationale: string | null }> {
  if (!isRecord(evidence)) {
    return new Map();
  }

  const categoryScores = evidence.categoryScores ?? evidence.category_scores;
  if (!Array.isArray(categoryScores)) {
    return new Map();
  }

  const entries = categoryScores.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const category = stringFromUnknown(item.category);
    if (!category) {
      return [];
    }

    return [
      [
        normalizedCategoryKey(category),
        {
          evidenceQuotes: firstNonEmptyStringArray([item.evidenceQuotes, item.evidence_quotes]),
          rationale: stringFromUnknown(item.rationale),
        },
      ] as const,
    ];
  });

  return new Map(entries);
}

function formatRecommendationWarnings(warnings: unknown): readonly string[] {
  return stringArrayFromUnknown(warnings);
}

function formatRecommendationSource(value: string): string {
  switch (value) {
    case "historical_fireflies":
      return "Fireflies historical import";
    case "puddle_live":
      return "Puddle interview";
    case "manual_retry":
      return "Manual retry";
    default:
      return formatBackendStatus(value, "Unknown source");
  }
}

function formatRecommendationModel(value: unknown): string {
  if (!isRecord(value)) {
    return "Model metadata pending";
  }

  const fields = [value.provider, value.model ?? value.modelId ?? value.model_id, value.parser]
    .map(stringFromUnknown)
    .filter((field): field is string => Boolean(field));

  return fields.length ? fields.join(" / ") : "Model metadata pending";
}

function realPacketRecommendation(interview: RealInterviewDetail): string {
  if (interview.meets_bare_minimum === true) {
    return "Meets bar";
  }
  if (interview.meets_bare_minimum === false) {
    return "Below bar";
  }
  return "Pending";
}

function formatUnknownCollection(value: unknown, label: string): string {
  if (!value) {
    return `No ${label}`;
  }
  if (Array.isArray(value)) {
    return value.length ? `${value.length} ${label}` : `No ${label}`;
  }
  if (typeof value === "object") {
    const count = Object.keys(value as Record<string, unknown>).length;
    return count ? `${count} ${label}` : `No ${label}`;
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return `No ${label}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalStringFromUnknown(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function stringArrayFromUnknown(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map((item) => item.trim());
}

function firstNonEmptyStringArray(values: readonly unknown[]): readonly string[] {
  for (const value of values) {
    const strings = stringArrayFromUnknown(value);
    if (strings.length) {
      return strings;
    }
  }

  return [];
}

function normalizedCategoryKey(value: string): string {
  return value.replace(/[\s-]+/g, "_").toLowerCase();
}

function formatBytes(value: number | null): string {
  if (value === null) {
    return "Size pending";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(value: number | null): string {
  if (value === null) {
    return "Duration pending";
  }

  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatArtifactDetail(contentType: string, sizeBytes: number | null, durationSeconds: number | null): string {
  return [contentType, formatBytes(sizeBytes), formatDuration(durationSeconds)].join(" / ");
}

function artifactKindLabel(value: string): string {
  switch (value) {
    case "composite_video":
      return "Video";
    case "candidate_audio":
      return "Audio";
    case "transcript":
      return "Transcript";
    default:
      return formatScoreLabel(value);
  }
}

function PacketMetaRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm leading-6 text-slate-700">{value}</dd>
    </div>
  );
}

function ImportedWeaveEvaluationPanel({
  evaluation,
}: {
  readonly evaluation: ImportedWeaveEvaluation;
}) {
  return (
    <SectionPanel
      title="Imported Weave evaluation"
      eyebrow="Weave"
      action={<StatusPill status={formatImportedWeaveScore(evaluation.totalScore, "/16")} />}
    >
      <div className="grid gap-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          <PacketMetaRow label="Total score" value={formatImportedWeaveScore(evaluation.totalScore, "/16")} />
          <PacketMetaRow label="Problem solving" value={formatImportedWeaveScore(evaluation.problemSolving, "/4")} />
          <PacketMetaRow label="Agency" value={formatImportedWeaveScore(evaluation.agency, "/4")} />
          <PacketMetaRow label="Competitiveness" value={formatImportedWeaveScore(evaluation.competitiveness, "/4")} />
          <PacketMetaRow label="Curiosity" value={formatImportedWeaveScore(evaluation.curiosity, "/4")} />
          <PacketMetaRow label="Source updated" value={formatNullableDate(evaluation.sourceUpdatedAt)} />
        </dl>
        {evaluation.comments?.trim() ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Comments</div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
              {evaluation.comments.trim()}
            </p>
          </div>
        ) : null}
      </div>
    </SectionPanel>
  );
}

function ScorecardDimensionRow({ row }: { readonly row: GeneratedScorecardRow }) {
  return (
    <article className="puddle-dashboard-card rounded-md border border-slate-200 bg-white/88 px-3 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold text-slate-950">{row.label}</h3>
          {row.confidence ? (
            <div className="mt-1 text-xs leading-5 text-slate-500">{row.confidence} confidence</div>
          ) : null}
        </div>
        <StatusPill status={row.score} />
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{row.rationale}</p>
      {row.evidenceQuotes.length ? (
        <ul className="mt-3 grid gap-2">
          {row.evidenceQuotes.slice(0, 3).map((quote, index) => (
            <li
              key={`${row.key}-quote-${index}`}
              className="rounded-md border border-cyan-100 bg-cyan-50/35 px-3 py-2 text-xs leading-5 text-slate-600"
            >
              {quote}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function ScorecardComment({ comment }: { readonly comment: string }) {
  return (
    <section className="puddle-dashboard-card rounded-md border border-slate-200 bg-white/88 px-3 py-3">
      <h3 className="text-sm font-semibold text-slate-950">Overall comment</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{comment}</p>
    </section>
  );
}

function MissingQuestionsSection({
  questions,
}: {
  readonly questions: RichScorecard["missingQuestions"];
}) {
  return (
    <section className="puddle-dashboard-card rounded-md border border-slate-200 bg-white/88 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-950">Missing questions</h3>
        <StatusPill status={questions.length ? `${questions.length} tracked` : "None"} />
      </div>
      {questions.length ? (
        <div className="mt-3 grid gap-2">
          {questions.map((question) => (
            <div key={question.question} className="rounded-md border border-cyan-100 bg-cyan-50/35 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">{question.question}</span>
                <StatusPill status={formatBackendStatus(question.asked, "Unknown")} />
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-600">{question.notes}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm leading-6 text-slate-600">No missing-question analysis was stored.</p>
      )}
    </section>
  );
}

function ScriptedAnswerDetectionSection({
  detection,
}: {
  readonly detection: RichScorecard["scriptedAnswerDetection"];
}) {
  return (
    <section className="puddle-dashboard-card rounded-md border border-slate-200 bg-white/88 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-950">Scripted answer detection</h3>
        <StatusPill status={detection.confidence} />
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-700">{detection.summary}</p>
      {detection.signals.length ? (
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {detection.signals.map((signal) => (
            <div key={signal.signal} className="rounded-md border border-cyan-100 bg-cyan-50/35 px-3 py-2">
              <dt className="text-xs font-semibold text-slate-500">{signal.signal}</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">{signal.rating}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

function FinalScoresSection({
  finalScores,
}: {
  readonly finalScores: RichScorecard["finalScores"];
}) {
  return (
    <section className="puddle-dashboard-card rounded-md border border-slate-200 bg-white/88 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-950">Final scores</h3>
        <StatusPill status={`${finalScores.totalScore} / ${finalScores.maxScore}`} />
      </div>
      {finalScores.dimensions.length ? (
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {finalScores.dimensions.map((score) => (
            <div key={score.category} className="flex items-center justify-between gap-3 rounded-md border border-cyan-100 bg-cyan-50/35 px-3 py-2">
              <dt className="text-sm font-semibold text-slate-900">{formatScoreLabel(score.category)}</dt>
              <dd className="text-sm font-semibold text-slate-700">{score.score} / 4</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <div className="puddle-metric-card min-w-0 rounded-md border border-slate-200 bg-white/94 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-2 truncate text-xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{detail}</div>
    </div>
  );
}
