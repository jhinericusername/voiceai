import type { AshbyJob, SyncedAshbyApplication } from "./types.js";

const ASHBY_API_BASE_URL = "https://api.ashbyhq.com";
const ASHBY_JOB_LIST_MAX_PAGES = 100;
const ASHBY_APPLICATION_LIST_MAX_PAGES = 100;

interface AshbyListResponse {
  readonly success?: boolean;
  readonly errorInfo?: unknown;
  readonly error?: unknown;
  readonly results?: readonly Record<string, unknown>[];
  readonly moreDataAvailable?: boolean;
  readonly nextCursor?: string | null;
}

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function ashbyErrorMessage(payload: AshbyListResponse): string {
  const errorInfo = objectValue(payload.errorInfo);
  return (
    stringValue(errorInfo?.message) ??
    stringValue(errorInfo?.code) ??
    stringValue(payload.error) ??
    "unknown error"
  );
}

export function syncedApplicationFromAshby(input: {
  readonly integrationId: string;
  readonly application: Record<string, unknown>;
}): SyncedAshbyApplication | null {
  const candidate = objectValue(input.application.candidate);
  const job = objectValue(input.application.job);
  const currentStage =
    objectValue(input.application.currentInterviewStage) ?? objectValue(input.application.stage);
  const source = objectValue(input.application.source);
  const applicationId = stringValue(input.application.id);
  const candidateId = stringValue(candidate?.id);
  const candidateName =
    stringValue(candidate?.name) ??
    [stringValue(candidate?.firstName), stringValue(candidate?.lastName)].filter(Boolean).join(" ").trim();
  const jobId = stringValue(input.application.jobId) ?? stringValue(job?.id);

  if (!applicationId || !candidateId || !candidateName || !jobId) {
    return null;
  }

  return {
    applicationId,
    integrationId: input.integrationId,
    candidateId,
    candidateName,
    candidateEmail: stringValue(candidate?.primaryEmailAddress) ?? stringValue(candidate?.email),
    jobId,
    currentStage: stringValue(currentStage?.name),
    source: stringValue(source?.title) ?? stringValue(source?.name),
    status: stringValue(input.application.status) ?? "Active",
    ashbyUpdatedAt: stringValue(input.application.updatedAt),
    rawPayload: input.application,
  };
}

function jobFromAshby(value: Record<string, unknown>): AshbyJob | null {
  const id = stringValue(value.id);
  const name = stringValue(value.name) ?? stringValue(value.title);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    status: stringValue(value.status),
  };
}

function isOpenJob(job: AshbyJob): boolean {
  return job.status?.trim().toLowerCase() === "open";
}

export async function listJobs(input: {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<AshbyJob[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const jobs: AshbyJob[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pageCount = 0;

  do {
    pageCount += 1;
    if (pageCount > ASHBY_JOB_LIST_MAX_PAGES) {
      throw new Error("Ashby job.list exceeded maximum pagination limit");
    }

    const response = await fetchImpl(`${ASHBY_API_BASE_URL}/job.list`, {
      method: "POST",
      headers: {
        accept: "application/json; version=1",
        authorization: authHeader(input.apiKey),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        status: "Open",
        ...(cursor ? { cursor } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`Ashby job.list failed with ${response.status}`);
    }

    const payload = (await response.json()) as AshbyListResponse;
    if (payload.success === false) {
      throw new Error(`Ashby job.list failed: ${ashbyErrorMessage(payload)}`);
    }

    for (const result of payload.results ?? []) {
      const job = jobFromAshby(result);
      if (job && isOpenJob(job)) {
        jobs.push(job);
      }
    }

    const nextCursor = payload.moreDataAvailable && payload.nextCursor ? payload.nextCursor : null;
    if (nextCursor && seenCursors.has(nextCursor)) {
      throw new Error("Ashby job.list pagination repeated cursor");
    }
    if (nextCursor) {
      seenCursors.add(nextCursor);
    }
    cursor = nextCursor;
  } while (cursor);

  return jobs;
}

export async function listActiveApplicationsForJob(input: {
  readonly apiKey: string;
  readonly integrationId: string;
  readonly jobId: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<SyncedAshbyApplication[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const applications: SyncedAshbyApplication[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pageCount = 0;

  do {
    pageCount += 1;
    if (pageCount > ASHBY_APPLICATION_LIST_MAX_PAGES) {
      throw new Error("Ashby application.list exceeded maximum pagination limit");
    }

    const response = await fetchImpl(`${ASHBY_API_BASE_URL}/application.list`, {
      method: "POST",
      headers: {
        accept: "application/json; version=1",
        authorization: authHeader(input.apiKey),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jobId: input.jobId,
        status: "Active",
        ...(cursor ? { cursor } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`Ashby application.list failed with ${response.status}`);
    }

    const payload = (await response.json()) as AshbyListResponse;
    if (payload.success === false) {
      throw new Error(`Ashby application.list failed: ${ashbyErrorMessage(payload)}`);
    }

    for (const application of payload.results ?? []) {
      const synced = syncedApplicationFromAshby({
        integrationId: input.integrationId,
        application,
      });
      if (synced) {
        applications.push(synced);
      }
    }

    const nextCursor = payload.moreDataAvailable && payload.nextCursor ? payload.nextCursor : null;
    if (nextCursor && seenCursors.has(nextCursor)) {
      throw new Error("Ashby application.list pagination repeated cursor");
    }
    if (nextCursor) {
      seenCursors.add(nextCursor);
    }
    cursor = nextCursor;
  } while (cursor);

  return applications;
}
