"use client";

import { useRef, useState } from "react";
import { cx, primaryButtonClass } from "../../dashboard-ui";

interface AshbyApplicationOption {
  readonly application_id: string;
  readonly candidate_name: string;
  readonly candidate_email: string | null;
  readonly job_id: string;
  readonly current_stage: string | null;
}

type Feedback = {
  readonly tone: "success" | "error";
  readonly text: string;
};

const scoreValues = Array.from({ length: 9 }, (_, index) => index / 2);

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return fallback;
}

function applicationOptions(payload: unknown): AshbyApplicationOption[] {
  if (!payload || typeof payload !== "object" || !("applications" in payload) || !Array.isArray(payload.applications)) {
    return [];
  }

  return payload.applications.filter((option): option is AshbyApplicationOption => {
    if (!option || typeof option !== "object") {
      return false;
    }

    const candidate = option as Record<string, unknown>;
    return (
      typeof candidate.application_id === "string" &&
      typeof candidate.candidate_name === "string" &&
      (typeof candidate.candidate_email === "string" || candidate.candidate_email === null) &&
      typeof candidate.job_id === "string" &&
      (typeof candidate.current_stage === "string" || candidate.current_stage === null)
    );
  });
}

function candidateLabel(option: AshbyApplicationOption): string {
  return option.candidate_email ? `${option.candidate_name} - ${option.candidate_email}` : option.candidate_name;
}

function ScoreSelect({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
      >
        {scoreValues.map((score) => (
          <option key={score} value={score}>
            {formatScore(score)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ScoreTab({ roleId, jobId }: { readonly roleId: string; readonly jobId?: string | null }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<AshbyApplicationOption[]>([]);
  const [selected, setSelected] = useState<AshbyApplicationOption | null>(null);
  const [problemSolving, setProblemSolving] = useState(3);
  const [agency, setAgency] = useState(3);
  const [competitiveness, setCompetitiveness] = useState(3);
  const [curiosity, setCuriosity] = useState(3);
  const [comments, setComments] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const searchRequestId = useRef(0);
  const queryRef = useRef("");

  const trimmedQuery = query.trim();
  const total = problemSolving + agency + competitiveness + curiosity;
  const statusMessage = isSaving
    ? { tone: "info", text: "Saving score..." }
    : isSearching
      ? { tone: "info", text: "Searching Ashby candidates..." }
      : feedback;

  async function searchCandidates(nextQuery: string) {
    const nextSearchId = searchRequestId.current + 1;
    searchRequestId.current = nextSearchId;
    setQuery(nextQuery);
    setSelected(null);
    setFeedback(null);

    const nextTrimmedQuery = nextQuery.trim();
    queryRef.current = nextTrimmedQuery;
    setOptions([]);
    if (nextTrimmedQuery.length < 2) {
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch("/api/ashby/applications/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: nextTrimmedQuery, jobId: jobId ?? null }),
      });
      const payload: unknown = await response.json().catch(() => ({}));

      if (searchRequestId.current !== nextSearchId || queryRef.current !== nextTrimmedQuery) {
        return;
      }

      if (!response.ok) {
        setOptions([]);
        setFeedback({ tone: "error", text: errorMessage(payload, "Could not search Ashby candidates.") });
        return;
      }

      setOptions(applicationOptions(payload));
    } catch {
      if (searchRequestId.current === nextSearchId) {
        setOptions([]);
        setFeedback({ tone: "error", text: "Could not reach the Ashby search API." });
      }
    } finally {
      if (searchRequestId.current === nextSearchId) {
        setIsSearching(false);
      }
    }
  }

  async function saveScore() {
    if (!selected) {
      setFeedback({ tone: "error", text: "Select an active Ashby candidate before saving." });
      return;
    }

    setIsSaving(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/ashby/scores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicationId: selected.application_id,
          roleId,
          problemSolving,
          agency,
          competitiveness,
          curiosity,
          comments,
        }),
      });
      const payload: unknown = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({ tone: "error", text: errorMessage(payload, "Could not save score.") });
        return;
      }

      setFeedback({ tone: "success", text: "Score saved." });
    } catch {
      setFeedback({ tone: "error", text: "Could not reach the score API." });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          Candidate
          <input
            value={query}
            onChange={(event) => void searchCandidates(event.target.value)}
            className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
            placeholder="Search active Ashby candidates"
          />
        </label>

        {selected ? (
          <div className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-900">
            <span className="font-semibold">Selected:</span> {candidateLabel(selected)}
            {selected.current_stage ? <span className="text-cyan-700"> - {selected.current_stage}</span> : null}
          </div>
        ) : null}

        {options.length ? (
          <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
            {options.map((option) => (
              <button
                key={option.application_id}
                type="button"
                onClick={() => {
                  searchRequestId.current += 1;
                  queryRef.current = option.candidate_name.trim();
                  setSelected(option);
                  setQuery(option.candidate_name);
                  setOptions([]);
                  setFeedback(null);
                }}
                className="inline-flex min-h-9 w-full max-w-full items-center justify-start rounded-md border border-slate-300 bg-white px-3 text-left text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
              >
                <span className="min-w-0 truncate">
                  {candidateLabel(option)}
                  {option.current_stage ? <span className="font-normal text-slate-500"> - {option.current_stage}</span> : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {!selected && trimmedQuery.length >= 2 && !isSearching && !options.length && !feedback ? (
          <div className="text-sm text-slate-500">No matching active candidates.</div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <ScoreSelect label="Problem Solving" value={problemSolving} onChange={setProblemSolving} />
        <ScoreSelect label="Agency" value={agency} onChange={setAgency} />
        <ScoreSelect label="Competitiveness" value={competitiveness} onChange={setCompetitiveness} />
        <ScoreSelect label="Curious" value={curiosity} onChange={setCuriosity} />
      </div>

      <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
        Comments
        <textarea
          value={comments}
          onChange={(event) => setComments(event.target.value)}
          className="min-h-28 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
          placeholder="Quick notes"
        />
      </label>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-700">
          Sum <span className="ml-2 text-xl font-semibold text-slate-950">{formatScore(total)}</span>
        </div>
        <button
          type="button"
          onClick={() => void saveScore()}
          disabled={isSaving || isSearching}
          className={cx(primaryButtonClass, "disabled:cursor-not-allowed disabled:bg-slate-400")}
        >
          {isSaving ? "Saving..." : "Save Candidate"}
        </button>
      </div>

      {statusMessage ? (
        <div
          className={cx(
            "text-sm font-medium",
            statusMessage.tone === "error"
              ? "text-rose-700"
              : statusMessage.tone === "success"
                ? "text-emerald-700"
                : "text-slate-600",
          )}
        >
          {statusMessage.text}
        </div>
      ) : null}
    </div>
  );
}
