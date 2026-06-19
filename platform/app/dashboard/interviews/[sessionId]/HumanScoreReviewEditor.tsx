"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusPill, cx, primaryButtonClass } from "../../dashboard-ui";
import {
  formatReviewScore,
  maxReviewTotal,
  reviewDimensionDefinitions,
  reviewScoreOptions,
  type ReviewDimensionDraft,
  type ReviewDimensionKey,
  type ReviewerDecision,
} from "./review-score-model";

type FeedbackStatus = {
  readonly tone: "success" | "error" | "info";
  readonly text: string;
};

type DimensionDraftState = Record<ReviewDimensionKey, { readonly score: number; readonly notes: string }>;

const reviewerDecisionOptions: readonly { readonly value: ReviewerDecision; readonly label: string }[] = [
  { value: "advance", label: "Advance" },
  { value: "hold", label: "Hold" },
  { value: "pass", label: "Pass" },
  { value: "needs_more_review", label: "Needs more review" },
];

const inputClass =
  "min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100";

const textareaClass =
  "min-h-20 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-950 outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100";

function draftStateFromDimensions(dimensions: readonly ReviewDimensionDraft[]): DimensionDraftState {
  const draft = {} as DimensionDraftState;
  for (const definition of reviewDimensionDefinitions) {
    const dimension = dimensions.find((item) => item.key === definition.key);
    draft[definition.key] = {
      score: dimension?.score ?? 3,
      notes: dimension?.notes ?? "",
    };
  }
  return draft;
}

function dimensionByKey(dimensions: readonly ReviewDimensionDraft[], key: ReviewDimensionKey): ReviewDimensionDraft {
  return (
    dimensions.find((dimension) => dimension.key === key) ?? {
      key,
      label: reviewDimensionDefinitions.find((definition) => definition.key === key)?.label ?? key,
      score: 3,
      notes: "",
      aiScore: null,
      aiNotes: "",
    }
  );
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return fallback;
}

export function HumanScoreReviewEditor({
  recommendationId,
  sessionId,
  organizationId,
  reviewerEmail,
  initialDecision,
  initialOverrideReason,
  dimensions,
  savedStatus,
}: {
  readonly recommendationId: string;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly reviewerEmail: string;
  readonly initialDecision: ReviewerDecision;
  readonly initialOverrideReason: string;
  readonly dimensions: readonly ReviewDimensionDraft[];
  readonly savedStatus: string | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DimensionDraftState>(() => draftStateFromDimensions(dimensions));
  const [reviewerDecision, setReviewerDecision] = useState<ReviewerDecision>(initialDecision);
  const [overrideReason, setOverrideReason] = useState(initialOverrideReason);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackStatus | null>(null);

  const total = useMemo(
    () => reviewDimensionDefinitions.reduce((sum, dimension) => sum + draft[dimension.key].score, 0),
    [draft],
  );
  const saveDisabled = isSaving || !recommendationId;
  const visibleStatus = isSaving ? { tone: "info", text: "Saving human review..." } satisfies FeedbackStatus : feedback;

  function markDirty() {
    setFeedback((current) => (current?.tone === "success" ? null : current));
  }

  function updateScore(key: ReviewDimensionKey, score: number) {
    markDirty();
    setDraft((current) => ({
      ...current,
      [key]: { ...current[key], score },
    }));
  }

  function updateNotes(key: ReviewDimensionKey, notes: string) {
    markDirty();
    setDraft((current) => ({
      ...current,
      [key]: { ...current[key], notes },
    }));
  }

  async function saveReview() {
    if (!recommendationId) {
      setFeedback({ tone: "error", text: "A generated recommendation is required before human review can be saved." });
      return;
    }

    setIsSaving(true);
    setFeedback(null);
    try {
      const dimensionFeedback = {
        problemSolving: { correctedScore: draft.problemSolving.score, notes: draft.problemSolving.notes.trim() },
        agency: { correctedScore: draft.agency.score, notes: draft.agency.notes.trim() },
        competitiveness: { correctedScore: draft.competitiveness.score, notes: draft.competitiveness.notes.trim() },
        curious: { correctedScore: draft.curious.score, notes: draft.curious.notes.trim() },
      };
      const response = await fetch(`/api/grading/recommendations/${encodeURIComponent(recommendationId)}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          organizationId,
          reviewerEmail,
          reviewerDecision,
          overrideReason: overrideReason.trim() || null,
          dimensionFeedback,
        }),
      });
      const payload: unknown = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({ tone: "error", text: errorMessage(payload, "Could not save human review.") });
        return;
      }

      setFeedback({ tone: "success", text: "Human review saved." });
      router.refresh();
    } catch {
      setFeedback({ tone: "error", text: "Could not reach the grading feedback API." });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={savedStatus ? "Saved review" : "Draft review"} />
            {savedStatus ? <span className="text-xs leading-5 text-slate-500">{savedStatus}</span> : null}
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Human review is stored separately from the generated scorecard.
          </p>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Reviewer total</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">
            {formatReviewScore(total)} / {maxReviewTotal}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(180px,240px)_minmax(0,1fr)]">
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          Reviewer decision
          <select
            value={reviewerDecision}
            disabled={isSaving}
            onChange={(event) => {
              markDirty();
              setReviewerDecision(event.target.value as ReviewerDecision);
            }}
            className={inputClass}
          >
            {reviewerDecisionOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          Override reason
          <input
            value={overrideReason}
            disabled={isSaving}
            onChange={(event) => {
              markDirty();
              setOverrideReason(event.target.value);
            }}
            className={inputClass}
            placeholder="Optional context for the human decision"
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-md border border-slate-200">
        <div className="hidden grid-cols-[minmax(120px,0.8fr)_110px_120px_minmax(220px,1.4fr)] gap-3 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 lg:grid">
          <div>Dimension</div>
          <div>AI score</div>
          <div>Reviewer score</div>
          <div>Reviewer notes</div>
        </div>

        {reviewDimensionDefinitions.map((definition) => {
          const dimension = dimensionByKey(dimensions, definition.key);
          return (
            <div
              key={definition.key}
              className="grid gap-3 border-t border-slate-100 px-3 py-3 first:border-t-0 lg:grid-cols-[minmax(120px,0.8fr)_110px_120px_minmax(220px,1.4fr)] lg:items-start"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-950">{dimension.label}</div>
                {dimension.aiNotes ? (
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-500">{dimension.aiNotes}</p>
                ) : null}
              </div>

              <div className="flex items-center gap-2 lg:block">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 lg:hidden">AI</div>
                <div className="text-sm font-semibold text-slate-700">
                  {dimension.aiScore === null ? "Pending" : `${formatReviewScore(dimension.aiScore)} / 4`}
                </div>
              </div>

              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                <span className="lg:sr-only">{dimension.label} reviewer score</span>
                <select
                  value={draft[definition.key].score}
                  disabled={isSaving}
                  onChange={(event) => updateScore(definition.key, Number(event.target.value))}
                  className={inputClass}
                >
                  {reviewScoreOptions.map((score) => (
                    <option key={score} value={score}>
                      {formatReviewScore(score)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                <span className="lg:sr-only">{dimension.label} reviewer notes</span>
                <textarea
                  value={draft[definition.key].notes}
                  disabled={isSaving}
                  onChange={(event) => updateNotes(definition.key, event.target.value)}
                  className={textareaClass}
                  placeholder="Reviewer notes"
                />
              </label>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {visibleStatus ? (
          <div
            role="status"
            aria-live="polite"
            className={cx(
              "text-sm font-medium",
              visibleStatus.tone === "error"
                ? "text-rose-700"
                : visibleStatus.tone === "success"
                  ? "text-emerald-700"
                  : "text-slate-600",
            )}
          >
            {visibleStatus.text}
          </div>
        ) : (
          <div className="text-sm text-slate-500">Changes are saved to reviewer feedback.</div>
        )}
        <button
          type="button"
          disabled={saveDisabled}
          onClick={() => void saveReview()}
          className={cx(primaryButtonClass, "sm:ml-auto disabled:cursor-not-allowed disabled:bg-slate-400")}
        >
          {isSaving ? "Saving..." : "Save human review"}
        </button>
      </div>
    </div>
  );
}
