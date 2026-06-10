import {
  ActiveInterviewPanel,
  NeedsReviewQueue,
  OperationalHealthPanel,
  RecentActivity,
  WorkspaceMetricStrip,
} from "./DashboardSections";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5">
      <header className="min-w-0 rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">Interview review desk</div>
        <div className="mt-2 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-slate-950 sm:text-3xl">Review interviews before decisions move</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Open each completed interview to inspect video, audio, transcript evidence, rubric scores, integrity signals, and the AI recommendation.
            </p>
          </div>
          <div className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-900">
            Human sign-off is required for every recommendation.
          </div>
        </div>
      </header>

      <WorkspaceMetricStrip />

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-5">
          <NeedsReviewQueue limit={3} />
          <RecentActivity limit={4} />
        </div>

        <aside className="grid min-w-0 gap-4 xl:content-start">
          <ActiveInterviewPanel />
          <OperationalHealthPanel />
        </aside>
      </div>
    </div>
  );
}
