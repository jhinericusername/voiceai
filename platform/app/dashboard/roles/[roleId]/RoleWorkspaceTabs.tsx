"use client";

import { useState } from "react";
import {
  EmptyState,
  StatusPill,
  cx,
} from "../../dashboard-ui";
import { ScoreTab } from "./ScoreTab";

type RoleTab = "Pipeline" | "Score" | "Rubric" | "Interviews" | "Reports";

const tabs: readonly RoleTab[] = ["Pipeline", "Score", "Rubric", "Interviews", "Reports"];

export function RoleWorkspaceTabs({
  roleLabel,
  ashbyJobIds,
}: {
  readonly roleLabel: string;
  readonly ashbyJobIds: readonly string[];
}) {
  const [activeTab, setActiveTab] = useState<RoleTab>("Pipeline");

  return (
    <section className="rounded-md border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-200 px-4 pt-3">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Role workspace tabs">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={cx(
                "min-h-10 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition",
                activeTab === tab
                  ? "border-cyan-600 text-slate-950"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900",
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {activeTab === "Pipeline" ? <PipelineTab roleLabel={roleLabel} /> : null}
        {activeTab === "Score" ? <ScoreTab availableJobIds={ashbyJobIds} /> : null}
        {activeTab === "Rubric" ? <RubricTab roleLabel={roleLabel} /> : null}
        {activeTab === "Interviews" ? <InterviewsTab roleLabel={roleLabel} /> : null}
        {activeTab === "Reports" ? <ReportsTab roleLabel={roleLabel} /> : null}
      </div>
    </section>
  );
}

function PipelineTab({ roleLabel }: { readonly roleLabel: string }) {
  const states = [
    ["Send interviews", "Applications from configured Ashby stages will appear here for this role."],
    ["Scheduled", "Candidates who have been sent or scheduled for a Puddle interview will appear here."],
    ["Needs review", "Completed interviews for this role will be reviewed against this role's rubric."],
  ] as const;

  return (
    <div className="grid gap-3">
      {states.map(([state, detail]) => (
        <section key={state} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={state} />
            <span className="text-sm font-semibold text-slate-950">{roleLabel}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
        </section>
      ))}
    </div>
  );
}

function RubricTab({ roleLabel }: { readonly roleLabel: string }) {
  return (
    <EmptyState
      title={`${roleLabel} rubric is not configured in Puddle yet`}
      detail="After Ashby stages and role rubrics sync, this tab will show the job-specific screening bar without placeholder criteria."
    />
  );
}

function InterviewsTab({ roleLabel }: { readonly roleLabel: string }) {
  return (
    <EmptyState
      title={`No ${roleLabel.toLowerCase()} interviews yet`}
      detail="Sent, scheduled, and completed AI interviews for this role will appear here after real Ashby applications are synced."
    />
  );
}

function ReportsTab({ roleLabel }: { readonly roleLabel: string }) {
  return (
    <EmptyState
      title={`${roleLabel} reports are pending`}
      detail="Comparative reports will appear after real candidates complete interviews and reviewers make decisions."
    />
  );
}
