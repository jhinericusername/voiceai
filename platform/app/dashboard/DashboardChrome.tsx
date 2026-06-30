"use client";

import { Fragment, type ReactNode } from "react";
import {
  BarChartIcon,
  BriefcaseIcon,
  ClipboardCheckIcon,
  SettingsIcon,
  UsersIcon,
  VideoIcon,
  type DashboardIcon,
} from "./dashboard-icons";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DashboardCandidateSearch } from "./DashboardCandidateSearch";
import { DashboardCreateInterviewLauncher } from "./DashboardCreateInterviewLauncher";
import { cx, secondaryButtonClass } from "./dashboard-ui";

interface DashboardChromeProps {
  readonly children: ReactNode;
  readonly displayName: string;
  readonly email: string;
}

const navItems: ReadonlyArray<{
  readonly href: string;
  readonly label: string;
  readonly icon: DashboardIcon;
  readonly match: "roles" | "candidates" | "review" | "recordings" | "analytics" | "settings";
  readonly priority: "primary" | "secondary";
  readonly status?: "Soon";
}> = [
  { href: "/dashboard/roles", label: "Roles", icon: BriefcaseIcon, match: "roles", priority: "primary" },
  { href: "/dashboard/candidates", label: "Candidates", icon: UsersIcon, match: "candidates", priority: "primary" },
  { href: "/dashboard/review-queue", label: "Review Queue", icon: ClipboardCheckIcon, match: "review", priority: "primary" },
  { href: "/dashboard/recordings", label: "Recordings", icon: VideoIcon, match: "recordings", priority: "primary" },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChartIcon, match: "analytics", priority: "secondary", status: "Soon" },
  { href: "/dashboard/settings", label: "Settings", icon: SettingsIcon, match: "settings", priority: "secondary", status: "Soon" },
] as const;

function navIsActive(pathname: string, match: (typeof navItems)[number]["match"]): boolean {
  if (match === "roles") {
    return pathname === "/dashboard" || pathname === "/dashboard/roles" || pathname.startsWith("/dashboard/roles/");
  }
  if (match === "candidates") {
    return pathname.startsWith("/dashboard/candidates") || pathname.includes("/candidates/");
  }
  if (match === "review") {
    return pathname.startsWith("/dashboard/review-queue") || pathname.startsWith("/dashboard/interviews");
  }
  return pathname.startsWith(`/dashboard/${match}`);
}

export function DashboardChrome({ children, displayName, email }: DashboardChromeProps) {
  const pathname = usePathname();

  return (
    <div className="puddle-dashboard-shell h-svh min-w-0 overflow-hidden text-slate-950 lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="puddle-dashboard-sidebar hidden min-w-0 border-r border-cyan-100/80 bg-white/72 lg:block">
        <div className="sticky top-0 flex h-svh min-h-0 flex-col">
          <div className="shrink-0 border-b border-cyan-100/80 px-5 py-5">
            <Link href="/dashboard/roles" className="flex items-center gap-3" aria-label="Puddle dashboard">
              <Image src="/puddle-symbol-black-nobg.png" alt="" width={36} height={36} className="h-9 w-9" />
              <div>
                <div className="text-sm font-semibold text-slate-950">Puddle</div>
                <div className="text-xs text-cyan-800">Hiring workspace</div>
              </div>
            </Link>
          </div>

          <nav className="grid flex-1 content-start gap-1 overflow-y-auto px-3 py-4" aria-label="Dashboard">
            {navItems.map((item, index) => {
              const Icon = item.icon;
              const active = navIsActive(pathname, item.match);
              const firstSecondaryItem = item.priority === "secondary" && navItems[index - 1]?.priority !== "secondary";
              return (
                <Fragment key={item.label}>
                  {firstSecondaryItem ? (
                    <div className="px-3 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Later
                    </div>
                  ) : null}
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "flex min-h-10 items-center gap-3 rounded-md border px-3 text-sm font-medium transition",
                      active
                        ? "border-cyan-200 bg-white text-slate-950 shadow-[0_12px_32px_rgba(8,145,178,0.08)]"
                        : item.priority === "secondary"
                          ? "border-transparent text-slate-400 hover:border-slate-200 hover:bg-white/74 hover:text-slate-700"
                          : "border-transparent text-slate-600 hover:border-cyan-100 hover:bg-white/82 hover:text-slate-950",
                    )}
                  >
                    <Icon
                      className={cx(
                        "h-4 w-4 shrink-0",
                        active ? "text-cyan-700" : item.priority === "secondary" ? "text-slate-400" : "text-slate-500",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.status ? (
                      <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                        {item.status}
                      </span>
                    ) : null}
                  </Link>
                </Fragment>
              );
            })}
          </nav>

          <div className="shrink-0 border-t border-cyan-100/80 px-5 pb-6 pt-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Signed in</div>
            <div className="mt-2 truncate text-sm font-semibold text-slate-950">{displayName}</div>
            <div className="truncate text-xs text-slate-500">{email}</div>
            <a href="/logout" className="mt-3 inline-flex text-sm font-semibold text-slate-700 hover:text-slate-950">
              Sign out
            </a>
          </div>
        </div>
      </aside>

      <div className="flex h-svh min-w-0 flex-col overflow-hidden">
        <header className="puddle-dashboard-topbar z-30 shrink-0 border-b border-cyan-100/80 bg-white/86">
          <div className="flex flex-col gap-3 px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between gap-3 lg:hidden">
              <Link href="/dashboard/roles" className="flex items-center gap-2" aria-label="Puddle dashboard">
                <Image src="/puddle-symbol-black-nobg.png" alt="" width={32} height={32} className="h-8 w-8" />
                <span className="text-sm font-semibold text-slate-950">Puddle</span>
              </Link>
              <a href="/logout" className={secondaryButtonClass}>
                Sign out
              </a>
            </div>

            <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
                  Puddle Hiring Workspace
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                  <span className="font-medium text-slate-900">Ashby interview pipeline</span>
                  <span>{displayName}</span>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-end">
                <DashboardCreateInterviewLauncher />
                <DashboardCandidateSearch shortcutLabel="Cmd+K" />
              </div>
            </div>

            <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 pt-2 lg:hidden" aria-label="Dashboard">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = navIsActive(pathname, item.match);
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-medium transition",
                      active
                        ? "border-slate-950 bg-slate-950 !text-white shadow-[0_12px_30px_rgba(15,23,42,0.14)]"
                        : item.priority === "secondary"
                          ? "border-transparent text-slate-400 hover:border-slate-200 hover:bg-white/74 hover:text-slate-700"
                          : "border-transparent text-slate-600 hover:border-cyan-100 hover:bg-white/82 hover:text-slate-950",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                    {item.status ? (
                      <span className="rounded border border-slate-200 bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                        {item.status}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>

        <main className="relative z-10 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-5">
          {children}
        </main>
      </div>
    </div>
  );
}
