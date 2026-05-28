"use client";

import { useState } from "react";

interface InterviewJoinClientProps {
  readonly token: string;
}

interface JoinResponse {
  readonly sessionId: string;
  readonly room: string;
  readonly liveKitUrl: string;
  readonly token: string;
}

export function InterviewJoinClient({ token }: InterviewJoinClientProps) {
  const [join, setJoin] = useState<JoinResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  async function joinInterview(): Promise<void> {
    setIsJoining(true);
    setError(null);

    try {
      const response = await fetch(`/api/interviews/${encodeURIComponent(token)}/join`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "Could not join this interview.");
        return;
      }

      setJoin(payload);
    } catch {
      setError("Could not reach the interview API.");
    } finally {
      setIsJoining(false);
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Candidate invite</div>
      <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-950 md:text-5xl">
        Your Puddle interview is ready.
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
        This link is scoped to one interview room. Continue when you are ready to request the live room credentials.
      </p>

      <button
        type="button"
        onClick={joinInterview}
        disabled={isJoining}
        className="mt-6 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold !text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {isJoining ? "Joining..." : "Join interview"}
      </button>

      {error ? (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {join ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          <div className="font-semibold">Live room credentials issued</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <span className="font-semibold">Session:</span> {join.sessionId}
            </div>
            <div>
              <span className="font-semibold">Room:</span> {join.room}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
