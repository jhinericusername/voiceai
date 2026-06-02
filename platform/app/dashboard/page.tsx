import { NeedsReviewQueue, OperationalHealthPanel, RecentActivity, WorkspaceMetricStrip } from "./DashboardSections";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <div className="mx-auto grid min-w-0 max-w-[1440px] gap-5">
      <WorkspaceMetricStrip />

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 gap-5">
          <NeedsReviewQueue limit={3} />
          <RecentActivity limit={4} />
        </div>

        <aside className="grid min-w-0 gap-4 xl:content-start">
          <OperationalHealthPanel />
        </aside>
      </div>
    </div>
  );
}
