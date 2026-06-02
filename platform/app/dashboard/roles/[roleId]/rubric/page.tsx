import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardActionButton } from "../../../DashboardActionButton";
import { demoRoles, getRole } from "../../../demo-data";
import {
  SectionPanel,
  StatusPill,
  TableScroller,
  formatDate,
  secondaryButtonClass,
  tableCellClass,
  tableHeaderClass,
} from "../../../dashboard-ui";

export function generateStaticParams() {
  return demoRoles.map((role) => ({ roleId: role.id }));
}

export default async function RubricPage({ params }: { readonly params: Promise<{ roleId: string }> }) {
  const { roleId } = await params;
  const role = getRole(roleId);

  if (!role) {
    notFound();
  }

  return (
    <div className="mx-auto grid min-w-0 max-w-[1440px] gap-5">
      <header className="rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status="Active" />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Rubric builder shell</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">{role.title} rubric</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{role.hiringBar}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href={`/dashboard/roles/${role.id}`} className={secondaryButtonClass}>
              Back to role
            </Link>
            <DashboardActionButton action="interview">
              Create interview
            </DashboardActionButton>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Version</div>
          <div className="mt-2 text-xl font-semibold text-slate-950">{role.rubricVersion}</div>
          <div className="mt-1 text-xs text-slate-500">Updated {formatDate(role.rubricUpdatedAt)}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Used by</div>
          <div className="mt-2 text-xl font-semibold text-slate-950">{role.usedByInterviews} interviews</div>
          <div className="mt-1 text-xs text-slate-500">Current pilot rubric</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Scale</div>
          <div className="mt-2 text-xl font-semibold text-slate-950">0-4 per dimension</div>
          <div className="mt-1 text-xs text-slate-500">16 total points</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Questions</div>
          <div className="mt-2 text-xl font-semibold text-slate-950">{role.requiredQuestions.length} required</div>
          <div className="mt-1 text-xs text-slate-500">Coverage checked in reports</div>
        </div>
      </section>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <SectionPanel title="Dimension definitions" eyebrow="Scoring bar">
          <TableScroller>
            <table className="min-w-[960px] w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className={`${tableHeaderClass} rounded-l-md px-3 py-2`}>Dimension</th>
                  <th className={`${tableHeaderClass} px-3 py-2`}>Below bar</th>
                  <th className={`${tableHeaderClass} px-3 py-2`}>At bar</th>
                  <th className={`${tableHeaderClass} rounded-r-md px-3 py-2`}>Above bar</th>
                </tr>
              </thead>
              <tbody>
                {role.dimensions.map((dimension) => (
                  <tr key={dimension.name}>
                    <td className={`${tableCellClass} align-top`}>
                      <div className="font-semibold text-slate-950">{dimension.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{dimension.weight} points</div>
                    </td>
                    <td className={`${tableCellClass} align-top`}>{dimension.belowBar}</td>
                    <td className={`${tableCellClass} align-top`}>{dimension.atBar}</td>
                    <td className={`${tableCellClass} align-top`}>{dimension.aboveBar}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        </SectionPanel>

        <aside className="grid gap-5 xl:content-start">
          <SectionPanel title="Required questions" eyebrow="Coverage">
            <div className="grid gap-3">
              {role.requiredQuestions.map((question, index) => (
                <div key={question.id} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Prompt {index + 1}</div>
                    <StatusPill status={question.dimension} />
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{question.prompt}</p>
                </div>
              ))}
            </div>
          </SectionPanel>

          <SectionPanel title="Scoring scale" eyebrow="Reviewer calibration">
            <div className="grid gap-2 text-sm text-slate-700">
              {[
                ["0", "No usable evidence or answer did not address the prompt."],
                ["1", "Below bar with shallow, generic, or incomplete evidence."],
                ["2", "Mixed signal; some relevant evidence but meaningful gaps remain."],
                ["3", "At bar; clear evidence that satisfies the role expectation."],
                ["4", "Above bar; strong evidence under follow-up or changed constraints."],
              ].map(([score, definition]) => (
                <div key={score} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="font-semibold text-slate-950">{score}</div>
                  <div>{definition}</div>
                </div>
              ))}
            </div>
          </SectionPanel>
        </aside>
      </div>
    </div>
  );
}
