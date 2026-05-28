import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { CreateInterviewCard } from "./CreateInterviewCard";
import { CreateTeamInvitationCard } from "./CreateTeamInvitationCard";
import { allowedAuthDomains, isAllowedAuthEmail } from "@/lib/auth/allowed-domains";

export const dynamic = "force-dynamic";

const setupItems = [
  ["Identity", "WorkOS AuthKit session active"],
  ["Enterprise", "Ready for SSO and Directory Sync onboarding"],
  ["Candidate access", "Keep invite links separate from staff accounts"],
  ["Next step", "Connect orgs, roles, and interview sessions"],
];

export default async function DashboardPage() {
  const { user, organizationId, roles, permissions } = await withAuth();

  if (!user) {
    redirect("/login?returnTo=/dashboard");
  }

  if (!isAllowedAuthEmail(user.email)) {
    redirect("/not-authorized");
  }

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  return (
    <main className="min-h-svh bg-[#eef7ff] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 rounded-lg border border-white/70 bg-white/70 p-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="flex items-center gap-3" aria-label="Puddle home">
            <Image src="/puddle-symbol-black-nobg.png" alt="" width={42} height={42} className="h-10 w-10" />
            <div>
              <div className="text-lg font-semibold">Puddle</div>
              <div className="text-sm text-slate-500">Enterprise interview platform</div>
            </div>
          </Link>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
            >
              Landing
            </Link>
            <a
              href="/logout"
              className="inline-flex min-h-10 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold !text-white transition hover:bg-slate-800"
            >
              Sign out
            </a>
          </div>
        </header>

        <section className="mt-8 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-lg border border-white/70 bg-white/[0.76] p-6 shadow-[0_22px_70px_rgba(15,23,42,0.09)] backdrop-blur">
            <div className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">Signed in</div>
            <h1 className="mt-4 text-3xl font-semibold leading-tight text-slate-950 md:text-5xl">
              Welcome, {displayName}.
            </h1>
            <p className="mt-5 text-base leading-7 text-slate-600">
              This is the protected customer workspace shell. Auth is now in place; the product data model can attach
              organizations, memberships, interview sessions, and reviewer workflows behind this boundary.
            </p>

            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Account</div>
              <dl className="mt-4 grid gap-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Email</dt>
                  <dd className="font-medium text-slate-950">{user.email}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">User ID</dt>
                  <dd className="break-all font-mono text-xs text-slate-700">{user.id}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Organization</dt>
                  <dd className="break-all font-mono text-xs text-slate-700">{organizationId ?? "not selected"}</dd>
                </div>
              </dl>
            </div>

            <CreateInterviewCard defaultCandidateEmail={user.email} />
            <CreateTeamInvitationCard allowedDomains={allowedAuthDomains()} />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-950 p-5 text-white shadow-[0_30px_90px_rgba(15,23,42,0.22)]">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-5">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-200/80">Auth status</div>
                <h2 className="mt-2 text-2xl font-semibold">WorkOS AuthKit connected</h2>
              </div>
              <span className="rounded-full border border-emerald-300/28 bg-emerald-300/12 px-3 py-1 text-xs font-medium text-emerald-100">
                Active
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {setupItems.map(([label, value]) => (
                <div key={label} className="rounded-lg border border-white/10 bg-white/[0.05] p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-white/45">{label}</div>
                  <div className="mt-2 text-sm font-medium leading-6 text-white/[0.86]">{value}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-lg border border-white/10 bg-black/25 p-4">
              <div className="text-sm font-semibold">Session claims</div>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <div className="text-white/45">Roles</div>
                  <div className="mt-1 text-white/80">{roles?.length ? roles.join(", ") : "none yet"}</div>
                </div>
                <div>
                  <div className="text-white/45">Permissions</div>
                  <div className="mt-1 text-white/80">
                    {permissions?.length ? permissions.join(", ") : "none yet"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
