"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { VideoIcon } from "./dashboard-icons";
import { cx, primaryButtonClass } from "./dashboard-ui";

interface CreateInterviewResponse {
  readonly interviewerJoinUrl?: unknown;
  readonly error?: unknown;
}

export function DashboardCreateInterviewLauncher() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState("");

  async function createAndJoin() {
    if (isCreating) {
      return;
    }

    setIsCreating(true);
    setMessage("");

    try {
      const response = await fetch("/api/interviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => ({}))) as CreateInterviewResponse;
      const interviewerJoinUrl =
        typeof payload.interviewerJoinUrl === "string" ? payload.interviewerJoinUrl : "";

      if (!response.ok || !interviewerJoinUrl) {
        setMessage(
          typeof payload.error === "string"
            ? payload.error
            : "Could not create the interview room.",
        );
        setIsCreating(false);
        return;
      }

      router.push(interviewerJoinUrl);
    } catch {
      setMessage("Could not create the interview room.");
      setIsCreating(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-1">
      <button
        type="button"
        onClick={createAndJoin}
        disabled={isCreating}
        className={cx(
          primaryButtonClass,
          "min-h-9 shrink-0 gap-2 px-3 text-sm disabled:cursor-not-allowed disabled:bg-slate-400",
        )}
      >
        <VideoIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{isCreating ? "Creating room" : "Create and join interview"}</span>
      </button>
      {message ? (
        <p className="max-w-64 text-xs font-medium leading-5 text-rose-700" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}
