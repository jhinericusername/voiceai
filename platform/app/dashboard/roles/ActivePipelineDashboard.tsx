"use client";

import { useMemo, useState } from "react";
import { DashboardCreateInterviewLauncher } from "../DashboardCreateInterviewLauncher";
import { BriefcaseIcon, UsersIcon } from "../dashboard-icons";
import { cx, EmptyState, formatDateTime, MetricCard, StatusPill } from "../dashboard-ui";

interface ActivePipelineStage {
  readonly name: string;
  readonly count: number;
}

interface ActivePipelineCandidate {
  readonly applicationId: string;
  readonly candidateId: string;
  readonly candidateName: string;
  readonly candidateEmail: string | null;
  readonly jobId: string;
  readonly currentStage: string;
  readonly source: string | null;
  readonly updatedAt: string | null;
}

interface ActivePipelineRole {
  readonly jobId: string;
  readonly name: string;
  readonly activeStageNames: readonly string[];
  readonly stageOptions: readonly ActivePipelineStage[];
  readonly activeCandidateCount: number;
  readonly candidates: readonly ActivePipelineCandidate[];
}

interface ActivePipeline {
  readonly lastSyncAt: string | null;
  readonly selectedJobCount: number;
  readonly totalSyncedCandidates: number;
  readonly activeCandidateCount: number;
  readonly candidateRowCount: number;
  readonly candidateRowsTruncated: boolean;
  readonly roles: readonly ActivePipelineRole[];
}

interface EditableRole extends ActivePipelineRole {
  readonly activeStageNames: string[];
}

function candidateCount(role: EditableRole): number {
  const activeStages = new Set(role.activeStageNames);
  return role.stageOptions.reduce(
    (total, stage) => total + (activeStages.has(stage.name) ? stage.count : 0),
    0,
  );
}

function totalActiveCandidates(roles: readonly EditableRole[]): number {
  return roles.reduce((total, role) => total + candidateCount(role), 0);
}

function editableRoles(roles: readonly ActivePipelineRole[]): EditableRole[] {
  return roles.map((role) => ({
    ...role,
    activeStageNames: [...role.activeStageNames],
  }));
}

function errorMessage(value: unknown): string {
  if (value && typeof value === "object" && "error" in value && typeof value.error === "string") {
    return value.error;
  }
  return "Stage settings could not be saved.";
}

export function ActivePipelineDashboard({
  pipeline,
  view = "roles",
  canManagePipelineStages,
}: {
  readonly pipeline: ActivePipeline;
  readonly view?: "roles" | "candidates";
  readonly canManagePipelineStages: boolean;
}) {
  const [roles, setRoles] = useState<EditableRole[]>(() => editableRoles(pipeline.roles));
  const [selectedJobId, setSelectedJobId] = useState(() => pipeline.roles[0]?.jobId ?? "");
  const [pendingStageKey, setPendingStageKey] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const selectedRole = roles.find((role) => role.jobId === selectedJobId) ?? roles[0] ?? null;
  const visibleCandidates = useMemo(() => {
    if (!selectedRole) {
      return [];
    }
    const activeStages = new Set(selectedRole.activeStageNames);
    return selectedRole.candidates.filter((candidate) => activeStages.has(candidate.currentStage));
  }, [selectedRole]);
  const activeCandidateTotal = totalActiveCandidates(roles);

  async function updateStage(jobId: string, stageName: string, enabled: boolean) {
    if (!canManagePipelineStages) {
      return;
    }

    const previousRoles = roles;
    const nextRoles = roles.map((role) => {
      if (role.jobId !== jobId) {
        return role;
      }
      const stageNames = enabled
        ? [...role.activeStageNames, stageName]
        : role.activeStageNames.filter((name) => name !== stageName);
      return {
        ...role,
        activeStageNames: [...new Set(stageNames)],
      };
    });

    setRoles(nextRoles);
    setPendingStageKey(`${jobId}:${stageName}`);
    setSaveMessage(null);

    try {
      const role = nextRoles.find((item) => item.jobId === jobId);
      const response = await fetch("/api/ashby/active-stages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jobId,
          activeStageNames: role?.activeStageNames ?? [],
        }),
      });
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(errorMessage(payload));
      }
      setSaveMessage("Stage settings saved.");
    } catch (error) {
      setRoles(previousRoles);
      setSaveMessage(error instanceof Error ? error.message : "Stage settings could not be saved.");
    } finally {
      setPendingStageKey(null);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <div className="shrink-0">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Selected roles"
            value={String(pipeline.selectedJobCount)}
            detail="Ashby roles configured for this workspace."
          />
          <MetricCard
            label="Synced active apps"
            value={String(pipeline.totalSyncedCandidates)}
            detail="Ashby applications with Active status."
          />
          <MetricCard
            label="Puddle-active"
            value={String(activeCandidateTotal)}
            detail="Visible candidates after role stage filters."
          />
          <MetricCard
            label="Last sync"
            value={pipeline.lastSyncAt ? formatDateTime(pipeline.lastSyncAt) : "Pending"}
            detail="Latest active candidate sync from Ashby."
          />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-[300px_minmax(0,1fr)]">
        <section className="min-h-0 overflow-hidden rounded-md border border-slate-200 bg-white/94 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">Roles</div>
            <h2 className="mt-1 text-base font-semibold text-slate-950">Active pipeline</h2>
          </div>
          <div className="grid gap-2 p-3">
            {roles.map((role) => {
              const active = role.jobId === selectedRole?.jobId;
              return (
                <button
                  key={role.jobId}
                  type="button"
                  onClick={() => setSelectedJobId(role.jobId)}
                  className={cx(
                    "min-h-16 rounded-md border px-3 py-2 text-left transition",
                    active
                      ? "border-cyan-200 bg-cyan-50/70 shadow-[0_10px_24px_rgba(8,145,178,0.08)]"
                      : "border-slate-200 bg-white hover:border-cyan-200 hover:bg-cyan-50/40",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <BriefcaseIcon className={cx("h-4 w-4 shrink-0", active ? "text-cyan-700" : "text-slate-500")} />
                    <span className="truncate text-sm font-semibold text-slate-950">{role.name}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <StatusPill status={`${candidateCount(role)} active`} className="min-h-5 py-0 text-[11px]" />
                    <span>{role.stageOptions.length} stages</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white/94 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          {selectedRole ? (
            <>
              <div className="shrink-0 border-b border-slate-200 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">
                      {view === "candidates" ? "Candidates" : "Role pipeline"}
                    </div>
                    <h2 className="mt-1 truncate text-base font-semibold text-slate-950">{selectedRole.name}</h2>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <DashboardCreateInterviewLauncher />
                    <StatusPill status={`${visibleCandidates.length} active`} />
                    <StatusPill status={pipeline.lastSyncAt ? "Synced" : "Sync pending"} />
                  </div>
                </div>

                <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {selectedRole.stageOptions.map((stage) => {
                    const checked = selectedRole.activeStageNames.includes(stage.name);
                    const pending = pendingStageKey === `${selectedRole.jobId}:${stage.name}`;
                    return (
                      <label
                        key={stage.name}
                        className={cx(
                          "flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 text-sm font-semibold transition",
                          checked
                            ? "border-cyan-200 bg-cyan-50/70 text-slate-950"
                            : "border-slate-200 bg-white text-slate-700",
                          canManagePipelineStages && !checked && "hover:border-cyan-200 hover:bg-cyan-50/40",
                          canManagePipelineStages ? "cursor-pointer" : "cursor-default",
                          pending && "opacity-60",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 rounded border-slate-300 text-cyan-700 accent-cyan-700"
                            checked={checked}
                            disabled={!canManagePipelineStages || pendingStageKey !== null}
                            onChange={(event) => updateStage(selectedRole.jobId, stage.name, event.currentTarget.checked)}
                          />
                          <span className="truncate">{stage.name}</span>
                        </span>
                        <span className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600">
                          {stage.count}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {saveMessage ? <div className="mt-2 text-xs font-medium text-slate-500">{saveMessage}</div> : null}
                {!canManagePipelineStages ? (
                  <div className="mt-2 text-xs font-medium text-slate-500">Stage filters are read-only for members.</div>
                ) : null}
              </div>

              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="shrink-0 border-b border-slate-100 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <UsersIcon className="h-4 w-4 text-cyan-700" aria-hidden="true" />
                    Active candidates
                  </div>
                  {pipeline.candidateRowsTruncated ? (
                    <div className="mt-2 text-xs font-medium text-slate-500">
                      Showing {pipeline.candidateRowCount} recent candidate rows. Stage counts include all active applications.
                    </div>
                  ) : null}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" data-active-candidate-scroll-region>
                  {visibleCandidates.length > 0 ? (
                    <div className="grid gap-2">
                      {visibleCandidates.map((candidate) => (
                        <div
                          key={candidate.applicationId}
                          className="grid min-h-16 gap-3 rounded-md border border-slate-200 bg-white px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-950">{candidate.candidateName}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                              {candidate.candidateEmail ? <span className="truncate">{candidate.candidateEmail}</span> : null}
                              {candidate.source ? <span className="truncate">{candidate.source}</span> : null}
                              {candidate.updatedAt ? <span>{formatDateTime(candidate.updatedAt)}</span> : null}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 md:justify-end">
                            <StatusPill status={candidate.currentStage} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title="No active candidates for this role"
                      detail="Choose a stage with candidates or run the Ashby active candidate sync."
                    />
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="p-4">
              <EmptyState
                title="No selected Ashby roles"
                detail="Select roles during Ashby setup before candidates can appear here."
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
