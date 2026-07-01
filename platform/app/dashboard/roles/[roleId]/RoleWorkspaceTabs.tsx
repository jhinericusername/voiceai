"use client";

import { useState } from "react";
import {
  EmptyState,
  StatusPill,
  cx,
} from "../../dashboard-ui";
import type { RoleGradingProfile } from "../../backend-data";
import type { AshbyJobReference } from "../ashby-role-labels";
import { RoleRubricEditor } from "./RoleRubricEditor";
import { ScoreTab } from "./ScoreTab";

type RoleTab = "Pipeline" | "Score" | "Rubric" | "Interviews" | "Reports";

const tabs: readonly RoleTab[] = ["Pipeline", "Score", "Rubric", "Interviews", "Reports"];

export function RoleWorkspaceTabs({
  selectedRole,
  ashbyJobs,
  gradingProfile,
  organizationId,
}: {
  readonly selectedRole: AshbyJobReference;
  readonly ashbyJobs: readonly AshbyJobReference[];
  readonly gradingProfile: RoleGradingProfile | null;
  readonly organizationId: string;
}) {
  const [activeTab, setActiveTab] = useState<RoleTab>("Pipeline");
  const roleLabel = selectedRole.name;
  const rubricEditorKey = [
    selectedRole.jobId,
    gradingProfile?.profile_id ?? "missing-profile",
    gradingProfile?.draft_rubric_version_id ?? "no-draft",
    gradingProfile?.active_rubric_version_id ?? "no-active",
  ].join(":");

  return (
    <section className="puddle-panel overflow-hidden rounded-md border border-slate-200 bg-white/94 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="puddle-panel-header border-b border-slate-200 px-4 pt-3">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Role workspace tabs">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={cx(
                "min-h-10 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition hover:-translate-y-px",
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
        {activeTab === "Score" ? <ScoreTab jobId={selectedRole.jobId} availableJobs={ashbyJobs} /> : null}
        {activeTab === "Rubric" ? (
          <RoleRubricEditor
            key={rubricEditorKey}
            selectedRole={selectedRole}
            organizationId={organizationId}
            profile={gradingProfile}
          />
        ) : null}
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
        <section key={state} className="puddle-dashboard-card rounded-md border border-slate-200 bg-white/88 px-3 py-3">
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
