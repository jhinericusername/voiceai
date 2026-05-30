"use client";

import { useState } from "react";

interface CreateInterviewCardProps {
  readonly defaultCandidateEmail: string;
}

interface CreateInterviewResponse {
  readonly sessionId: string;
  readonly room: string;
  readonly inviteUrl: string;
  readonly inviteExpiresAt: string;
}

export function CreateInterviewCard({
  defaultCandidateEmail,
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
    <section className="mt-5 rounded-lg border border-sky-200 bg-white p-4 shadow-[0_18px_45px_rgba(14,116,144,0.08)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">
            Interview invite
          </div>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">Create a room link</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
            This manually provisions a LiveKit interview room, dispatches the agent, and creates an expiring candidate
            invite URL.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Candidate email
          <input
            type="email"
            value={candidateEmail}
            onChange={(event) => setCandidateEmail(event.target.value)}
            className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-950 outline-none transition focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-100"
            placeholder="candidate@example.com"
          />
        </label>

        <div className="flex flex-col gap-2 self-end sm:flex-row">
          <button
            type="button"
            onClick={() => createInterview("create")}
            disabled={isCreating || !candidateEmail.trim()}
            className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
          >
            {pendingAction === "create" ? "Creating..." : "Create room"}
          </button>
          <button
            type="button"
            onClick={() => createInterview("join")}
            disabled={isCreating || !candidateEmail.trim()}
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold !text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {pendingAction === "join" ? "Opening..." : "Create and join"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
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
            className="mt-3 rounded-full border border-emerald-300 bg-white px-4 py-2 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-100"
          >
            {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy link"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
