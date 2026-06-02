"use client";

import { useEffect } from "react";
import { primaryButtonClass, secondaryButtonClass } from "./dashboard-ui";

export default function DashboardError({
  error,
  unstable_retry,
}: {
  readonly error: Error & { digest?: string };
  readonly unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl rounded-md border border-rose-200 bg-rose-50 px-5 py-5">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-700">Dashboard error</div>
      <h1 className="mt-2 text-2xl font-semibold text-rose-950">Could not load this workspace view</h1>
      <p className="mt-2 text-sm leading-6 text-rose-800">
        The dashboard hit an unexpected rendering error. Retry the route, or return to the workspace overview.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={() => unstable_retry()} className={primaryButtonClass}>
          Retry
        </button>
        <a href="/dashboard" className={secondaryButtonClass}>
          Workspace home
        </a>
      </div>
    </div>
  );
}
