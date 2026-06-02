import Link from "next/link";
import { PublicFooter } from "./PublicFooter";
import { PublicNav } from "./PublicNav";

export interface PublicPageSection {
  readonly title: string;
  readonly body: string;
}

export interface PublicPageLink {
  readonly label: string;
  readonly href: string;
}

export interface PublicPageContent {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly metric?: string;
  readonly metricLabel?: string;
  readonly points: readonly string[];
  readonly sections: readonly PublicPageSection[];
  readonly related?: readonly PublicPageLink[];
}

export function PublicPageShell({ page }: { readonly page: PublicPageContent }) {
  return (
    <main className="puddle-page min-h-svh text-slate-950">
      <PublicNav />
      <section className="relative z-10 px-5 pb-16 pt-32 sm:px-6 lg:pt-36">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:items-end">
            <div>
              <div className="inline-flex items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50/90 px-3 py-1.5 text-sm font-semibold text-cyan-900 shadow-[0_12px_34px_rgba(8,145,178,0.1)]">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {page.eyebrow}
              </div>
              <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-[1.02] tracking-normal text-slate-950 sm:text-5xl lg:text-6xl">
                {page.title}
              </h1>
              <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600">{page.description}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="mailto:hello@usepuddle.com"
                  className="inline-flex min-h-12 items-center justify-center rounded-md bg-slate-950 px-6 text-base font-semibold !text-white shadow-[0_18px_46px_rgba(15,23,42,0.2)] transition hover:-translate-y-0.5 hover:bg-slate-800"
                >
                  Book a pilot
                </a>
                <Link
                  href="/sample-report"
                  className="inline-flex min-h-12 items-center justify-center rounded-md border border-slate-300 bg-white px-6 text-base font-semibold !text-slate-900 transition hover:-translate-y-0.5 hover:border-slate-400"
                >
                  View sample report
                </Link>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white/90 shadow-[0_28px_90px_rgba(15,23,42,0.12)] backdrop-blur-xl">
              <div className="border-b border-slate-200 bg-slate-950 p-5 text-white">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-md bg-emerald-400/12 px-2.5 py-1 text-xs font-semibold text-emerald-100">
                    Puddle overview
                  </span>
                  {page.metric ? <span className="text-xs text-white/55">{page.metric}</span> : null}
                </div>
                <h2 className="mt-5 text-2xl font-semibold">{page.metricLabel ?? "What this page will answer"}</h2>
              </div>
              <div className="grid gap-px bg-slate-200 sm:grid-cols-2">
                {page.points.map((point, index) => (
                  <div key={point} className="bg-white p-5">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <p className="mt-4 text-sm leading-6 text-slate-700">{point}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {page.sections.map((section) => (
              <article key={section.title} className="rounded-lg border border-slate-200 bg-white/85 p-5 shadow-[0_16px_44px_rgba(15,23,42,0.06)]">
                <h2 className="text-lg font-semibold text-slate-950">{section.title}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">{section.body}</p>
              </article>
            ))}
          </div>

          {page.related?.length ? (
            <div className="mt-10 rounded-lg border border-slate-200 bg-white/80 p-5">
              <div className="text-sm font-semibold text-slate-950">Related pages</div>
              <div className="mt-4 flex flex-wrap gap-2">
                {page.related.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
