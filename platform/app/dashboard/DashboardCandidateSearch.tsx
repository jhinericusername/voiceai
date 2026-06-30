"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { SearchIcon } from "./dashboard-icons";
import { cx } from "./dashboard-ui";

interface CandidateSearchResult {
  readonly applicationId: string;
  readonly candidateId: string | null;
  readonly candidateName: string;
  readonly candidateEmail: string | null;
  readonly jobId: string;
  readonly currentStage: string | null;
}

const SEARCH_DEBOUNCE_MS = 250;

function stringField(record: Record<string, unknown>, ...keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function nullableStringField(record: Record<string, unknown>, ...keys: readonly string[]): string | null {
  const value = stringField(record, ...keys);
  return value || null;
}

function normalizeSearchResult(value: unknown): CandidateSearchResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const applicationId = stringField(record, "applicationId", "application_id");
  const jobId = stringField(record, "jobId", "job_id");
  if (!applicationId || !jobId) {
    return null;
  }

  return {
    applicationId,
    candidateId: nullableStringField(record, "candidateId", "candidate_id"),
    candidateName: stringField(record, "candidateName", "candidate_name") || "Candidate",
    candidateEmail: nullableStringField(record, "candidateEmail", "candidate_email"),
    jobId,
    currentStage: nullableStringField(record, "currentStage", "current_stage"),
  };
}

function candidateSearchResults(payload: unknown): CandidateSearchResult[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const applications = (payload as Record<string, unknown>).applications;
  if (!Array.isArray(applications)) {
    return [];
  }

  return applications.flatMap((value) => {
    const result = normalizeSearchResult(value);
    return result ? [result] : [];
  });
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const error = (payload as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }
  }
  return fallback;
}

function candidateResultId(result: CandidateSearchResult): string {
  return result.candidateId?.trim() || result.applicationId;
}

function candidateResultHref(result: CandidateSearchResult): string {
  return `/dashboard/roles/${encodeURIComponent(result.jobId)}/candidates/${encodeURIComponent(candidateResultId(result))}`;
}

function candidateResultSubtitle(result: CandidateSearchResult): string {
  const parts = [result.candidateEmail, result.currentStage].filter(Boolean);
  return parts.length ? parts.join(" - ") : "Ashby candidate";
}

export function DashboardCandidateSearch({
  shortcutLabel = "Cmd+K",
}: {
  readonly shortcutLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CandidateSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const trimmedQuery = query.trim();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuery("");
        setResults([]);
        setProblem(null);
        setIsSearching(false);
        setOpen(true);
        return;
      }

      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
        setResults([]);
        setProblem(null);
        setIsSearching(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open || trimmedQuery.length < 2) {
      return;
    }

    const abortController = new AbortController();
    const searchTimer = setTimeout(() => {
      void searchCandidates(trimmedQuery, abortController);
    }, SEARCH_DEBOUNCE_MS);

    async function searchCandidates(nextQuery: string, controller: AbortController) {
      try {
        const response = await fetch("/api/ashby/applications/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ query: nextQuery, jobId: null }),
        });
        const payload: unknown = await response.json().catch(() => ({}));

        if (!response.ok) {
          setResults([]);
          setProblem(errorMessage(payload, "Could not search candidates."));
          return;
        }

        setResults(candidateSearchResults(payload));
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
          setProblem("Could not reach candidate search.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }

    return () => {
      clearTimeout(searchTimer);
      abortController.abort();
    };
  }, [open, trimmedQuery]);

  function closeSearch() {
    setOpen(false);
    setQuery("");
    setResults([]);
    setProblem(null);
    setIsSearching(false);
    buttonRef.current?.focus();
  }

  function openSearch() {
    setQuery("");
    setResults([]);
    setProblem(null);
    setIsSearching(false);
    setOpen(true);
  }

  function updateQuery(nextQuery: string) {
    setQuery(nextQuery);
    setProblem(null);
    const nextTrimmedQuery = nextQuery.trim();
    if (nextTrimmedQuery.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setResults([]);
    setIsSearching(true);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Search candidates"
        onClick={openSearch}
        className="puddle-search-affordance flex min-h-9 w-full max-w-md items-center justify-between gap-3 rounded-md border border-slate-200 bg-white/94 px-3 text-left text-sm text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      >
        <span className="inline-flex min-w-0 items-center gap-2 truncate">
          <SearchIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">Search candidates</span>
        </span>
        <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
          {shortcutLabel}
        </span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-start bg-slate-950/20 px-3 py-16 backdrop-blur-[2px] sm:px-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeSearch();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="mx-auto grid w-full max-w-2xl gap-3 rounded-md border border-slate-200 bg-white p-3 shadow-[0_28px_90px_rgba(15,23,42,0.22)]"
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 focus-within:border-cyan-500 focus-within:ring-4 focus-within:ring-cyan-100">
                <SearchIcon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => updateQuery(event.target.value)}
                  placeholder="Search candidates by name or email"
                  aria-labelledby={titleId}
                  className="min-h-10 min-w-0 flex-1 bg-transparent text-sm text-slate-950 outline-none placeholder:text-slate-400"
                />
              </div>
              <button
                type="button"
                onClick={closeSearch}
                className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50/50 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-cyan-100"
              >
                Close
              </button>
            </div>

            <h2 id={titleId} className="sr-only">
              Candidate search
            </h2>

            <div className="grid max-h-[min(60svh,30rem)] gap-2 overflow-y-auto pr-1" aria-live="polite">
              {trimmedQuery.length < 2 ? (
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-sm text-slate-500">
                  Type at least two characters to search Ashby candidates.
                </div>
              ) : null}

              {isSearching ? (
                <div className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-3 text-sm font-semibold text-cyan-900">
                  Searching candidates...
                </div>
              ) : null}

              {problem ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm font-semibold text-rose-800">
                  {problem}
                </div>
              ) : null}

              {!isSearching && !problem && trimmedQuery.length >= 2 && !results.length ? (
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-center text-sm text-slate-500">
                  No matching candidates.
                </div>
              ) : null}

              {results.map((result) => (
                <Link
                  key={`${result.applicationId}:${result.jobId}`}
                  href={candidateResultHref(result)}
                  onClick={closeSearch}
                  className={cx(
                    "puddle-interactive-card grid min-w-0 gap-1 rounded-md border border-slate-200 bg-white px-3 py-3 text-sm",
                    "focus:outline-none focus:ring-4 focus:ring-cyan-100",
                  )}
                >
                  <span className="truncate font-semibold text-slate-950">{result.candidateName}</span>
                  <span className="truncate text-xs text-slate-500">{candidateResultSubtitle(result)}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
