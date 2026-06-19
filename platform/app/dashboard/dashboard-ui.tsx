import type { ReactNode } from "react";

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function statusTone(status: string): string {
  switch (status) {
    case "Active":
    case "Available":
    case "Accepted":
    case "Advance":
    case "Advanced":
    case "Above bar":
    case "Asked":
    case "Joined":
    case "Review ready":
    case "Reviewed":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "In progress":
    case "In review":
    case "At bar":
    case "Recording":
    case "Recording finalizing":
    case "Finalizing":
    case "Opened":
    case "Sent":
    case "Scheduled":
      return "border-cyan-200 bg-cyan-50 text-cyan-800";
    case "Hold":
    case "Medium":
    case "Medium-low":
    case "Partially asked":
    case "Paused":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "Expired":
    case "Failed":
    case "High":
    case "Incomplete":
    case "Missing":
    case "Missed":
    case "Below bar":
    case "Pass":
    case "Passed":
      return "border-rose-200 bg-rose-50 text-rose-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

export function StatusPill({
  status,
  className,
}: {
  readonly status: string;
  readonly className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex min-h-6 items-center rounded-md border px-2 py-0.5 text-xs font-semibold leading-5",
        statusTone(status),
        className,
      )}
    >
      {status}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <div className="puddle-metric-card min-w-0 rounded-md border border-slate-200 bg-white/94 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-xs leading-5 text-slate-500">{detail}</div>
    </div>
  );
}

export function EmptyState({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <div className="puddle-empty-state rounded-md border border-dashed border-cyan-200 bg-cyan-50/40 px-4 py-6 text-center">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">{detail}</p>
    </div>
  );
}

export function SectionPanel({
  id,
  title,
  eyebrow,
  action,
  children,
  className,
}: {
  readonly id?: string;
  readonly title: string;
  readonly eyebrow?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section
      id={id}
      className={cx(
        "puddle-panel min-w-0 overflow-hidden rounded-md border border-slate-200 bg-white/94 shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        className,
      )}
    >
      <div className="puddle-panel-header flex min-w-0 flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">{eyebrow}</div>
          ) : null}
          <h2 className="mt-1 text-base font-semibold text-slate-950">{title}</h2>
        </div>
        {action ? <div className="flex max-w-full shrink-0 flex-wrap items-center justify-start gap-2 sm:justify-end">{action}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function TableScroller({ children }: { readonly children: ReactNode }) {
  return <div className="max-w-full overflow-x-auto pb-1">{children}</div>;
}

export function ScoreBadge({
  score,
  maxScore,
}: {
  readonly score: number | null;
  readonly maxScore: number;
}) {
  if (score === null) {
    return <span className="text-sm text-slate-400">Pending</span>;
  }

  const tone = score / maxScore >= 0.75 ? "text-emerald-800 bg-emerald-50" : score / maxScore >= 0.55 ? "text-amber-800 bg-amber-50" : "text-rose-800 bg-rose-50";

  return (
    <span className={cx("inline-flex min-h-7 items-center rounded-md px-2 text-sm font-semibold", tone)}>
      {score}/{maxScore}
    </span>
  );
}

export const tableHeaderClass =
  "bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500";

export const tableCellClass = "border-b border-slate-100 px-3 py-3 text-sm text-slate-700";

export const primaryButtonClass =
  "inline-flex min-h-9 max-w-full items-center justify-center truncate rounded-md bg-slate-950 px-3 text-sm font-semibold !text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)] transition hover:-translate-y-px hover:bg-slate-800 hover:shadow-[0_14px_34px_rgba(15,23,42,0.16)] focus:outline-none focus:ring-4 focus:ring-cyan-100";

export const secondaryButtonClass =
  "inline-flex min-h-9 max-w-full items-center justify-center truncate rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:-translate-y-px hover:border-cyan-200 hover:bg-cyan-50/50 hover:text-slate-950 hover:shadow-[0_10px_24px_rgba(8,145,178,0.08)] focus:outline-none focus:ring-4 focus:ring-cyan-100";
