"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CreateInterviewCard } from "./CreateInterviewCard";
import { CreateTeamInvitationCard } from "./CreateTeamInvitationCard";
import { cx, primaryButtonClass, secondaryButtonClass } from "./dashboard-ui";

interface RoleOption {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

interface DashboardChromeProps {
  readonly children: ReactNode;
  readonly displayName: string;
  readonly email: string;
  readonly allowedDomains: readonly string[];
  readonly roles: readonly RoleOption[];
}

const navItems = [
  { label: "Overview", href: "/dashboard", match: "overview" },
  { label: "Roles", href: "/dashboard/roles", match: "roles" },
  { label: "Review Queue", href: "/dashboard/review-queue", match: "review" },
  { label: "Candidates", href: "/dashboard/candidates", match: "candidates" },
  { label: "Team", href: "/dashboard/team", match: "team" },
] as const;

function roleIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/dashboard\/roles\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function navIsActive(pathname: string, match: (typeof navItems)[number]["match"]): boolean {
  if (match === "overview") return pathname === "/dashboard";
  if (match === "roles") return pathname === "/dashboard/roles" || (pathname.startsWith("/dashboard/roles/") && !pathname.includes("/candidates/"));
  if (match === "review") return pathname.startsWith("/dashboard/review-queue") || pathname.startsWith("/dashboard/interviews");
  if (match === "candidates") return pathname.startsWith("/dashboard/candidates") || pathname.includes("/candidates/");
  if (match === "team") return pathname.startsWith("/dashboard/team");
  return false;
}

export function DashboardChrome({ children, displayName, email, allowedDomains, roles }: DashboardChromeProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [activeDialog, setActiveDialog] = useState<"interview" | "invite" | null>(null);
  const selectedRoleId = roleIdFromPath(pathname) ?? "overview";

  useEffect(() => {
    if (!activeDialog) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveDialog(null);
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [activeDialog]);

  useEffect(() => {
    function openDashboardAction(event: Event) {
      const action = (event as CustomEvent<{ action?: "interview" | "invite" }>).detail?.action;
      if (action === "interview" || action === "invite") {
        setActiveDialog(action);
      }
    }

    window.addEventListener("puddle-dashboard-action", openDashboardAction);
    return () => window.removeEventListener("puddle-dashboard-action", openDashboardAction);
  }, []);

  return (
    <div className="min-h-svh min-w-0 overflow-x-clip bg-white text-slate-950 lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="hidden min-w-0 border-r border-slate-200 bg-slate-50/80 lg:block">
        <div className="sticky top-0 flex h-svh min-h-0 flex-col">
          <div className="shrink-0 border-b border-slate-200 px-5 py-5">
            <Link href="/dashboard" className="flex items-center gap-3" aria-label="Puddle dashboard">
              <Image src="/puddle-symbol-black-nobg.png" alt="" width={36} height={36} className="h-9 w-9" />
              <div>
                <div className="text-sm font-semibold text-slate-950">Puddle</div>
                <div className="text-xs text-slate-500">Hiring workspace</div>
              </div>
            </Link>
          </div>

          <nav className="grid flex-1 content-start gap-1 overflow-y-auto px-3 py-4" aria-label="Dashboard">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={cx(
                  "rounded-md px-3 py-2 text-sm font-medium transition",
                  navIsActive(pathname, item.match)
                    ? "bg-white text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
                    : "text-slate-600 hover:bg-white hover:text-slate-950",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="shrink-0 border-t border-slate-200 px-5 pb-6 pt-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Signed in</div>
            <div className="mt-2 truncate text-sm font-semibold text-slate-950">{displayName}</div>
            <div className="truncate text-xs text-slate-500">{email}</div>
            <a href="/logout" className="mt-3 inline-flex text-sm font-semibold text-slate-700 hover:text-slate-950">
              Sign out
            </a>
          </div>
        </div>
      </aside>

      <div className="min-w-0 overflow-x-clip">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex flex-col gap-3 px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between gap-3 lg:hidden">
              <Link href="/dashboard" className="flex items-center gap-2" aria-label="Puddle dashboard">
                <Image src="/puddle-symbol-black-nobg.png" alt="" width={32} height={32} className="h-8 w-8" />
                <span className="text-sm font-semibold text-slate-950">Puddle</span>
              </Link>
              <a href="/logout" className={secondaryButtonClass}>
                Sign out
              </a>
            </div>

            <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Puddle Hiring Workspace</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                  <span className="font-medium text-slate-900">Pilot review desk</span>
                  <span>{displayName}</span>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                <label className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-700">
                  <span className="shrink-0">Active role</span>
                  <select
                    value={selectedRoleId}
                    onChange={(event) => {
                      const nextRoleId = event.target.value;
                      router.push(nextRoleId === "overview" ? "/dashboard" : `/dashboard/roles/${nextRoleId}`);
                    }}
                    className="min-h-9 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-950 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 sm:w-72"
                  >
                    <option value="overview">Workspace overview</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.title}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex min-w-0 flex-wrap gap-2">
                  <button type="button" onClick={() => setActiveDialog("interview")} className={primaryButtonClass}>
                    Create interview
                  </button>
                  <button type="button" onClick={() => setActiveDialog("invite")} className={secondaryButtonClass}>
                    Invite teammate
                  </button>
                </div>
              </div>
            </div>

            <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 pt-2 lg:hidden" aria-label="Dashboard">
              {navItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className={cx(
                    "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition",
                    navIsActive(pathname, item.match)
                      ? "bg-slate-950 !text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        <main className="min-w-0 overflow-x-clip px-4 py-5 sm:px-5">{children}</main>
      </div>

      {activeDialog ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/35 px-4 py-6 backdrop-blur-sm sm:py-10"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setActiveDialog(null);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-action-dialog-title"
            className="w-full max-w-md overflow-hidden rounded-md border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">
                  {activeDialog === "interview" ? "Interview invite" : "Team access"}
                </div>
                <h2 id="dashboard-action-dialog-title" className="mt-1 text-base font-semibold text-slate-950">
                  {activeDialog === "interview" ? "Create interview" : "Invite teammate"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveDialog(null)}
                className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-lg leading-none text-slate-500 transition hover:bg-slate-50 hover:text-slate-950"
                aria-label="Close dialog"
              >
                x
              </button>
            </div>
            <div className="p-4">
              {activeDialog === "interview" ? (
                <CreateInterviewCard defaultCandidateEmail={email} variant="plain" />
              ) : (
                <CreateTeamInvitationCard allowedDomains={allowedDomains} variant="plain" />
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
