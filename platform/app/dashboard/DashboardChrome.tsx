"use client";

import type { ReactNode } from "react";
import {
  BarChartIcon,
  BriefcaseIcon,
  ClipboardCheckIcon,
  SearchIcon,
  SettingsIcon,
  UsersIcon,
  VideoIcon,
  type DashboardIcon,
} from "./dashboard-icons";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
}> = [
  { href: "/dashboard/roles", label: "Roles", icon: BriefcaseIcon, match: "roles" },
  { href: "/dashboard/candidates", label: "Candidates", icon: UsersIcon, match: "candidates" },
  { href: "/dashboard/review-queue", label: "Review Queue", icon: ClipboardCheckIcon, match: "review" },
  { href: "/dashboard/recordings", label: "Recordings", icon: VideoIcon, match: "recordings" },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChartIcon, match: "analytics" },
  { href: "/dashboard/settings", label: "Settings", icon: SettingsIcon, match: "settings" },
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

function SearchAffordance() {
  return (
    <div
      aria-label="Candidate and application search"
      className="puddle-search-affordance flex min-h-9 w-full max-w-md items-center justify-between gap-3 rounded-md border border-slate-200 bg-white/94 px-3 text-sm text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <span className="inline-flex min-w-0 items-center gap-2 truncate">
        <SearchIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">Search candidates or applications</span>
      </span>
      <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
        Cmd+K
      </span>
    </div>
  );
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
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = navIsActive(pathname, item.match);
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex min-h-10 items-center gap-3 rounded-md border px-3 text-sm font-medium transition",
                    active
                      ? "border-cyan-200 bg-white text-slate-950 shadow-[0_12px_32px_rgba(8,145,178,0.08)]"
                      : "border-transparent text-slate-600 hover:border-cyan-100 hover:bg-white/82 hover:text-slate-950",
                  )}
                >
                  <Icon className={cx("h-4 w-4 shrink-0", active ? "text-cyan-700" : "text-slate-500")} aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </Link>
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
                <SearchAffordance />
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
                        : "border-transparent text-slate-600 hover:border-cyan-100 hover:bg-white/82 hover:text-slate-950",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {item.label}
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
