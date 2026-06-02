import { CandidateSnapshot, ReadinessPanel } from "../DashboardSections";

export const dynamic = "force-dynamic";

export default function CandidatesPage() {
  return (
    <div className="mx-auto grid min-w-0 max-w-[1440px] gap-5">
      <header className="min-w-0 rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">Candidates</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">Where is each candidate?</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Candidate pipeline status, invite state, reviewer assignment, and the next review artifact to open.
        </p>
      </header>

      <CandidateSnapshot />
      <ReadinessPanel />
    </div>
  );
}
