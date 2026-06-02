"use client";

import { useState } from "react";

interface CreateInterviewCardProps {
  readonly defaultCandidateEmail: string;
  readonly variant?: "card" | "plain";
}

interface CreateInterviewResponse {
  readonly sessionId: string;
  readonly room: string;
  readonly inviteUrl: string;
  readonly inviteExpiresAt: string;
}

export function CreateInterviewCard({
  defaultCandidateEmail,
  variant = "card",
}: CreateInterviewCardProps) {
  const [candidateEmail, setCandidateEmail] = useState(defaultCandidateEmail);
  const [result, setResult] = useState<CreateInterviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"create" | "join" | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const isCreating = pendingAction !== null;

  const expiryLabel = result?.inviteExpiresAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(result.inviteExpiresAt))
    : null;

  async function createInterview(action: "create" | "join" = "create"): Promise<void> {
    setPendingAction(action);
    setError(null);
    setResult(null);
    setCopyState("idle");

    try {
      const response = await fetch("/api/interviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateEmail }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Could not create the interview invite.");
        return;
      }

      const createdInvite = payload as CreateInterviewResponse;
      setResult(createdInvite);

      if (action === "join") {
        window.location.assign(createdInvite.inviteUrl);
      }
    } catch {
      setError("Could not reach the interview API.");
    } finally {
      setPendingAction(null);
    }
  }

  async function copyInvite(): Promise<void> {
    if (!result?.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(result.inviteUrl);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section className={variant === "card" ? "rounded-md border border-slate-200 bg-white p-2.5" : "bg-white"}>
      {variant === "card" ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-700">Interview invite</div>
            <h2 className="mt-1 text-sm font-semibold text-slate-950">Create room link</h2>
          </div>
        </div>
      ) : null}

      <div className={variant === "card" ? "mt-3 grid gap-3" : "grid gap-3"}>
        <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
          Candidate email
          <input
            type="email"
            value={candidateEmail}
            onChange={(event) => setCandidateEmail(event.target.value)}
            className="min-h-8 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-950 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
            placeholder="candidate@example.com"
          />
        </label>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => createInterview("create")}
            disabled={isCreating || !candidateEmail.trim()}
            className="inline-flex min-h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
          >
            {pendingAction === "create" ? "Creating..." : "Create"}
          </button>
          <button
            type="button"
            onClick={() => createInterview("join")}
            disabled={isCreating || !candidateEmail.trim()}
            className="inline-flex min-h-8 items-center justify-center rounded-md bg-slate-950 px-3 text-sm font-semibold !text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {pendingAction === "join" ? "Opening..." : "Create + join"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-sm font-semibold text-emerald-950">Invite ready</div>
          <a
            href={result.inviteUrl}
            className="mt-2 block break-all font-mono text-sm !text-sky-800 underline decoration-sky-300 underline-offset-4"
          >
            {result.inviteUrl}
          </a>
          <div className="mt-3 grid gap-2 text-xs text-emerald-900 sm:grid-cols-2">
            <div>
              <span className="font-semibold">Room:</span> {result.room}
            </div>
            <div>
              <span className="font-semibold">Expires:</span> {expiryLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={copyInvite}
            className="mt-3 inline-flex min-h-8 items-center justify-center rounded-md border border-emerald-300 bg-white px-3 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-100"
          >
            {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy link"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
