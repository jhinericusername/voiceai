"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { cx, primaryButtonClass } from "../../dashboard-ui";

interface CreateAndJoinInterviewFormProps {
  readonly roleLabel: string;
}

interface CreateInterviewPayload {
  readonly interviewerJoinUrl?: unknown;
  readonly error?: unknown;
}

export function CreateAndJoinInterviewForm({ roleLabel }: CreateAndJoinInterviewFormProps) {
  const router = useRouter();
  const [candidateEmail, setCandidateEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const email = candidateEmail.trim();
    if (!email) {
      setStatusMessage(`Enter a candidate email before creating a ${roleLabel} interview.`);
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(`Creating hosted room for ${roleLabel}.`);

    try {
      const response = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateEmail: email }),
      });
      const payload = (await response.json().catch(() => ({}))) as CreateInterviewPayload;
      const interviewerJoinUrl =
        typeof payload.interviewerJoinUrl === "string" ? payload.interviewerJoinUrl : "";

      if (!response.ok || !interviewerJoinUrl) {
        setStatusMessage(
          typeof payload.error === "string"
            ? payload.error
            : "Could not create the hosted interview room. Try again.",
        );
        return;
      }

      router.push(interviewerJoinUrl);
    } catch {
      setStatusMessage("Could not create the hosted interview room. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4 grid min-w-0 gap-3">
      <label className="grid gap-1 text-sm font-semibold text-slate-900">
        Candidate email
        <input
          type="email"
          name="candidateEmail"
          value={candidateEmail}
          onChange={(event) => setCandidateEmail(event.target.value)}
          placeholder="candidate@example.com"
          disabled={isSubmitting}
          className="min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
        />
      </label>

      <button
        type="submit"
        disabled={isSubmitting}
        className={cx(primaryButtonClass, "w-fit disabled:cursor-not-allowed disabled:bg-slate-400")}
      >
        Create and join interview
      </button>

      {statusMessage ? (
        <p className="text-sm leading-6 text-slate-600" aria-live="polite">
          {statusMessage}
        </p>
      ) : null}
    </form>
  );
}
