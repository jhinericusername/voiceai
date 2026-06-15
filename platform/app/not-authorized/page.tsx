import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { allowedAuthDomainsLabel } from "@/lib/auth/allowed-domains";
import { noindexMetadata } from "@/lib/seo";

export const metadata: Metadata = noindexMetadata;

function firstSearchValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function NotAuthorizedPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{ readonly reason?: string | string[] }>;
}) {
  const reason = firstSearchValue((await searchParams)?.reason);
  const invitationRequired = reason === "invitation";
  const permissionRequired = reason === "permission";

  return (
    <main className="min-h-svh bg-[#eef7ff] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center justify-between rounded-lg border border-white/70 bg-white/70 p-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur">
          <Link href="/" className="flex items-center gap-3" aria-label="Puddle home">
            <Image src="/puddle-symbol-black-nobg.png" alt="" width={42} height={42} className="h-10 w-10" />
            <div>
              <div className="text-lg font-semibold">Puddle</div>
              <div className="text-sm text-slate-500">Enterprise interview platform</div>
            </div>
          </Link>
        </header>

        <section className="mt-8 rounded-lg border border-white/70 bg-white/[0.78] p-6 shadow-[0_22px_70px_rgba(15,23,42,0.09)] backdrop-blur">
          <div className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">Access restricted</div>
          <h1 className="mt-4 text-3xl font-semibold leading-tight text-slate-950 md:text-4xl">
            {invitationRequired
              ? "You need an invitation to this workspace."
              : permissionRequired
                ? "You do not have permission for this action."
                : "This workspace is limited to approved domains."}
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-600">
            {invitationRequired
              ? "Ask a workspace admin to invite your account to the correct WorkOS organization."
              : permissionRequired
                ? "Ask a workspace admin to update your role before trying again."
                : `Sign in with an email address from ${allowedAuthDomainsLabel()}.`}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="/logout"
              className="inline-flex min-h-10 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold !text-white transition hover:bg-slate-800"
            >
              Sign out
            </a>
            <Link
              href="/"
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            >
              Landing
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
