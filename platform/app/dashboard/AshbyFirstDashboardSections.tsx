import Link from "next/link";
import { ArrowRight, ClipboardCheck, Send, Users, Video } from "lucide-react";
import { EmptyState, formatDateTime, SectionPanel, StatusPill, secondaryButtonClass } from "./dashboard-ui";

export function SetupProgressSummary({
  selectedJobCount,
  lastSyncAt,
}: {
  readonly selectedJobCount: number;
  readonly lastSyncAt: string | null;
}) {
  return (
    <SectionPanel
      title="Ashby pipeline"
      eyebrow="Connected"
      action={<StatusPill status={lastSyncAt ? "Synced" : "Sync pending"} />}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-sm font-semibold text-slate-950">
            {selectedJobCount} selected {selectedJobCount === 1 ? "role" : "roles"}
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Puddle uses selected Ashby roles to organize interview sending, scheduling, and review queues.
          </p>
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-950">Last candidate sync</div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {lastSyncAt ? formatDateTime(lastSyncAt) : "Run the active candidate sync from Ashby setup."}
          </p>
        </div>
      </div>
    </SectionPanel>
  );
}

export function RolesPipelineFoundation({
  selectedJobCount,
  lastSyncAt,
}: {
  readonly selectedJobCount: number;
  readonly lastSyncAt: string | null;
}) {
  const states = [
    {
      title: "Send interviews",
      icon: Send,
      detail: "Applications from configured Ashby stages will appear here for bulk or single-candidate sending.",
    },
    {
      title: "Scheduled",
      icon: Video,
      detail:
        "Puddle marks interviews as sent or scheduled immediately. Calendar booking support should replace immediate scheduling when Cal integration ships.",
    },
    {
      title: "Needs review",
      icon: ClipboardCheck,
      detail: "Completed interviews are reviewed inside the role they belong to so the rubric stays job-specific.",
    },
  ] as const;

  return (
    <div className="space-y-4">
      <SetupProgressSummary selectedJobCount={selectedJobCount} lastSyncAt={lastSyncAt} />

      <SectionPanel title="Interviewing pipeline" eyebrow="Roles first">
        <div className="grid gap-3 lg:grid-cols-3">
          {states.map((state) => {
            const Icon = state.icon;
            return (
              <div key={state.title} className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                  <Icon className="h-4 w-4 text-cyan-700" aria-hidden="true" />
                  {state.title}
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{state.detail}</p>
              </div>
            );
          })}
        </div>
        {selectedJobCount === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Select Ashby roles to build the pipeline"
              detail="A workspace admin can return to Ashby setup and choose which roles Puddle should screen."
            />
          </div>
        ) : null}
      </SectionPanel>
    </div>
  );
}

export function CandidateApplicationsFoundation({
  lastSyncAt,
}: {
  readonly lastSyncAt: string | null;
}) {
  return (
    <SectionPanel
      title="Candidates"
      eyebrow="Applications"
      action={<StatusPill status={lastSyncAt ? "Synced from Ashby" : "Sync pending"} />}
    >
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm leading-6 text-slate-600">
            This page will show synced Ashby applications for the roles selected during onboarding.
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Global Cmd+K search is scoped to candidates and applications.
          </p>
        </div>
        <Link href="/dashboard/roles" className={secondaryButtonClass}>
          View roles
          <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </SectionPanel>
  );
}

export function ReviewRolePickerFoundation({
  selectedJobCount,
}: {
  readonly selectedJobCount: number;
}) {
  return (
    <SectionPanel
      title="Review Queue"
      eyebrow="Role required"
      action={<StatusPill status="Role picker required" />}
    >
      <div className="space-y-4">
        <p className="max-w-3xl text-sm leading-6 text-slate-600">
          Choose a role before reviewing interviews. FDE, MLE, and GTM Engineer reviews stay separate because each
          role uses its own rubric and decision criteria.
        </p>
        {selectedJobCount > 0 ? (
          <button type="button" disabled className={secondaryButtonClass}>
            Role picker appears after role names sync
          </button>
        ) : (
          <EmptyState
            title="No selected Ashby roles yet"
            detail="Finish Ashby job selection before review queues are available."
          />
        )}
      </div>
    </SectionPanel>
  );
}

export function OperationalPlaceholderPage({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <SectionPanel title={title} eyebrow="Puddle">
      <div className="flex min-w-0 items-start gap-3">
        <Users className="mt-0.5 h-5 w-5 shrink-0 text-cyan-700" aria-hidden="true" />
        <p className="text-sm leading-6 text-slate-600">{detail}</p>
      </div>
    </SectionPanel>
  );
}
