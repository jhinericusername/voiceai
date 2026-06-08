import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "../../JsonLd";
import { PublicFooter } from "../../PublicFooter";
import { PublicNav } from "../../PublicNav";
import { articleJsonLd, breadcrumbJsonLd, publicPageMetadata } from "@/lib/seo";
import { getResourcePage, resourcePages } from "../resources";

export const dynamic = "force-static";
export const dynamicParams = false;

interface ResourcePageProps {
  readonly params: Promise<{
    readonly slug: string;
  }>;
}

export function generateStaticParams() {
  return resourcePages.map((resource) => ({ slug: resource.slug }));
}

export async function generateMetadata({ params }: ResourcePageProps): Promise<Metadata> {
  const { slug } = await params;
  const resource = getResourcePage(slug);

  if (!resource) {
    return {};
  }

  return publicPageMetadata({
    title: `${resource.title} | Puddle`,
    description: resource.description,
    path: `/resources/${resource.slug}`,
  });
}

export default async function ResourceArticlePage({ params }: ResourcePageProps) {
  const { slug } = await params;
  const resource = getResourcePage(slug);

  if (!resource) {
    notFound();
  }

  const path = `/resources/${resource.slug}`;

  return (
    <main className="puddle-page min-h-svh bg-white text-slate-950">
      <JsonLd
        data={[
          articleJsonLd({
            title: resource.title,
            description: resource.description,
            path,
            datePublished: resource.publishedAt,
            authorName: resource.byline,
          }),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Resources", path: "/resources" },
            { name: resource.title, path },
          ]),
        ]}
      />
      <PublicNav />
      <article className="relative z-10 px-5 pb-16 pt-32 sm:px-6 lg:pt-36">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="max-w-4xl">
            <Link
              href="/resources"
              className="inline-flex rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              Resources
            </Link>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.04] tracking-normal text-slate-950 sm:text-5xl">
              {resource.title}
            </h1>
            <p className="mt-5 text-xl font-semibold leading-8 text-slate-700">{resource.question}</p>
            <p className="mt-5 text-lg leading-8 text-slate-600">{resource.summary}</p>
            <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium text-slate-500">
              <span>{resource.byline}</span>
              <span>{resource.displayDate}</span>
            </div>

            <div className="mt-10 border-y border-slate-200">
              {resource.sections.map((section) => (
                <section key={section.heading} className="border-b border-slate-200 py-8 last:border-b-0">
                  <h2 className="text-2xl font-semibold text-slate-950">{section.heading}</h2>
                  {section.paragraphs?.map((paragraph) => (
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
                  {section.example ? (
                    <div className="mt-5 rounded-lg border border-cyan-100 bg-cyan-50/70 p-5">
                      <div className="text-sm font-semibold text-cyan-950">{section.example.title}</div>
                      <ul className="mt-3 grid gap-2">
                        {section.example.items.map((item) => (
                          <li key={item} className="flex gap-3 text-sm leading-6 text-cyan-950/80">
                            <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-700" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
          </div>

          <aside className="lg:sticky lg:top-28 lg:self-start">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
              <div className="text-sm font-semibold text-slate-950">Related pages</div>
              <div className="mt-4 grid gap-2">
                {resource.related.map((link) => (
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
          </aside>
        </div>
      </article>
      <PublicFooter />
    </main>
  );
}
