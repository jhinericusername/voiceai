"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { DocumentIcon } from "../dashboard-icons";
import { cx, EmptyState } from "../dashboard-ui";

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
  readonly ashbyUrl?: string | null;
  readonly linkedInUrl?: string | null;
  readonly resumeUrl?: string | null;
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

interface ExpandedStage {
  readonly jobId: string;
  readonly stageName: string;
}

const candidateDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  year: "numeric",
});

function roleTotalCount(role: ActivePipelineRole): number {
  return role.stageOptions.reduce((total, stage) => total + stage.count, 0);
}

function stageCandidates(role: ActivePipelineRole, stageName: string): readonly ActivePipelineCandidate[] {
  return role.candidates.filter((candidate) => candidate.currentStage === stageName);
}

function stageCount(role: ActivePipelineRole, stageName: string): number {
  return role.stageOptions.find((stage) => stage.name === stageName)?.count ?? 0;
}

function candidateRouteId(candidate: ActivePipelineCandidate): string {
  return candidate.candidateId.trim() || candidate.applicationId;
}

function candidateHref(candidate: ActivePipelineCandidate): string {
  return `/dashboard/roles/${encodeURIComponent(candidate.jobId)}/candidates/${encodeURIComponent(candidateRouteId(candidate))}`;
}

function candidateAshbyHref(candidate: ActivePipelineCandidate): string {
  const candidateId = candidate.candidateId.trim();
  return (
    candidate.ashbyUrl?.trim() ||
    `https://app.ashbyhq.com/candidate-searches/new/right-side/candidates/${encodeURIComponent(candidateId || candidate.applicationId)}`
  );
}

function formatCandidateDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return candidateDateFormatter.format(date);
}

function roleMatchesQuery(role: ActivePipelineRole, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return role.name.toLowerCase().includes(normalizedQuery);
}

function QuickCandidateLink({
  href,
  label,
  children,
  className,
}: {
  readonly href: string;
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border text-[11px] font-bold transition",
        "focus:outline-none focus:ring-4 focus:ring-cyan-100",
        className,
      )}
      data-candidate-quick-link
    >
      {children}
    </a>
  );
}

export function ActivePipelineDashboard({
  pipeline,
}: {
  readonly pipeline: ActivePipeline;
  readonly canManagePipelineStages: boolean;
}) {
  const [query, setQuery] = useState("");
  const [expandedStage, setExpandedStage] = useState<ExpandedStage | null>(null);

  const visibleRoles = useMemo(
    () => pipeline.roles.filter((role) => roleMatchesQuery(role, query)),
    [pipeline.roles, query],
  );

  function toggleStage(jobId: string, stageName: string) {
    setExpandedStage((current) => {
      if (current?.jobId === jobId && current.stageName === stageName) {
        return null;
      }
      return { jobId, stageName };
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-1 pb-6" data-role-phase-counts>
      <section className="rounded-md border border-slate-200 bg-white/95 px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">
              Pipeline dashboard
            </div>
            <h1 className="mt-1 text-2xl font-semibold leading-tight text-slate-950">Role Phase Counts</h1>
            <p className="mt-1 text-sm text-slate-600">
              Current candidate counts in active interview phases for each role.
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2">
            <div className="min-w-28 rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Roles</div>
              <div className="mt-1 text-lg font-semibold text-slate-950">{pipeline.selectedJobCount}</div>
            </div>
            <div className="min-w-36 rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Active candidates
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-950">{pipeline.activeCandidateCount}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white/95 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <label className="block text-xs font-medium text-slate-600" htmlFor="pipeline-role-search">
          Search roles
        </label>
        <div className="mt-1 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
          <input
            id="pipeline-role-search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Founding AI Engineer..."
            className="min-h-11 min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
          />
          <div className="inline-flex min-h-11 items-center justify-center rounded-md border border-cyan-200 bg-cyan-50/70 px-4 text-sm font-semibold text-cyan-800">
            Showing Open Roles
          </div>
        </div>
      </section>

      <div className="grid gap-3">
        {visibleRoles.length > 0 ? (
          visibleRoles.map((role) => {
            const selectedStageName = expandedStage?.jobId === role.jobId ? expandedStage.stageName : null;
            const selectedCandidates = selectedStageName ? stageCandidates(role, selectedStageName) : [];
            const selectedStageCount = selectedStageName ? stageCount(role, selectedStageName) : 0;

            return (
              <section
                key={role.jobId}
                className="overflow-hidden rounded-md border border-slate-200 bg-white/95 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                data-role-pipeline-row
              >
                <div className="px-4 py-4">
                  <h2 className="truncate text-xl font-semibold text-slate-950">{role.name}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex min-h-6 items-center rounded-full border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-600">
                      Open
                    </span>
                    <span className="inline-flex min-h-6 items-center rounded-full border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-600">
                      {roleTotalCount(role)} total
                    </span>
                    <span className="inline-flex min-h-6 items-center rounded-full border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-600">
                      {role.activeCandidateCount} active-stage
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3" data-role-stage-tile-list>
                  {role.stageOptions.map((stage) => {
                    const selected = selectedStageName === stage.name;
                    const hasCandidates = stage.count > 0;
                    return (
                      <button
                        key={stage.name}
                        type="button"
                        onClick={() => toggleStage(role.jobId, stage.name)}
                        aria-expanded={selected}
                        className={cx(
                          "grid h-14 w-[168px] shrink-0 content-center rounded-md border bg-white px-3 text-left transition",
                          "focus:outline-none focus:ring-4 focus:ring-cyan-100",
                          selected
                            ? "border-cyan-300 bg-cyan-50/60 shadow-[0_8px_18px_rgba(8,145,178,0.08)]"
                            : "border-slate-200 hover:border-cyan-200 hover:bg-cyan-50/30",
                          hasCandidates ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-slate-300",
                        )}
                        data-role-stage-button
                      >
                        <span className="truncate text-xs font-semibold text-slate-500">{stage.name}</span>
                        <span className="mt-1 text-lg font-semibold leading-none text-slate-950">{stage.count}</span>
                      </button>
                    );
                  })}
                </div>

                {selectedStageName ? (
                  <div className="border-t border-slate-100 bg-slate-50/45 px-4 py-3" data-stage-candidate-strip>
                    <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
                      <h3 className="truncate text-sm font-semibold text-slate-950">{selectedStageName}</h3>
                      <div className="shrink-0 text-sm font-medium text-slate-500">{selectedStageCount} people</div>
                    </div>

                    {selectedCandidates.length > 0 ? (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {selectedCandidates.map((candidate) => {
                          const dateLabel = formatCandidateDate(candidate.updatedAt);
                          return (
                            <article
                              key={candidate.applicationId}
                              className="grid h-[100px] w-[220px] shrink-0 grid-rows-[auto_minmax(0,1fr)_auto] rounded-md border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_1px_rgba(15,23,42,0.03)]"
                              data-candidate-mini-card
                            >
                              <div className="flex min-w-0 items-start justify-between gap-2">
                                <Link
                                  href={candidateHref(candidate)}
                                  prefetch={false}
                                  aria-label={`View ${candidate.candidateName}`}
                                  className="min-w-0 truncate text-sm font-semibold text-slate-950 hover:text-cyan-700 focus:outline-none focus:ring-4 focus:ring-cyan-100"
                                >
                                  {candidate.candidateName}
                                </Link>
                                <div className="flex shrink-0 items-center gap-1">
                                  {candidate.linkedInUrl ? (
                                    <QuickCandidateLink
                                      href={candidate.linkedInUrl}
                                      label={`Open ${candidate.candidateName} on LinkedIn`}
                                      className="border-blue-100 bg-blue-50 text-blue-700 hover:border-blue-200 hover:bg-blue-100"
                                    >
                                      in
                                    </QuickCandidateLink>
                                  ) : null}
                                  <QuickCandidateLink
                                    href={candidateAshbyHref(candidate)}
                                    label={`Open ${candidate.candidateName} in Ashby`}
                                    className="border-indigo-100 bg-indigo-50 text-indigo-700 hover:border-indigo-200 hover:bg-indigo-100"
                                  >
                                    A
                                  </QuickCandidateLink>
                                  {candidate.resumeUrl ? (
                                    <QuickCandidateLink
                                      href={candidate.resumeUrl}
                                      label={`Open ${candidate.candidateName} resume`}
                                      className="border-emerald-100 bg-emerald-50 text-emerald-700 hover:border-emerald-200 hover:bg-emerald-100"
                                    >
                                      <DocumentIcon className="h-3.5 w-3.5" aria-hidden="true" />
                                    </QuickCandidateLink>
                                  ) : null}
                                </div>
                              </div>

                              <div className="mt-1 min-w-0 overflow-hidden text-xs leading-4 text-slate-500">
                                {candidate.candidateEmail ? (
                                  <span className="break-all">{candidate.candidateEmail}</span>
                                ) : (
                                  <span>No email</span>
                                )}
                              </div>

                              {dateLabel ? (
                                <div className="mt-1">
                                  <span className="inline-flex min-h-5 items-center rounded-full border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-600">
                                    {dateLabel}
                                  </span>
                                </div>
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <EmptyState
                        title="No loaded candidates in this stage"
                        detail={
                          pipeline.candidateRowsTruncated
                            ? "Showing the most recent synced candidates. Refresh the Ashby sync to load more."
                            : "Run the Ashby active candidate sync to refresh this stage."
                        }
                      />
                    )}
                  </div>
                ) : null}
              </section>
            );
          })
        ) : (
          <EmptyState
            title="No matching roles"
            detail="Clear the role search or select roles during Ashby setup before candidates can appear here."
          />
        )}
      </div>
    </div>
  );
}
