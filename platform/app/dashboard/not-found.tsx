import Link from "next/link";
import { primaryButtonClass, secondaryButtonClass } from "./dashboard-ui";

export default function DashboardNotFound() {
  return (
    <div className="mx-auto max-w-2xl rounded-md border border-slate-200 bg-white px-5 py-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Not found</div>
      <h1 className="mt-2 text-2xl font-semibold text-slate-950">This dashboard record is unavailable</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        The role, candidate, or interview session may not exist in the current workspace data.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Link href="/dashboard" className={primaryButtonClass}>
          Workspace home
        </Link>
        <Link href="/dashboard/review-queue" className={secondaryButtonClass}>
          Review queue
        </Link>
      </div>
    </div>
  );
}
