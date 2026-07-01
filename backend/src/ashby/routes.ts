import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { getPool } from "../db/pool.js";
import { gradingProfileUpsertStatement } from "../grading/repository.js";
import { safeErrorLogFields } from "../logging/redaction.js";
import {
  encryptIntegrationSecret,
  generateIntegrationSecret,
  integrationSecretKeyFromEnv,
} from "./crypto.js";
import {
  ashbyApiErrorLogFields,
  ashbyApiKeyValidationErrorMessage,
  listActiveApplicationsForJob,
  listJobs,
  syncedApplicationFromAshby,
} from "./client.js";
import {
  activeApplicationForJobStatement,
  activeApplicationUpsertStatement,
  activePipelineApplicationsStatement,
  activePipelineRolesStatement,
  inactiveCandidateApplicationsStatement,
  integrationByIdForUpdateStatement,
  integrationApiKeyUpsertStatement,
  integrationByIdStatement,
  integrationIdentityLockStatement,
  integrationJobsUpdateStatement,
  integrationLookupStatement,
  integrationSecretLookupStatement,
  markIntegrationSyncedStatement,
  isValidEmailDomain,
  markIntegrationPingStatement,
  normalizeEmailDomain,
  recentScreensStatement,
  roleActiveStagesUpdateStatement,
  scoreUpsertStatement,
  searchActiveApplicationsStatement,
  staleActiveApplicationsStatement,
  ashbyIntegrationAuditInsertStatement,
  webhookEventInsertStatement,
  webhookEventProcessedStatement,
} from "./repository.js";
import { decryptAshbyApiKey, decryptAshbyWebhookSecret } from "./secret-use.js";
import { verifyAshbyWebhookSignature } from "./webhook-signature.js";
import type {
  AshbyApiKeyOnboardingRequest,
  AshbyJobSelectionRequest,
  AshbySyncRequest,
  AshbyWebhookEnvelope,
  AshbyWebhookPayload,
  CompanyIdentity,
  ScoreInput,
} from "./types.js";

interface IntegrationRow {
  readonly integration_id?: unknown;
  readonly email_domain?: unknown;
  readonly ashby_api_key_ciphertext?: unknown;
  readonly ashby_webhook_secret_ciphertext?: unknown;
  readonly selected_job_ids?: unknown;
  readonly connected_at?: unknown;
  readonly last_ping_at?: unknown;
  readonly last_sync_at?: unknown;
  readonly setup_status?: unknown;
}

interface SetupRow {
  readonly integration_id: string | null;
  readonly identity_conflict: boolean;
}

interface WebhookEventRow {
  readonly inserted?: unknown;
  readonly processed_at?: unknown;
}

interface ActivePipelineRoleRow {
  readonly job_id?: unknown;
  readonly job_name?: unknown;
  readonly active_stage_names?: unknown;
  readonly active_stage_names_configured?: unknown;
  readonly stage_counts?: unknown;
}

interface ActivePipelineApplicationRow {
  readonly application_id?: unknown;
  readonly candidate_id?: unknown;
  readonly candidate_name?: unknown;
  readonly candidate_email?: unknown;
  readonly job_id?: unknown;
  readonly current_stage?: unknown;
  readonly source?: unknown;
  readonly status?: unknown;
  readonly ashby_updated_at?: unknown;
  readonly updated_at?: unknown;
  readonly latest_imported_evaluation?: unknown;
}

interface ActivePipelineStageCount {
  readonly name: string;
  readonly count: number;
}

interface ActivePipelineImportedEvaluation {
  readonly sourceEvaluationId: string;
  readonly sourceUpdatedAt: string | null;
  readonly problemSolving: number | null;
  readonly agency: number | null;
  readonly competitiveness: number | null;
  readonly curiosity: number | null;
  readonly totalScore: number | null;
  readonly comments: string | null;
}

interface ActivePipelineCandidate {
  readonly applicationId: string;
  readonly candidateId: string;
  readonly candidateName: string;
  readonly candidateEmail: string | null;
  readonly jobId: string;
  readonly currentStage: string;
  readonly source: string | null;
  readonly updatedAt: string | null;
  readonly latestImportedEvaluation: ActivePipelineImportedEvaluation | null;
}

const ACTIVE_APPLICATION_ACTIONS = new Set([
  "applicationSubmit",
  "applicationUpdate",
  "candidateStageChange",
  "candidateHire",
]);

const INACTIVE_CANDIDATE_ACTIONS = new Set(["candidateDelete", "candidateMerge"]);

const REQUIRED_WEBHOOK_EVENTS = [
  "ping",
  "applicationSubmit",
  "applicationUpdate",
  "candidateStageChange",
  "candidateDelete",
  "candidateMerge",
  "candidateHire",
] as const;

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function jsonObjectValue(value: unknown): Record<string, unknown> | null {
  const object = objectValue(value);
  if (object) {
    return object;
  }
  const text = stringValue(value);
  if (!text) {
    return null;
  }
  try {
    return objectValue(JSON.parse(text));
  } catch {
    return null;
  }
}

function selectedJobIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((item) => stringValue(item))
        .filter((item): item is string => item !== null),
    ),
  ];
}

function publicBaseUrl(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) {
    return null;
  }

  try {
    const url = new URL(text);
    const isLocalHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const isProduction = process.env.NODE_ENV === "production";
    const hasAllowedProtocol =
      url.protocol === "https:" || (!isProduction && isLocalHost && url.protocol === "http:");
    if (!hasAllowedProtocol) {
      return null;
    }
    if (isProduction && isLocalHost) {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function companyIdentity(body: unknown): CompanyIdentity | null {
  const obj = objectValue(body);
  const emailDomain = stringValue(obj?.emailDomain);
  const organizationId = stringValue(obj?.organizationId);
  if (!organizationId || !emailDomain || !isValidEmailDomain(emailDomain)) {
    return null;
  }

  return {
    emailDomain: normalizeEmailDomain(emailDomain),
    organizationId,
  };
}

function scoreValue(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 4) {
    return null;
  }

  return Number.isInteger(value * 2) ? value : null;
}

function limitValue(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const limit = Math.trunc(value);
  if (limit < 1) {
    return fallback;
  }

  return Math.min(limit, max);
}

async function integrationForIdentity(identity: CompanyIdentity): Promise<IntegrationRow | undefined> {
  const stmt = integrationLookupStatement(identity);
  const { rows } = await getPool().query<IntegrationRow>(stmt.sql, [...stmt.params]);
  return rows[0];
}

function integrationIdFrom(row: IntegrationRow | undefined): string | null {
  return stringValue(row?.integration_id);
}

function integrationSetupStatus(row: IntegrationRow | undefined): string {
  return stringValue(row?.setup_status) ?? "job_selection_pending";
}

function integrationHasWebhookSecret(row: IntegrationRow | undefined): boolean {
  return Boolean(stringValue(row?.ashby_webhook_secret_ciphertext));
}

function integrationReadyForSync(row: IntegrationRow | undefined): boolean {
  return (
    integrationSetupStatus(row) === "connected" &&
    Boolean(row?.connected_at) &&
    Boolean(row?.last_ping_at) &&
    integrationHasWebhookSecret(row)
  );
}

function integrationReadyForUse(row: IntegrationRow | undefined): boolean {
  return integrationReadyForSync(row) && Boolean(row?.last_sync_at);
}

function incompleteSetup(reply: FastifyReply) {
  return reply.code(409).send({ error: "Ashby integration setup is not complete" });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function uniqueTrimmedStringArray(value: unknown, maxItems = 20): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const names: string[] = [];
  for (const item of value) {
    const text = stringValue(item);
    if (!text || text.length > 120) {
      return null;
    }
    if (!names.includes(text)) {
      names.push(text);
    }
    if (names.length > maxItems) {
      return null;
    }
  }
  return names;
}

function isoStringValue(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return stringValue(value);
}

function intValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Math.max(0, Math.trunc(Number(value)));
  }
  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function nullableStringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function jsonArrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function stageCountsFrom(value: unknown): ActivePipelineStageCount[] {
  return jsonArrayValue(value)
    .map((item) => {
      const obj = objectValue(item);
      const name = stringValue(obj?.name);
      const count = intValue(obj?.count);
      return name && count !== null ? { name, count } : null;
    })
    .filter((item): item is ActivePipelineStageCount => item !== null);
}

function activeStageNamesForRole(input: {
  readonly configured: readonly string[];
  readonly configuredExplicitly: boolean;
  readonly stageOptions: readonly ActivePipelineStageCount[];
}): string[] {
  if (input.configuredExplicitly) {
    return [...input.configured];
  }

  return input.stageOptions.some((stage) => stage.name === "Initial Screen")
    ? ["Initial Screen"]
    : [];
}

function stageOptionsWithActiveStages(input: {
  readonly stageOptions: readonly ActivePipelineStageCount[];
  readonly activeStageNames: readonly string[];
}): ActivePipelineStageCount[] {
  const byName = new Map(input.stageOptions.map((stage) => [stage.name, stage]));
  for (const stageName of input.activeStageNames) {
    if (!byName.has(stageName)) {
      byName.set(stageName, { name: stageName, count: 0 });
    }
  }
  return [...byName.values()];
}

function activeCandidateCountFromStages(input: {
  readonly stageOptions: readonly ActivePipelineStageCount[];
  readonly activeStageNames: readonly string[];
}): number {
  const activeStageSet = new Set(input.activeStageNames);
  return input.stageOptions.reduce(
    (total, stage) => total + (activeStageSet.has(stage.name) ? stage.count : 0),
    0,
  );
}

function importedEvaluationFromRowValue(value: unknown): ActivePipelineImportedEvaluation | null {
  const item = jsonObjectValue(value);
  const sourceEvaluationId = stringValue(item?.sourceEvaluationId);
  if (!item || !sourceEvaluationId) {
    return null;
  }

  return {
    sourceEvaluationId,
    sourceUpdatedAt: isoStringValue(item.sourceUpdatedAt),
    problemSolving: numberValue(item.problemSolving),
    agency: numberValue(item.agency),
    competitiveness: numberValue(item.competitiveness),
    curiosity: numberValue(item.curiosity),
    totalScore: numberValue(item.totalScore),
    comments: nullableStringValue(item.comments),
  };
}

function pipelineCandidateFromRow(row: ActivePipelineApplicationRow): ActivePipelineCandidate | null {
  const applicationId = stringValue(row.application_id);
  const candidateId = stringValue(row.candidate_id);
  const candidateName = stringValue(row.candidate_name);
  const jobId = stringValue(row.job_id);
  const currentStage = stringValue(row.current_stage);
  if (!applicationId || !candidateId || !candidateName || !jobId || !currentStage) {
    return null;
  }

  return {
    applicationId,
    candidateId,
    candidateName,
    candidateEmail: stringValue(row.candidate_email),
    jobId,
    currentStage,
    source: stringValue(row.source),
    updatedAt: isoStringValue(row.ashby_updated_at) ?? isoStringValue(row.updated_at),
    latestImportedEvaluation: importedEvaluationFromRowValue(row.latest_imported_evaluation),
  };
}

async function integrationForWebhook(input: {
  readonly integrationId: string | null;
}): Promise<IntegrationRow | undefined> {
  if (!input.integrationId) {
    return undefined;
  }

  const stmt = integrationByIdStatement(input.integrationId);
  const { rows } = await getPool().query<IntegrationRow>(stmt.sql, [...stmt.params]);
  return rows[0];
}

function applicationFromPayload(payload: AshbyWebhookPayload): Record<string, unknown> | null {
  const data = objectValue(payload.data);
  return objectValue(data?.application) ?? data;
}

function applicationJobId(application: Record<string, unknown>): string | null {
  const job = objectValue(application.job);
  return stringValue(application.jobId) ?? stringValue(job?.id);
}

function candidateIdFromPayload(payload: AshbyWebhookPayload): string | null {
  const data = objectValue(payload.data);
  const candidate = objectValue(data?.candidate);
  return stringValue(candidate?.id) ?? stringValue(data?.candidateId) ?? stringValue(data?.id);
}

export function registerAshbyRoutes(app: FastifyInstance): void {
  app.post<{ Body: AshbyApiKeyOnboardingRequest }>(
    "/integrations/ashby/onboarding/api-key",
    async (request, reply) => {
      const identity = companyIdentity(request.body);
      const body = objectValue(request.body);
      const reviewerEmail = stringValue(body?.reviewerEmail);
      const apiKey = stringValue(body?.ashbyApiKey);
      if (!identity || !reviewerEmail || !apiKey) {
        return reply
          .code(400)
          .send({ error: "organizationId, emailDomain, reviewerEmail, and ashbyApiKey are required" });
      }

      let jobs: Awaited<ReturnType<typeof listJobs>>;
      try {
        jobs = await listJobs({ apiKey });
      } catch (error) {
        request.log.warn(
          {
            ...safeErrorLogFields(error),
            ...ashbyApiErrorLogFields(error),
            emailDomain: identity.emailDomain,
          },
          "failed to validate Ashby API key",
        );
        return reply.code(400).send({
          error: ashbyApiKeyValidationErrorMessage(error),
        });
      }

      if (jobs.length === 0) {
        return reply.code(400).send({
          error: "No Ashby jobs were returned. Confirm this API key can read Ashby jobs, then try again.",
        });
      }

      const secretKey = integrationSecretKeyFromEnv();
      const encryptedApiKey = encryptIntegrationSecret(apiKey, secretKey);
      const encryptedWebhookSecret = encryptIntegrationSecret(generateIntegrationSecret(), secretKey);
      const lock = integrationIdentityLockStatement(identity);
      const upsert = integrationApiKeyUpsertStatement({
        organizationId: identity.organizationId,
        emailDomain: identity.emailDomain,
        reviewerEmail,
        ashbyApiKeyCiphertext: encryptedApiKey,
        ashbyWebhookSecretCiphertext: encryptedWebhookSecret,
      });

      const client = await getPool().connect();
      let rows: (SetupRow & { readonly ashby_webhook_secret_ciphertext?: unknown })[] = [];
      let committed = false;
      try {
        await client.query("BEGIN");
        await client.query(lock.sql, [...lock.params]);
        const result = await client.query<
          SetupRow & { readonly ashby_webhook_secret_ciphertext?: unknown }
        >(upsert.sql, [...upsert.params]);
        rows = result.rows;
        const integrationId = stringValue(rows[0]?.integration_id);
        if (integrationId) {
          const stale = staleActiveApplicationsStatement(integrationId);
          await client.query(stale.sql, [...stale.params]);
          const audit = ashbyIntegrationAuditInsertStatement({
            integrationId,
            actorEmail: reviewerEmail,
            action: "api_key_replaced",
            metadata: { selectedJobCount: 0 },
          });
          await client.query(audit.sql, [...audit.params]);
        }
        await client.query("COMMIT");
        committed = true;
      } catch (error) {
        if (!committed) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            request.log.error({ err: rollbackError }, "failed to roll back Ashby onboarding transaction");
          }
        }
        throw error;
      } finally {
        client.release();
      }

      const row = rows[0];
      if (row?.identity_conflict) {
        return reply.code(409).send({
          error: "Ashby identity conflict for organizationId.",
        });
      }

      const integrationId = stringValue(row?.integration_id);
      if (!integrationId) {
        return reply
          .code(500)
          .send({ error: "Ashby onboarding did not return an integration id" });
      }

      return reply.code(201).send({
        integrationId,
        emailDomain: identity.emailDomain,
        setupStatus: "job_selection_pending",
        jobs,
      });
    },
  );

  app.post<{ Body: AshbyJobSelectionRequest }>(
    "/integrations/ashby/onboarding/jobs",
    async (request, reply) => {
      const identity = companyIdentity(request.body);
      const body = objectValue(request.body);
      const reviewerEmail = stringValue(body?.reviewerEmail);
      const jobs = selectedJobIds(body?.selectedJobIds);
      const baseUrl = publicBaseUrl(body?.publicBaseUrl);
      if (!identity || !reviewerEmail || jobs.length === 0 || !baseUrl) {
        return reply.code(400).send({
          error: "organizationId, emailDomain, reviewerEmail, selectedJobIds, and publicBaseUrl are required",
        });
      }

      const integration = await integrationForIdentity(identity);
      const integrationId = integrationIdFrom(integration);
      if (!integrationId) {
        return reply.code(404).send({ error: "Ashby integration is not configured" });
      }

      const encryptedApiKey = stringValue(integration?.ashby_api_key_ciphertext);
      if (!encryptedApiKey) {
        return reply.code(404).send({ error: "Ashby integration is not configured" });
      }

      const apiKey = decryptAshbyApiKey({
        ciphertext: encryptedApiKey,
        secretKey: integrationSecretKeyFromEnv(),
        purpose: "selected-job-validation",
      });
      let openJobs: Awaited<ReturnType<typeof listJobs>>;
      try {
        openJobs = await listJobs({ apiKey });
      } catch (error) {
        request.log.warn(
          { ...safeErrorLogFields(error), integrationId },
          "failed to validate selected Ashby jobs",
        );
        return reply.code(400).send({
          error: "Unable to validate selected Ashby jobs.",
        });
      }

      const openJobIds = new Set(openJobs.map((job) => job.id));
      const invalidJobIds = jobs.filter((jobId) => !openJobIds.has(jobId));
      if (invalidJobIds.length > 0) {
        return reply.code(400).send({
          error: "Selected Ashby jobs are not open or no longer exist",
        });
      }

      const update = integrationJobsUpdateStatement({
        integrationId,
        selectedJobIds: jobs,
        reviewerEmail,
      });

      const client = await getPool().connect();
      let updated: IntegrationRow | undefined;
      let committed = false;
      try {
        await client.query("BEGIN");
        const { rows } = await client.query<IntegrationRow>(update.sql, [...update.params]);
        updated = rows[0];
        if (updated) {
          const stale = staleActiveApplicationsStatement(integrationId);
          await client.query(stale.sql, [...stale.params]);
          const audit = ashbyIntegrationAuditInsertStatement({
            integrationId,
            actorEmail: reviewerEmail,
            action: "jobs_selected",
            metadata: { selectedJobCount: jobs.length },
          });
          await client.query(audit.sql, [...audit.params]);
          for (const jobId of jobs) {
            const profile = gradingProfileUpsertStatement({
              profileId: randomUUID(),
              organizationId: identity.organizationId,
              ashbyIntegrationId: integrationId,
              ashbyJobId: jobId,
              actorEmail: reviewerEmail,
            });
            await client.query(profile.sql, [...profile.params]);
          }
        }
        await client.query("COMMIT");
        committed = true;
      } catch (error) {
        if (!committed) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            request.log.error({ err: rollbackError }, "failed to roll back Ashby job selection transaction");
          }
        }
        throw error;
      } finally {
        client.release();
      }

      const encryptedWebhookSecret = stringValue(updated?.ashby_webhook_secret_ciphertext);
      if (!encryptedWebhookSecret) {
        return reply.code(500).send({ error: "Ashby webhook secret is not configured" });
      }

      const webhookSecret = decryptAshbyWebhookSecret({
        ciphertext: encryptedWebhookSecret,
        secretKey: integrationSecretKeyFromEnv(),
        purpose: "webhook-setup-display",
      });
      return reply.send({
        integrationId,
        webhookUrl: `${baseUrl}/api/ashby/webhook?integrationId=${encodeURIComponent(integrationId)}`,
        webhookSecret,
        requiredEvents: REQUIRED_WEBHOOK_EVENTS,
      });
    },
  );

  app.post("/integrations/ashby/setup", async (_request, reply) => {
    return reply.code(410).send({
      error: "Legacy Ashby setup is disabled. Use self-serve onboarding.",
    });
  });

  app.post("/integrations/ashby/company-state", async (request, reply) => {
    const identity = companyIdentity(request.body);
    if (!identity) {
      return reply.code(400).send({ error: "organizationId and valid emailDomain are required" });
    }

    const integration = await integrationForIdentity(identity);
    const integrationId = integrationIdFrom(integration);
    const hasWebhookSecret = integrationHasWebhookSecret(integration);
    const connected = integrationReadyForSync(integration);
    return reply.send({
      connected,
      setupStatus: hasWebhookSecret ? integrationSetupStatus(integration) : "job_selection_pending",
      integrationId,
      emailDomain: stringValue(integration?.email_domain) ?? identity.emailDomain,
      selectedJobIds: stringArray(integration?.selected_job_ids),
      lastPingAt: connected ? (integration?.last_ping_at ?? null) : null,
      lastSyncAt: connected ? (integration?.last_sync_at ?? null) : null,
      webhookUrlPath: integrationId
        ? `/api/ashby/webhook?integrationId=${encodeURIComponent(integrationId)}`
        : null,
    });
  });

  app.post<{ Body: AshbyWebhookEnvelope }>("/integrations/ashby/webhook", async (request, reply) => {
    const envelope = objectValue(request.body);
    const integration = await integrationForWebhook({
      integrationId: stringValue(envelope?.integrationId),
    });
    const resolvedIntegrationId = integrationIdFrom(integration);
    if (!resolvedIntegrationId) {
      return reply.code(404).send({ error: "Ashby integration is not configured" });
    }

    const rawBody = typeof envelope?.rawBody === "string" ? envelope.rawBody : null;
    const signature = stringValue(envelope?.signature);
    if (rawBody === null || !signature) {
      return reply.code(401).send({ error: "invalid webhook signature" });
    }

    const encryptedWebhookSecret = stringValue(integration?.ashby_webhook_secret_ciphertext);
    if (!encryptedWebhookSecret) {
      return reply.code(404).send({ error: "Ashby webhook secret is not configured" });
    }

    const webhookSecret = decryptAshbyWebhookSecret({
      ciphertext: encryptedWebhookSecret,
      secretKey: integrationSecretKeyFromEnv(),
      purpose: "webhook-signature-verification",
    });
    if (
      !verifyAshbyWebhookSignature({
        body: rawBody,
        secret: webhookSecret,
        signature,
      })
    ) {
      return reply.code(401).send({ error: "invalid webhook signature" });
    }

    let payload: AshbyWebhookPayload | null = null;
    try {
      payload = JSON.parse(rawBody) as AshbyWebhookPayload;
    } catch {
      return reply.code(400).send({ error: "invalid Ashby webhook json" });
    }

    const action = stringValue(payload?.action);
    if (!payload || !action) {
      return reply.code(400).send({ error: "valid Ashby webhook payload is required" });
    }

    if (action === "ping") {
      const stmt = markIntegrationPingStatement(resolvedIntegrationId);
      await getPool().query(stmt.sql, [...stmt.params]);

      return reply.send({ ok: true, action: "ping" });
    }

    const client = await getPool().connect();
    let transactionClosed = false;
    try {
      await client.query("BEGIN");
      const lockedLookup = integrationByIdForUpdateStatement(resolvedIntegrationId);
      const lockedResult = await client.query<IntegrationRow>(lockedLookup.sql, [
        ...lockedLookup.params,
      ]);
      const lockedIntegration = lockedResult.rows[0];
      if (!integrationIdFrom(lockedIntegration)) {
        await client.query("ROLLBACK");
        transactionClosed = true;
        return reply.code(404).send({ error: "Ashby integration is not configured" });
      }

      if (!integrationReadyForUse(lockedIntegration)) {
        await client.query("COMMIT");
        transactionClosed = true;
        return reply.send({ ok: true, ignored: true, action });
      }

      const webhookActionId = stringValue(payload.webhookActionId);
      if (!webhookActionId) {
        await client.query("ROLLBACK");
        transactionClosed = true;
        return reply.code(400).send({ error: "webhookActionId is required" });
      }

      const insert = webhookEventInsertStatement({
        webhookActionId,
        integrationId: resolvedIntegrationId,
        action,
        payload,
      });
      const inserted = await client.query<WebhookEventRow>(insert.sql, [...insert.params]);
      const eventRow = inserted.rows[0];
      if (eventRow?.inserted === false && eventRow.processed_at) {
        await client.query("COMMIT");
        transactionClosed = true;
        return reply.send({ ok: true, duplicate: true });
      }

      if (ACTIVE_APPLICATION_ACTIONS.has(action)) {
        const application = applicationFromPayload(payload);
        const jobId = application ? applicationJobId(application) : null;
        const selectedJobs = new Set(stringArray(lockedIntegration?.selected_job_ids));
        if (application && jobId && selectedJobs.has(jobId)) {
          const synced = syncedApplicationFromAshby({
            integrationId: resolvedIntegrationId,
            application,
          });
          if (synced) {
            const upsert = activeApplicationUpsertStatement({
              ...synced,
              status: action === "candidateHire" ? "Hired" : synced.status,
            });
            await client.query(upsert.sql, [...upsert.params]);
          }
        }
      }

      const candidateId = candidateIdFromPayload(payload);
      if (candidateId && INACTIVE_CANDIDATE_ACTIONS.has(action)) {
        const inactive = inactiveCandidateApplicationsStatement({
          integrationId: resolvedIntegrationId,
          candidateId,
          status: action === "candidateDelete" ? "Deleted" : "Merged",
        });
        await client.query(inactive.sql, [...inactive.params]);
      }

      const processed = webhookEventProcessedStatement(webhookActionId);
      await client.query(processed.sql, [...processed.params]);
      await client.query("COMMIT");
      transactionClosed = true;
      return reply.send({ ok: true, action });
    } catch (error) {
      if (!transactionClosed) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          request.log.error({ err: rollbackError }, "failed to roll back Ashby webhook transaction");
        }
      }
      throw error;
    } finally {
      client.release();
    }
  });

  app.post<{ Body: AshbySyncRequest }>(
    "/integrations/ashby/sync-active-applications",
    async (request, reply) => {
      const identity = companyIdentity(request.body);
      if (!identity) {
        return reply.code(400).send({ error: "organizationId and valid emailDomain are required" });
      }

      const integration = await integrationForIdentity(identity);
      const integrationId = integrationIdFrom(integration);
      if (!integrationId) {
        return reply.code(404).send({ error: "Ashby integration is not configured" });
      }

      if (!integrationReadyForSync(integration)) {
        return reply.code(409).send({ error: "Ashby webhook ping has not been verified" });
      }

      const secretLookup = integrationSecretLookupStatement(integrationId);
      const secretResult = await getPool().query<IntegrationRow>(secretLookup.sql, [
        ...secretLookup.params,
      ]);
      const configuredIntegration = secretResult.rows[0];
      const encryptedApiKey = stringValue(configuredIntegration?.ashby_api_key_ciphertext);
      const encryptedWebhookSecret = stringValue(configuredIntegration?.ashby_webhook_secret_ciphertext);
      const jobIds = stringArray(configuredIntegration?.selected_job_ids);
      if (!encryptedApiKey || !encryptedWebhookSecret || jobIds.length === 0) {
        return reply.code(404).send({ error: "Ashby integration is not configured" });
      }

      const apiKey = decryptAshbyApiKey({
        ciphertext: encryptedApiKey,
        secretKey: integrationSecretKeyFromEnv(),
        purpose: "active-application-sync",
      });
      let syncedCount = 0;
      for (const jobId of jobIds) {
        const applications = await listActiveApplicationsForJob({ apiKey, integrationId, jobId });
        for (const application of applications) {
          const stmt = activeApplicationUpsertStatement(application);
          await getPool().query(stmt.sql, [...stmt.params]);
          syncedCount += 1;
        }
      }

      const synced = markIntegrationSyncedStatement(integrationId);
      await getPool().query(synced.sql, [...synced.params]);
      const actorEmail = stringValue((objectValue(request.body))?.reviewerEmail) ?? "system";
      const audit = ashbyIntegrationAuditInsertStatement({
        integrationId,
        actorEmail,
        action: "active_applications_synced",
        metadata: { syncedCount, selectedJobCount: jobIds.length },
      });
      await getPool().query(audit.sql, [...audit.params]);
      return reply.send({ ok: true, syncedCount });
    },
  );

  app.post("/integrations/ashby/active-pipeline", async (request, reply) => {
    const identity = companyIdentity(request.body);
    const body = objectValue(request.body);
    if (!identity) {
      return reply.code(400).send({ error: "organizationId and valid emailDomain are required" });
    }

    const integration = await integrationForIdentity(identity);
    const integrationId = integrationIdFrom(integration);
    if (!integrationId) {
      return reply.code(404).send({ error: "Ashby integration is not configured" });
    }
    if (!integrationReadyForUse(integration)) {
      return incompleteSetup(reply);
    }

    const jobIds = selectedJobIds(integration?.selected_job_ids);
    const roleStmt = activePipelineRolesStatement({
      integrationId,
      selectedJobIds: jobIds,
    });
    const applicationsStmt = activePipelineApplicationsStatement({
      integrationId,
      selectedJobIds: jobIds,
      limit: limitValue(body?.limit, 500, 1000),
    });
    const [roleResult, applicationsResult] = await Promise.all([
      getPool().query<ActivePipelineRoleRow>(roleStmt.sql, [...roleStmt.params]),
      getPool().query<ActivePipelineApplicationRow>(applicationsStmt.sql, [...applicationsStmt.params]),
    ]);

    const candidates = applicationsResult.rows
      .map((row) => pipelineCandidateFromRow(row))
      .filter((candidate): candidate is ActivePipelineCandidate => candidate !== null);

    const roles = roleResult.rows.map((row) => {
      const jobId = stringValue(row.job_id) ?? "";
      const stageCounts = stageCountsFrom(row.stage_counts);
      const activeStageNames = activeStageNamesForRole({
        configured: stringArray(row.active_stage_names),
        configuredExplicitly: row.active_stage_names_configured === true,
        stageOptions: stageCounts,
      });
      const stageOptions = stageOptionsWithActiveStages({ stageOptions: stageCounts, activeStageNames });
      const roleCandidates = candidates.filter((candidate) => candidate.jobId === jobId);
      return {
        jobId,
        name: stringValue(row.job_name) ?? `Ashby role ${jobId.slice(0, 8)}`,
        activeStageNames,
        stageOptions,
        activeCandidateCount: activeCandidateCountFromStages({ stageOptions, activeStageNames }),
        candidates: roleCandidates,
      };
    });
    const totalSyncedCandidates = roles.reduce(
      (total, role) => total + role.stageOptions.reduce((sum, stage) => sum + stage.count, 0),
      0,
    );
    const activeCandidateCount = roles.reduce((total, role) => total + role.activeCandidateCount, 0);
    const candidateRowCount = candidates.length;

    return reply.send({
      integrationId,
      lastSyncAt: integration?.last_sync_at ?? null,
      selectedJobCount: jobIds.length,
      totalSyncedCandidates,
      activeCandidateCount,
      candidateRowCount,
      candidateRowsTruncated: candidateRowCount < totalSyncedCandidates,
      roles,
    });
  });

  app.post("/integrations/ashby/active-stages", async (request, reply) => {
    const identity = companyIdentity(request.body);
    const body = objectValue(request.body);
    const reviewerEmail = stringValue(body?.reviewerEmail);
    const jobId = stringValue(body?.jobId);
    const activeStageNames = uniqueTrimmedStringArray(body?.activeStageNames);
    if (!identity || !reviewerEmail || !jobId || !activeStageNames) {
      return reply.code(400).send({
        error: "organizationId, emailDomain, reviewerEmail, jobId, and activeStageNames are required",
      });
    }

    const integration = await integrationForIdentity(identity);
    const integrationId = integrationIdFrom(integration);
    if (!integrationId) {
      return reply.code(404).send({ error: "Ashby integration is not configured" });
    }
    if (!integrationReadyForUse(integration)) {
      return incompleteSetup(reply);
    }

    const jobIds = new Set(selectedJobIds(integration?.selected_job_ids));
    if (!jobIds.has(jobId)) {
      return reply.code(404).send({ error: "Ashby role is not selected for this integration" });
    }

    const stmt = roleActiveStagesUpdateStatement({
      organizationId: identity.organizationId,
      integrationId,
      jobId,
      activeStageNames,
      reviewerEmail,
    });
    let result = await getPool().query(stmt.sql, [...stmt.params]);
    if (result.rows.length === 0) {
      const profile = gradingProfileUpsertStatement({
        profileId: randomUUID(),
        organizationId: identity.organizationId,
        ashbyIntegrationId: integrationId,
        ashbyJobId: jobId,
        actorEmail: reviewerEmail,
      });
      await getPool().query(profile.sql, [...profile.params]);
      result = await getPool().query(stmt.sql, [...stmt.params]);
    }

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: "Ashby role stage settings could not be updated" });
    }

    return reply.send({ jobId, activeStageNames });
  });

  app.post("/integrations/ashby/applications/search", async (request, reply) => {
    const identity = companyIdentity(request.body);
    const body = objectValue(request.body);
    if (!identity) {
      return reply.code(400).send({ error: "organizationId and valid emailDomain are required" });
    }

    const integration = await integrationForIdentity(identity);
    const integrationId = integrationIdFrom(integration);
    if (!integrationId) {
      return reply.code(404).send({ error: "Ashby integration is not configured" });
    }
    if (!integrationReadyForUse(integration)) {
      return incompleteSetup(reply);
    }

    const stmt = searchActiveApplicationsStatement({
      integrationId,
      jobId: stringValue(body?.jobId),
      query: stringValue(body?.query) ?? "",
      limit: limitValue(body?.limit, 8, 20),
    });
    const { rows } = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.send({ applications: rows });
  });

  app.post<{ Body: ScoreInput }>("/integrations/ashby/scores", async (request, reply) => {
    const identity = companyIdentity(request.body);
    const body = objectValue(request.body);
    const problemSolving = scoreValue(body?.problemSolving);
    const agency = scoreValue(body?.agency);
    const competitiveness = scoreValue(body?.competitiveness);
    const curiosity = scoreValue(body?.curiosity);
    const applicationId = stringValue(body?.applicationId);
    const jobId = stringValue(body?.jobId);
    const roleId = stringValue(body?.roleId);
    const reviewerEmail = stringValue(body?.reviewerEmail);
    if (roleId && jobId && roleId !== jobId) {
      return reply.code(400).send({ error: "roleId must match the selected Ashby jobId" });
    }

    if (
      !identity ||
      !applicationId ||
      !jobId ||
      !roleId ||
      !reviewerEmail ||
      problemSolving === null ||
      agency === null ||
      competitiveness === null ||
      curiosity === null
    ) {
      return reply.code(400).send({ error: "valid score input is required" });
    }

    const integration = await integrationForIdentity(identity);
    const integrationId = integrationIdFrom(integration);
    if (!integrationId) {
      return reply.code(404).send({ error: "Ashby integration is not configured" });
    }
    if (!integrationReadyForUse(integration)) {
      return incompleteSetup(reply);
    }

    const applicationStmt = activeApplicationForJobStatement({
      integrationId,
      applicationId,
      jobId,
    });
    const application = await getPool().query(applicationStmt.sql, [...applicationStmt.params]);
    if (!application.rows.length) {
      return reply
        .code(404)
        .send({ error: "Ashby application is not active for the selected job" });
    }

    const stmt = scoreUpsertStatement({
      integrationId,
      emailDomain: identity.emailDomain,
      organizationId: identity.organizationId,
      applicationId,
      jobId,
      roleId,
      reviewerEmail,
      problemSolving,
      agency,
      competitiveness,
      curiosity,
      comments: stringValue(body?.comments) ?? "",
    });
    const { rows } = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.code(201).send({ score: rows[0] });
  });

  app.post("/integrations/ashby/recent-screens", async (request, reply) => {
    const identity = companyIdentity(request.body);
    const body = objectValue(request.body);
    if (!identity) {
      return reply.code(400).send({ error: "organizationId and valid emailDomain are required" });
    }

    const integration = await integrationForIdentity(identity);
    const integrationId = integrationIdFrom(integration);
    if (!integrationId) {
      return reply.code(404).send({ error: "Ashby integration is not configured" });
    }
    if (!integrationReadyForUse(integration)) {
      return incompleteSetup(reply);
    }

    const stmt = recentScreensStatement({
      integrationId,
      limit: limitValue(body?.limit, 20, 50),
    });
    const { rows } = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.send({ screens: rows });
  });
}
