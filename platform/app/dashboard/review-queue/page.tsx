import Link from "next/link";
import { companyIdentityFromUser, getAshbyActivePipeline } from "@/lib/ashby/server";
import { ReviewRolePickerFoundation } from "../AshbyFirstDashboardSections";
import { requireDashboardUser } from "../auth";
import {
  dashboardOrgId,
  getRealInterviews,
  type RealInterviewListItem,
} from "../backend-data";
import {
  EmptyState,
  SectionPanel,
  StatusPill,
  formatDateTime,
} from "../dashboard-ui";
import { ashbyJobReferences } from "../roles/ashby-role-labels";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  const session = await requireDashboardUser("/dashboard/review-queue");
  const orgId = dashboardOrgId({ organizationId: session.organizationId, userId: session.user.id });
  const identity = companyIdentityFromUser({ email: session.user.email, organizationId: session.organizationId });
  const [pipeline, interviews] = await Promise.all([
    getAshbyActivePipeline(identity),
    getRealInterviews({ orgId }),
  ]);
  const ashbyJobs = ashbyJobReferences(pipeline.roles);
  const roleNameByJobId = new Map(ashbyJobs.map((role) => [role.jobId, role.name]));
  const sessionsNeedingReview = interviews.filter(needsHumanReview).slice(0, 20);

  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
      <header className="puddle-dashboard-hero-card overflow-hidden rounded-md border border-cyan-200 bg-white/94 px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={`${sessionsNeedingReview.length} needs review`} />
              <StatusPill status={`${interviews.length} interviews`} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Reviewer workflow</span>
            </div>
            <h1 className="mt-2 break-words text-2xl font-semibold text-slate-950 sm:text-3xl">
              Review Queue
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Confirm AI-generated scores for interviews with a recommendation packet that has not been reviewed by a human.
            </p>
          </div>
        </div>
      </header>

      <SectionPanel
        title="Human review queue"
        eyebrow="AI score ready"
        action={<StatusPill status={`${sessionsNeedingReview.length} needs review`} />}
      >
        {sessionsNeedingReview.length ? (
          <div className="grid max-h-[calc(100svh-18rem)] gap-2 overflow-y-auto pr-1" aria-label="Interviews needing human review">
            <div className="sticky top-0 z-10 hidden grid-cols-[minmax(180px,1.3fr)_minmax(160px,1fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)] gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 md:grid">
              <span>Candidate</span>
              <span>Role</span>
              <span>Interview</span>
              <span>Score</span>
              <span>Action</span>
            </div>

            {sessionsNeedingReview.map((session) => (
              <Link
                key={session.session_id}
                href={`/dashboard/interviews/${encodeURIComponent(session.session_id)}`}
                className="puddle-interactive-card grid min-w-0 gap-3 rounded-md border border-slate-200 bg-white/88 px-3 py-3 text-sm md:grid-cols-[minmax(180px,1.3fr)_minmax(160px,1fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)_minmax(120px,0.8fr)] md:items-center"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-950">{candidateLabel(session)}</span>
                  <span className="mt-1 block truncate text-xs text-slate-500">{session.candidate_email || "No email"}</span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-slate-700">{roleLabel(session, roleNameByJobId)}</span>
                  <span className="mt-1 block truncate text-xs text-slate-500">{currentStageLabel(session)}</span>
                </span>
                <span className="text-slate-600">{formatNullableDate(session.started_at ?? session.scheduled_at)}</span>
                <span>
                  <StatusPill status={hasRecommendationPacket(session) ? "AI score ready" : "Score pending"} />
                </span>
                <span className="inline-flex min-h-9 items-center justify-center rounded-md bg-slate-950 px-3 text-sm font-semibold text-white">
                  Review score
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No scores need review"
            detail="Interviews with AI-generated score data will appear here until a human reviewer signs off."
          />
        )}
      </SectionPanel>

      <ReviewRolePickerFoundation roles={ashbyJobReferences(pipeline.roles)} />
    </div>
  );
}

function needsHumanReview(session: RealInterviewListItem): boolean {
  return session.needs_human_review === true;
}

function hasRecommendationPacket(session: RealInterviewListItem): boolean {
  return session.has_recommendation_packet === true;
}

function candidateLabel(session: RealInterviewListItem): string {
  return sourceMetadataString(session.source_metadata, ["ashby", "selected", "candidateName"])
    || session.candidate_email?.trim()
    || "Candidate";
}

function roleLabel(session: RealInterviewListItem, roleNameByJobId: ReadonlyMap<string, string>): string {
  const jobId = sourceMetadataString(session.source_metadata, ["ashby", "selected", "jobId"]);
  if (!jobId) {
    return "Role not mapped";
  }
  return roleNameByJobId.get(jobId) ?? "Role not mapped";
}

function currentStageLabel(session: RealInterviewListItem): string {
  return sourceMetadataString(session.source_metadata, ["ashby", "selected", "currentStage"]) || "Stage not captured";
}

function sourceMetadataString(value: unknown, path: readonly string[]): string {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return "";
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current.trim() : "";
}

function formatNullableDate(value: string | null): string {
  return value ? formatDateTime(value) : "Not set";
}
