import { ActiveRolesTable, ReadinessPanel } from "../DashboardSections";

export const dynamic = "force-dynamic";

export default function RolesPage() {
  return (
    <div className="mx-auto grid min-w-0 max-w-[1440px] gap-5">
      <header className="min-w-0 rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">Roles</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">How are roles progressing?</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Active hiring bars, review-ready counts, and rubric versions for the workspace.
        </p>
      </header>

      <ActiveRolesTable />
      <ReadinessPanel />
    </div>
  );
}
