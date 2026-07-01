"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RoleGradingProfile, RoleRubric, RoleRubricDimension } from "../../backend-data";
import {
  EmptyState,
  StatusPill,
  TableScroller,
  cx,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../dashboard-ui";
import type { AshbyJobReference } from "../ashby-role-labels";
import {
  buildRoleRubric,
  cloneRoleRubricDimension,
  initialDimensions,
  selectedDimensionError,
  weaveDimensionKeys,
  weaveDimensionLibrary,
  type WeaveDimensionKey,
} from "./role-rubric-model";

type SaveState = "idle" | "saving" | "approving";
type Feedback = {
  readonly tone: "success" | "error";
  readonly text: string;
};
type AnchorLevel = "1" | "2" | "3" | "4";
type SaveDraftOptions = {
  readonly refresh?: boolean;
};

const anchorLevels: readonly AnchorLevel[] = ["1", "2", "3", "4"];
const passionForSalesLabel = "Passion for Sales";

function isEditableDimensionKey(value: string): value is WeaveDimensionKey {
  return (weaveDimensionKeys as readonly string[]).includes(value);
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return fallback;
}

function rubricVersionId(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "rubricVersionId" in payload && typeof payload.rubricVersionId === "string") {
    return payload.rubricVersionId;
  }
  return null;
}

function orderSelectedDimensions(dimensions: readonly RoleRubricDimension[]): RoleRubricDimension[] {
  return weaveDimensionKeys.flatMap((key) => {
    const dimension = dimensions.find((candidate) => candidate.key === key);
    return dimension ? [dimension] : [];
  });
}

function statusClass(tone: Feedback["tone"] | "info"): string {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-800";
    default:
      return "border-cyan-200 bg-cyan-50 text-cyan-800";
  }
}

export function RoleRubricEditor({
  selectedRole,
  organizationId,
  profile,
}: {
  readonly selectedRole: AshbyJobReference;
  readonly organizationId: string;
  readonly profile: RoleGradingProfile | null;
}) {
  const router = useRouter();
  const persistedRubric = profile?.draft_rubric ?? profile?.active_rubric ?? null;
  const [dimensions, setDimensions] = useState<RoleRubricDimension[]>(() => initialDimensions(persistedRubric));
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [draftVersionId, setDraftVersionId] = useState<string | null>(() => profile?.draft_rubric_version_id ?? null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(() => profile?.active_rubric_version_id ?? null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [approvalConfirmation, setApprovalConfirmation] = useState(false);

  const selectedDimensionKeys = dimensions.flatMap((dimension) =>
    isEditableDimensionKey(dimension.key) ? [dimension.key] : [],
  );
  const selectedKeySet = new Set(selectedDimensionKeys);
  const validationMessage = selectedDimensionError(dimensions);
  const generationContext = persistedRubric?.generation_context;
  const currentRubric = buildRoleRubric({
    organizationId,
    ashbyJobId: selectedRole.jobId,
    title: selectedRole.name,
    dimensions,
    historicalSessionCount: generationContext?.historical_session_count,
    matchedApplicationCount: generationContext?.matched_application_count,
  });
  const isBusy = saveState !== "idle";
  const canSubmit = profile !== null && !validationMessage && !isBusy;
  const statusMessage = validationMessage
    ? { tone: "error" as const, text: validationMessage }
    : saveState === "saving"
      ? { tone: "info" as const, text: "Saving draft rubric..." }
      : saveState === "approving"
        ? { tone: "info" as const, text: "Approving draft rubric..." }
        : feedback ?? { tone: "info" as const, text: "Draft changes are local until saved." };
  const statusLabel = draftVersionId ? "Draft ready" : activeVersionId ? "Active Rubric" : "Rubric editor";
  const versionLabel = draftVersionId ?? activeVersionId ?? "unsaved";

  function toggleDimension(key: WeaveDimensionKey) {
    setFeedback(null);
    setApprovalConfirmation(false);
    setDimensions((current) => {
      if (current.some((dimension) => dimension.key === key)) {
        return current.filter((dimension) => dimension.key !== key);
      }
      return orderSelectedDimensions([...current, cloneRoleRubricDimension(weaveDimensionLibrary[key])]);
    });
  }

  function updateAnchor(dimensionKey: string, level: AnchorLevel, value: string) {
    setFeedback(null);
    setApprovalConfirmation(false);
    setDimensions((current) =>
      current.map((dimension) =>
        dimension.key === dimensionKey
          ? {
              ...dimension,
              anchors: {
                ...dimension.anchors,
                [level]: value,
              },
            }
          : dimension,
      ),
    );
  }

  function updateSubDimensionAnchor(dimensionKey: string, subDimensionKey: string, level: AnchorLevel, value: string) {
    setFeedback(null);
    setApprovalConfirmation(false);
    setDimensions((current) =>
      current.map((dimension) =>
        dimension.key === dimensionKey
          ? {
              ...dimension,
              sub_dimensions: dimension.sub_dimensions?.map((subDimension) =>
                subDimension.key === subDimensionKey
                  ? {
                      ...subDimension,
                      anchors: {
                        ...subDimension.anchors,
                        [level]: value,
                      },
                    }
                  : subDimension,
              ),
            }
          : dimension,
      ),
    );
  }

  async function saveDraft(rubric: RoleRubric = currentRubric, options: SaveDraftOptions = {}): Promise<string | null> {
    if (!profile) {
      setFeedback({ tone: "error", text: "Rubric profile is missing. Sync Ashby roles before saving." });
      return null;
    }
    if (validationMessage) {
      setFeedback({ tone: "error", text: validationMessage });
      return null;
    }

    setSaveState("saving");
    setFeedback(null);
    setApprovalConfirmation(false);
    try {
      const response = await fetch(`/api/grading/profiles/${encodeURIComponent(profile.profile_id)}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobName: selectedRole.name, rubric }),
      });
      const payload: unknown = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({ tone: "error", text: errorMessage(payload, "Could not save draft rubric.") });
        return null;
      }

      const versionId = rubricVersionId(payload);
      if (versionId) {
        setDraftVersionId(versionId);
      }
      setFeedback({ tone: "success", text: "Draft rubric saved." });
      if (options.refresh ?? true) {
        router.refresh();
      }
      return versionId;
    } catch {
      setFeedback({ tone: "error", text: "Could not reach the grading draft API." });
      return null;
    } finally {
      setSaveState("idle");
    }
  }

  async function approveDraft() {
    if (!profile) {
      setFeedback({ tone: "error", text: "Rubric profile is missing. Sync Ashby roles before approving." });
      return;
    }
    if (validationMessage) {
      setFeedback({ tone: "error", text: validationMessage });
      return;
    }

    const rubric = currentRubric;
    const versionId = draftVersionId ?? (await saveDraft(rubric, { refresh: false }));
    if (!versionId) {
      return;
    }

    setSaveState("approving");
    setFeedback(null);
    setApprovalConfirmation(false);
    try {
      const response = await fetch(`/api/grading/profiles/${encodeURIComponent(profile.profile_id)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rubricVersionId: versionId, rubric }),
      });
      const payload: unknown = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({ tone: "error", text: errorMessage(payload, "Could not approve draft rubric.") });
        return;
      }

      setActiveVersionId(versionId);
      setDraftVersionId(null);
      setFeedback({ tone: "success", text: "Draft rubric approved." });
      setApprovalConfirmation(true);
    } catch {
      setFeedback({ tone: "error", text: "Could not reach the grading approval API." });
    } finally {
      setSaveState("idle");
    }
  }

  if (!profile) {
    return (
      <EmptyState
        title="Rubric profile missing"
        detail="Sync Ashby roles to create the grading profile for this role before editing its rubric."
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex min-w-0 flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={statusLabel} />
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">{selectedRole.name}</span>
          </div>
          <h2 className="mt-2 text-base font-semibold text-slate-950">Role rubric</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Select the dimensions for this role, tune score anchors, then save or approve the stored draft version.
          </p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <button type="button" className={secondaryButtonClass} disabled={!canSubmit} onClick={() => void saveDraft()}>
            Save draft
          </button>
          <button type="button" className={primaryButtonClass} disabled={!canSubmit} onClick={() => void approveDraft()}>
            Approve draft
          </button>
        </div>
      </div>

      <div
        role="status"
        aria-live="polite"
        className={cx("rounded-md border px-3 py-2 text-sm font-medium", statusClass(statusMessage.tone))}
      >
        {statusMessage.text}
      </div>

      {approvalConfirmation ? (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed bottom-4 left-4 right-4 z-50 rounded-md border border-emerald-200 bg-white px-4 py-4 text-sm shadow-[0_20px_50px_rgba(15,23,42,0.18)] sm:left-auto sm:max-w-sm"
        >
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <StatusPill status="Active Rubric" />
              <h3 className="mt-2 text-sm font-semibold text-slate-950">Draft approved</h3>
              <p className="mt-1 leading-6 text-slate-600">
                This rubric is now active for future grading on this role.
              </p>
            </div>
            <button
              type="button"
              aria-label="Dismiss approval confirmation"
              onClick={() => setApprovalConfirmation(false)}
              className="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 focus:outline-none focus:ring-4 focus:ring-emerald-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <section className="grid gap-3 rounded-md border border-slate-200 bg-white px-3 py-3">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">Dimensions</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {selectedDimensionKeys.length} selected · version {versionLabel}
            </p>
          </div>
          <StatusPill status={`${selectedDimensionKeys.length}/6 selected`} />
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {weaveDimensionKeys.map((key) => {
            const libraryDimension = weaveDimensionLibrary[key];
            const label = key === "passion_for_sales" ? passionForSalesLabel : libraryDimension.name;
            const selected = selectedKeySet.has(key);
            return (
              <label
                key={key}
                className={cx(
                  "grid min-h-24 cursor-pointer gap-2 rounded-md border px-3 py-3 transition",
                  selected
                    ? "border-cyan-300 bg-cyan-50/70 text-slate-950"
                    : "border-slate-200 bg-white text-slate-700 hover:border-cyan-200 hover:bg-cyan-50/40",
                )}
              >
                <span className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={isBusy}
                    onChange={() => toggleDimension(key)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-700 focus:ring-cyan-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">{libraryDimension.meaning}</span>
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <div className="grid gap-3">
        {dimensions.map((dimension) => (
          <DimensionEditor
            key={dimension.key}
            dimension={dimension}
            disabled={isBusy}
            onAnchorChange={updateAnchor}
            onSubDimensionAnchorChange={updateSubDimensionAnchor}
          />
        ))}
      </div>
    </div>
  );
}

function DimensionEditor({
  dimension,
  disabled,
  onAnchorChange,
  onSubDimensionAnchorChange,
}: {
  readonly dimension: RoleRubricDimension;
  readonly disabled: boolean;
  readonly onAnchorChange: (dimensionKey: string, level: AnchorLevel, value: string) => void;
  readonly onSubDimensionAnchorChange: (
    dimensionKey: string,
    subDimensionKey: string,
    level: AnchorLevel,
    value: string,
  ) => void;
}) {
  const subDimensions = dimension.sub_dimensions ?? [];

  return (
    <section className="grid gap-3 rounded-md border border-slate-200 bg-white px-3 py-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-950">{dimension.name}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">{dimension.meaning}</p>
      </div>

      <AnchorTable
        label={`${dimension.name} anchors`}
        anchors={dimension.anchors}
        disabled={disabled}
        onChange={(level, value) => onAnchorChange(dimension.key, level, value)}
      />

      {subDimensions.length > 0 ? (
        <div className="grid gap-3 border-t border-slate-100 pt-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Sub-dimensions</div>
          {subDimensions.map((subDimension) => (
            <section key={subDimension.key} className="grid gap-2 rounded-md border border-slate-100 bg-slate-50/60 px-3 py-3">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">{subDimension.name}</h4>
              </div>
              <AnchorTable
                label={`${subDimension.name} anchors`}
                anchors={subDimension.anchors}
                disabled={disabled}
                onChange={(level, value) => onSubDimensionAnchorChange(dimension.key, subDimension.key, level, value)}
              />
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AnchorTable({
  label,
  anchors,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly anchors: Record<string, string>;
  readonly disabled: boolean;
  readonly onChange: (level: AnchorLevel, value: string) => void;
}) {
  return (
    <TableScroller>
      <table className="min-w-full border-separate border-spacing-0" aria-label={label}>
        <thead>
          <tr>
            <th className="w-20 border-b border-slate-100 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-500">
              Score
            </th>
            <th className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-left text-xs font-semibold text-slate-500">
              Anchor
            </th>
          </tr>
        </thead>
        <tbody>
          {anchorLevels.map((level) => (
            <tr key={level}>
              <td className="border-b border-slate-100 px-3 py-2 align-top text-sm font-semibold text-slate-700">
                {level}
              </td>
              <td className="border-b border-slate-100 px-3 py-2">
                <textarea
                  value={anchors[level] ?? ""}
                  disabled={disabled}
                  onChange={(event) => onChange(level, event.target.value)}
                  rows={2}
                  className="min-h-16 w-full min-w-[320px] resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-5 text-slate-950 outline-none transition disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
