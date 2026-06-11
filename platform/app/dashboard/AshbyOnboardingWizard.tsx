"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { AshbyCompanyState, AshbyJobOption } from "@/lib/ashby/server";
import { cx, primaryButtonClass, secondaryButtonClass, SectionPanel, StatusPill } from "./dashboard-ui";

interface SetupPayload {
  readonly integrationId: string;
  readonly webhookUrl: string;
  readonly webhookSecret: string;
  readonly requiredEvents: readonly string[];
}

type Feedback = { readonly tone: "success" | "error"; readonly text: string } | null;

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }

  return fallback;
}

function jobOptions(payload: unknown): AshbyJobOption[] {
  if (!payload || typeof payload !== "object" || !("jobs" in payload) || !Array.isArray(payload.jobs)) {
    return [];
  }

  return payload.jobs.filter((job): job is AshbyJobOption => {
    if (!job || typeof job !== "object") {
      return false;
    }

    const value = job as Record<string, unknown>;
    return (
      typeof value.id === "string" &&
      typeof value.name === "string" &&
      (value.status === null || typeof value.status === "string")
    );
  });
}

function setupPayload(payload: unknown): SetupPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = payload as Record<string, unknown>;
  if (
    typeof value.integrationId !== "string" ||
    typeof value.webhookUrl !== "string" ||
    typeof value.webhookSecret !== "string" ||
    !Array.isArray(value.requiredEvents)
  ) {
    return null;
  }

  const requiredEvents = value.requiredEvents.filter((event): event is string => typeof event === "string");
  return {
    integrationId: value.integrationId,
    webhookUrl: value.webhookUrl,
    webhookSecret: value.webhookSecret,
    requiredEvents,
  };
}

export function AshbyOnboardingWizard({
  state,
  canManageSetup,
}: {
  readonly state: AshbyCompanyState;
  readonly canManageSetup: boolean;
}) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [jobs, setJobs] = useState<AshbyJobOption[]>([]);
  const [selectedJobIds, setSelectedJobIds] = useState<readonly string[]>(state.selectedJobIds);
  const [setup, setSetup] = useState<SetupPayload | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const visibleSelectedJobIds = useMemo(() => {
    const visibleJobIds = new Set(jobs.map((job) => job.id));
    return selectedJobIds.filter((jobId) => visibleJobIds.has(jobId));
  }, [jobs, selectedJobIds]);
  const selectedJobs = useMemo(() => new Set(visibleSelectedJobIds), [visibleSelectedJobIds]);
  const canSubmitApiKey = apiKey.trim().length > 0 && !isSubmitting;
  const canSubmitJobs = visibleSelectedJobIds.length > 0 && !isSubmitting;
  const setupStatus = state.setupStatus ?? "job_selection_pending";
  const hasVerifiedWebhook = state.connected || Boolean(state.lastPingAt);
  const readyToSync = hasVerifiedWebhook && !state.lastSyncAt;
  const hasPendingWebhookSetup = !setup && !hasVerifiedWebhook && setupStatus === "pending_webhook";
  const statusLabel = state.lastSyncAt
    ? "Synced"
    : hasVerifiedWebhook
      ? "Webhook verified"
      : setup
        ? "Webhook pending"
        : setupStatus.replaceAll("_", " ");

  async function submitApiKey() {
    const submittedApiKey = apiKey;
    setApiKey("");
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/ashby/onboarding/api-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ashbyApiKey: submittedApiKey }),
      });
      const payload: unknown = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({ tone: "error", text: errorMessage(payload, "Could not validate Ashby API key.") });
        return;
      }

      const nextJobs = jobOptions(payload);
      const visibleJobIds = new Set(nextJobs.map((job) => job.id));
      const nextSelectedJobIds = selectedJobIds.filter((jobId) => visibleJobIds.has(jobId));
      setJobs(nextJobs);
      setSelectedJobIds(nextSelectedJobIds);
      setSetup(null);
      setApiKey("");
      if (!nextJobs.length) {
        setFeedback({
          tone: "error",
          text: "No Ashby jobs were returned. Confirm this API key can read Ashby jobs, then try again.",
        });
        return;
      }

      setFeedback({
        tone: "success",
        text: "Ashby API key validated. Select the jobs to screen.",
      });
    } catch {
      setFeedback({ tone: "error", text: "Could not reach Ashby onboarding API." });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitJobs() {
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/ashby/onboarding/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selectedJobIds: visibleSelectedJobIds }),
      });
      const payload: unknown = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({ tone: "error", text: errorMessage(payload, "Could not save Ashby jobs.") });
        return;
      }

      const nextSetup = setupPayload(payload);
      if (!nextSetup) {
        setFeedback({ tone: "error", text: "Ashby setup response was missing webhook values." });
        return;
      }

      setSetup(nextSetup);
      setFeedback({
        tone: "success",
        text: "Webhook setup values generated. Create the webhook in Ashby, send a ping, then check the connection.",
      });
    } catch {
      setFeedback({ tone: "error", text: "Could not save Ashby jobs." });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function runSync() {
    setIsSyncing(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/ashby/onboarding/sync", { method: "POST" });
      const payload: unknown = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({ tone: "error", text: errorMessage(payload, "Could not sync active Ashby candidates.") });
        return;
      }

      setFeedback({ tone: "success", text: "Active Ashby candidates synced." });
      router.refresh();
    } catch {
      setFeedback({ tone: "error", text: "Could not reach Ashby sync API." });
    } finally {
      setIsSyncing(false);
    }
  }

  function toggleJob(jobId: string) {
    setSelectedJobIds((current) =>
      current.includes(jobId) ? current.filter((id) => id !== jobId) : [...current, jobId],
    );
  }

  function checkWebhookConnection() {
    setFeedback({ tone: "success", text: "Checking webhook connection." });
    router.refresh();
  }

  if (!canManageSetup) {
    return (
      <SectionPanel
        title="Connect Ashby"
        eyebrow="Setup"
        action={<StatusPill status={statusLabel} className="capitalize" />}
      >
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3">
          <div className="text-sm font-semibold text-amber-950">Ashby setup needs an admin</div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-amber-900">
            Ask a workspace admin or owner to finish Ashby setup.
          </p>
        </div>
      </SectionPanel>
    );
  }

  return (
    <SectionPanel
      title="Connect Ashby"
      eyebrow="Setup"
      action={<StatusPill status={statusLabel} className="capitalize" />}
    >
      <div className="grid gap-5">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="text-sm font-semibold text-slate-950">{state.emailDomain}</div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            Add a company Ashby API key, choose the open jobs Puddle should screen, then configure the webhook
            events in Ashby.
          </p>
        </div>

        <div className="grid gap-3">
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            Ashby API key
            <input
              value={apiKey}
              type="password"
              autoComplete="off"
              disabled={isSubmitting}
              onChange={(event) => setApiKey(event.target.value)}
              className="min-h-10 rounded-md border border-slate-300 px-3 text-sm text-slate-950 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:bg-slate-100"
            />
          </label>
          <button
            type="button"
            disabled={!canSubmitApiKey}
            onClick={() => void submitApiKey()}
            className={cx(primaryButtonClass, "w-fit disabled:cursor-not-allowed disabled:opacity-60")}
          >
            {isSubmitting ? "Validating" : "Validate key"}
          </button>
        </div>

        {jobs.length ? (
          <div className="grid gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Ashby jobs</div>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Select each job that should create candidate screens in Puddle.
              </p>
            </div>
            <div className="grid gap-2">
              {jobs.map((job) => (
                <label
                  key={job.id}
                  className="flex min-w-0 items-start gap-3 rounded-md border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800"
                >
                  <input
                    type="checkbox"
                    checked={selectedJobs.has(job.id)}
                    onChange={() => toggleJob(job.id)}
                    className="mt-1 h-4 w-4 shrink-0 accent-cyan-700"
                  />
                  <span className="min-w-0">
                    <span className="block break-words font-medium text-slate-950">{job.name}</span>
                    <span className="mt-0.5 block break-all text-xs text-slate-500">
                      {job.status ? `${job.status} - ${job.id}` : job.id}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={!canSubmitJobs}
              onClick={() => void submitJobs()}
              className={cx(primaryButtonClass, "w-fit disabled:cursor-not-allowed disabled:opacity-60")}
            >
              {isSubmitting ? "Saving jobs" : "Save jobs"}
            </button>
          </div>
        ) : null}

        {!setup && readyToSync ? (
          <div className="grid gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3">
            <div>
              <div className="text-sm font-semibold text-emerald-950">Webhook connection verified</div>
              <p className="mt-1 text-sm leading-6 text-emerald-900">
                Ashby ping was received{state.lastPingAt ? ` at ${state.lastPingAt}` : ""}. Run the initial sync to
                load active candidates into the dashboard.
              </p>
            </div>
            <button
              type="button"
              disabled={isSyncing}
              onClick={() => void runSync()}
              className={cx(primaryButtonClass, "w-fit disabled:cursor-not-allowed disabled:opacity-60")}
            >
              {isSyncing ? "Syncing" : "Sync active candidates"}
            </button>
          </div>
        ) : null}

        {hasPendingWebhookSetup ? (
          <div className="grid gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3">
            <div>
              <div className="text-sm font-semibold text-amber-950">Webhook setup pending</div>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-amber-900">
                Ashby has not sent a verified webhook ping yet. Finish the webhook in Ashby, send a ping, then check
                the connection here. If the secret is no longer available, validate the API key and save jobs again.
              </p>
            </div>
            {state.webhookUrlPath ? <CopyField label="Webhook URL path" value={state.webhookUrlPath} /> : null}
            <button type="button" onClick={checkWebhookConnection} className={cx(secondaryButtonClass, "w-fit")}>
              Check webhook connection
            </button>
          </div>
        ) : null}

        {setup ? (
          <div className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-3">
            <CopyField label="Webhook URL" value={setup.webhookUrl} />
            <CopyField label="Webhook secret" value={setup.webhookSecret} />
            <div className="grid gap-2">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Required events
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {setup.requiredEvents.map((event) => (
                  <div
                    key={event}
                    className="min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                  >
                    <span className="break-all">{event}</span>
                  </div>
                ))}
              </div>
            </div>
            {hasVerifiedWebhook ? (
              <button
                type="button"
                disabled={isSyncing}
                onClick={() => void runSync()}
                className={cx(primaryButtonClass, "w-fit disabled:cursor-not-allowed disabled:opacity-60")}
              >
                {isSyncing ? "Syncing" : "Sync active candidates"}
              </button>
            ) : (
              <button type="button" onClick={checkWebhookConnection} className={cx(secondaryButtonClass, "w-fit")}>
                Check webhook connection
              </button>
            )}
          </div>
        ) : null}

        {feedback ? (
          <div
            role="status"
            aria-live="polite"
            className={cx(
              "rounded-md border px-3 py-2 text-sm font-medium",
              feedback.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-rose-200 bg-rose-50 text-rose-900",
            )}
          >
            {feedback.text}
          </div>
        ) : null}
      </div>
    </SectionPanel>
  );
}

function CopyField({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  return (
    <div className="grid gap-1.5">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 break-all rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800">
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            const writeText = navigator.clipboard?.writeText;
            if (!writeText) {
              setCopied(false);
              setCopyError(true);
              return;
            }

            void writeText.call(navigator.clipboard, value).then(
              () => {
                setCopied(true);
                setCopyError(false);
                window.setTimeout(() => setCopied(false), 1400);
              },
              () => {
                setCopied(false);
                setCopyError(true);
              },
            );
          }}
          className={cx(secondaryButtonClass, "w-fit shrink-0")}
        >
          {copied ? "Copied" : copyError ? "Copy failed" : "Copy"}
        </button>
      </div>
    </div>
  );
}
