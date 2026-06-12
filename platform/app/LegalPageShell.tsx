import Link from "next/link";
import { PublicFooter } from "./PublicFooter";
import { PublicNav } from "./PublicNav";

export interface LegalPageSection {
  readonly title: string;
  readonly body?: readonly string[];
  readonly bullets?: readonly string[];
}

export interface LegalPageContent {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly lastUpdated: string;
  readonly sections: readonly LegalPageSection[];
}

export function LegalPageShell({ page }: { readonly page: LegalPageContent }) {
  return (
    <main className="puddle-page min-h-svh bg-white text-slate-950">
      <PublicNav />
      <article className="relative z-10 px-5 pb-16 pt-24 sm:px-6 lg:pt-28">
        <div className="mx-auto max-w-4xl">
          <div className="inline-flex items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50/90 px-3 py-1.5 text-sm font-semibold text-cyan-900">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            {page.eyebrow}
          </div>
          <h1 className="mt-6 text-3xl font-semibold leading-[1.04] tracking-normal text-slate-950 sm:text-4xl">
            {page.title}
          </h1>
          <p className="mt-5 text-lg leading-8 text-slate-600">{page.description}</p>
          <p className="mt-4 text-sm font-medium text-slate-500">Last updated: {page.lastUpdated}</p>

          <div className="mt-10 border-y border-slate-200">
            {page.sections.map((section) => (
              <section key={section.title} className="border-b border-slate-200 py-8 last:border-b-0">
                <h2 className="text-2xl font-semibold text-slate-950">{section.title}</h2>
                {section.body?.map((paragraph) => (
                  <p key={paragraph} className="mt-4 text-base leading-8 text-slate-600">
                    {paragraph}
                  </p>
                ))}
                {section.bullets?.length ? (
                  <ul className="mt-4 grid gap-3">
                    {section.bullets.map((bullet) => (
                      <li key={bullet} className="flex gap-3 text-base leading-7 text-slate-600">
                        <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-600" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>

          <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
            Questions about these terms or notices can be sent to{" "}
            <a href="mailto:hello@usepuddle.com" className="font-semibold text-slate-950 hover:text-cyan-800">
              hello@usepuddle.com
            </a>
            . Candidates can also use that address to ask for accommodation, deletion, or an alternative process.
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Link
              href="/privacy"
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              Terms
            </Link>
            <Link
              href="/ai-interview-disclosure"
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              AI interview disclosure
            </Link>
            <Link
              href="/subprocessors"
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              Subprocessors
            </Link>
          </div>
        </div>
      </article>
      <PublicFooter />
    </main>
  );
}
