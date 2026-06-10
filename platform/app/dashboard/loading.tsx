export default function DashboardLoading() {
  return (
    <div className="mx-auto grid min-w-0 max-w-6xl gap-5" aria-label="Loading dashboard">
      <div className="rounded-md border border-slate-200 bg-white px-4 py-4">
        <div className="h-3 w-36 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 h-8 w-72 max-w-full animate-pulse rounded bg-slate-200" />
        <div className="mt-3 h-4 w-[34rem] max-w-full animate-pulse rounded bg-slate-100" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="rounded-md border border-slate-200 bg-white px-4 py-3">
            <div className="h-3 w-24 animate-pulse rounded bg-slate-200" />
            <div className="mt-3 h-7 w-16 animate-pulse rounded bg-slate-200" />
            <div className="mt-2 h-3 w-32 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
          <div className="mt-4 grid gap-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-12 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
          <div className="mt-4 grid gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
