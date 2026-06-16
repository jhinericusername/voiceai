import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "../JsonLd";
import { PublicFooter } from "../PublicFooter";
import { PublicNav } from "../PublicNav";
import { publicRouteSeo } from "../publicRoutes";
import { resourcePages } from "./resources";
import { breadcrumbJsonLd, publicPageMetadata, webPageJsonLd } from "@/lib/seo";

export const dynamic = "force-static";

const route = publicRouteSeo.resources;

export const metadata: Metadata = publicPageMetadata(route);

export default function ResourcesPage() {
  return (
    <main className="puddle-page min-h-svh text-slate-950">
      <JsonLd
        data={[
          webPageJsonLd({ name: route.title, description: route.description, path: route.path }),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Resources", path: "/resources" },
          ]),
        ]}
      />
      <PublicNav />
      <section className="relative z-10 px-5 pb-16 pt-24 sm:px-6 lg:pt-28">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50/90 px-3 py-1.5 text-sm font-semibold text-cyan-900">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Resources
            </div>
            <h1 className="mt-6 text-3xl font-semibold leading-[1.04] tracking-normal text-slate-950 sm:text-4xl">
              Practical guides for structured AI hiring.
            </h1>
            <p className="mt-5 text-lg leading-8 text-slate-600">{route.description}</p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {resourcePages.map((resource) => (
              <article
                key={resource.slug}
                className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-[0_16px_44px_rgba(15,23,42,0.06)]"
              >
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
                  {resource.displayDate}
                </div>
                <h2 className="mt-4 text-xl font-semibold leading-7 text-slate-950">
                  <Link href={`/resources/${resource.slug}`} className="hover:text-cyan-800">
                    {resource.title}
                  </Link>
                </h2>
                <p className="mt-3 text-sm font-semibold leading-6 text-slate-700">{resource.question}</p>
                <p className="mt-3 text-sm leading-6 text-slate-600">{resource.description}</p>
                <Link
                  href={`/resources/${resource.slug}`}
                  className="mt-5 inline-flex rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                >
                  Read guide
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
