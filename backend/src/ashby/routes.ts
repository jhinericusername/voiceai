import type { FastifyInstance } from "fastify";
import { getPool } from "../db/pool.js";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  generateIntegrationSecret,
  integrationSecretKeyFromEnv,
} from "./crypto.js";
import { listActiveApplicationsForJob, listJobs, syncedApplicationFromAshby } from "./client.js";
import {
  activeApplicationUpsertStatement,
  inactiveCandidateApplicationsStatement,
  integrationApiKeyUpsertStatement,
  integrationByIdStatement,
  integrationIdentityLockStatement,
  integrationJobsUpdateStatement,
  integrationLookupStatement,
  integrationSecretLookupStatement,
  integrationSetupUpsertStatement,
  markIntegrationSyncedStatement,
  isValidEmailDomain,
  markIntegrationPingStatement,
  normalizeEmailDomain,
  recentScreensStatement,
  scoreUpsertStatement,
  searchActiveApplicationsStatement,
  webhookEventInsertStatement,
  webhookEventProcessedStatement,
} from "./repository.js";
import { verifyAshbyWebhookSignature } from "./webhook-signature.js";
import type {
  AshbyApiKeyOnboardingRequest,
  AshbyJobSelectionRequest,
  AshbySetupRequest,
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
    const hasAllowedProtocol = url.protocol === "https:" || (isLocalHost && url.protocol === "http:");
    if (!hasAllowedProtocol) {
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
  if (!emailDomain || !isValidEmailDomain(emailDomain)) {
    return null;
  }

  return {
    emailDomain: normalizeEmailDomain(emailDomain),
    organizationId: stringValue(obj?.organizationId),
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function integrationForWebhook(input: {
  readonly integrationId: string | null;
  readonly companyDomain: string | null;
}): Promise<IntegrationRow | undefined> {
  if (input.integrationId) {
    const stmt = integrationByIdStatement(input.integrationId);
    const { rows } = await getPool().query<IntegrationRow>(stmt.sql, [...stmt.params]);
    return rows[0];
  }

  if (!input.companyDomain) {
    return undefined;
  }

  if (!isValidEmailDomain(input.companyDomain)) {
    return undefined;
  }

  return integrationForIdentity({
    emailDomain: normalizeEmailDomain(input.companyDomain),
    organizationId: null,
  });
}

function applicationFromPayload(payload: AshbyWebhookPayload): Record<string, unknown> | null {
  const data = objectValue(payload.data);
  return objectValue(data?.application) ?? data;
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
          .send({ error: "emailDomain, reviewerEmail, and ashbyApiKey are required" });
      }

      let jobs: Awaited<ReturnType<typeof listJobs>>;
      try {
        jobs = await listJobs({ apiKey });
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "Ashby API key validation failed",
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
          error: "Ashby identity conflict: organizationId and emailDomain match different integrations.",
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
          error: "emailDomain, reviewerEmail, selectedJobIds, and publicBaseUrl are required",
        });
      }

      const integration = await integrationForIdentity(identity);
      const integrationId = integrationIdFrom(integration);
      if (!integrationId) {
        return reply.code(404).send({ error: "Ashby integration is not configured" });
      }

      const update = integrationJobsUpdateStatement({
        integrationId,
        selectedJobIds: jobs,
        reviewerEmail,
      });
      const { rows } = await getPool().query<IntegrationRow>(update.sql, [...update.params]);
      const updated = rows[0];
      const encryptedWebhookSecret = stringValue(updated?.ashby_webhook_secret_ciphertext);
      if (!encryptedWebhookSecret) {
        return reply.code(500).send({ error: "Ashby webhook secret is not configured" });
      }

      const webhookSecret = decryptIntegrationSecret(
        encryptedWebhookSecret,
        integrationSecretKeyFromEnv(),
      );
      return reply.send({
        integrationId,
        webhookUrl: `${baseUrl}/api/ashby/webhook?integrationId=${encodeURIComponent(integrationId)}`,
        webhookSecret,
        requiredEvents: REQUIRED_WEBHOOK_EVENTS,
      });
    },
  );

  app.post<{ Body: AshbySetupRequest }>("/integrations/ashby/setup", async (request, reply) => {
    const identity = companyIdentity(request.body);
    const body = objectValue(request.body);
    const apiKey = stringValue(body?.ashbyApiKey);
    const jobs = selectedJobIds(body?.selectedJobIds);
    if (!identity || !apiKey || jobs.length === 0) {
      return reply
        .code(400)
        .send({ error: "emailDomain, ashbyApiKey, and selectedJobIds are required" });
    }

    const encrypted = encryptIntegrationSecret(apiKey, integrationSecretKeyFromEnv());
    const stmt = integrationSetupUpsertStatement({
      organizationId: identity.organizationId,
      emailDomain: identity.emailDomain,
      ashbyApiKeyCiphertext: encrypted,
      selectedJobIds: jobs,
    });
    const { rows } = await getPool().query<SetupRow>(stmt.sql, [...stmt.params]);
    const row = rows[0];
    if (row?.identity_conflict) {
      return reply.code(409).send({
        error: "Ashby identity conflict: organizationId and emailDomain match different integrations.",
      });
    }

    const integrationId = stringValue(row?.integration_id);
    if (!integrationId) {
      return reply.code(500).send({ error: "Ashby integration setup did not return an integration id" });
    }

    return reply.code(201).send({
      integrationId,
      emailDomain: identity.emailDomain,
      selectedJobIds: jobs,
    });
  });

  app.post("/integrations/ashby/company-state", async (request, reply) => {
    const identity = companyIdentity(request.body);
    if (!identity) {
      return reply.code(400).send({ error: "valid emailDomain is required" });
    }

    const integration = await integrationForIdentity(identity);
    const integrationId = integrationIdFrom(integration);
    return reply.send({
      connected: Boolean(integration?.connected_at),
      setupStatus: stringValue(integration?.setup_status) ?? "job_selection_pending",
      integrationId,
      emailDomain: stringValue(integration?.email_domain) ?? identity.emailDomain,
      selectedJobIds: stringArray(integration?.selected_job_ids),
      lastPingAt: integration?.last_ping_at ?? null,
      lastSyncAt: integration?.last_sync_at ?? null,
      webhookUrlPath: integrationId
        ? `/api/ashby/webhook?integrationId=${encodeURIComponent(integrationId)}`
        : null,
    });
  });

  app.post<{ Body: AshbyWebhookEnvelope }>("/integrations/ashby/webhook", async (request, reply) => {
    const envelope = objectValue(request.body);
    const integration = await integrationForWebhook({
      integrationId: stringValue(envelope?.integrationId),
      companyDomain: stringValue(envelope?.companyDomain),
    });
    const resolvedIntegrationId = integrationIdFrom(integration);
    if (!resolvedIntegrationId) {
      return reply.code(404).send({ error: "Ashby integration is not configured" });
    }

    let payload: AshbyWebhookPayload | null = null;
    const rawBody = typeof envelope?.rawBody === "string" ? envelope.rawBody : null;
    if (rawBody !== null) {
      const encryptedWebhookSecret = stringValue(integration?.ashby_webhook_secret_ciphertext);
      if (!encryptedWebhookSecret) {
        return reply.code(404).send({ error: "Ashby webhook secret is not configured" });
      }

      const webhookSecret = decryptIntegrationSecret(
        encryptedWebhookSecret,
        integrationSecretKeyFromEnv(),
      );
      if (
        !verifyAshbyWebhookSignature({
          body: rawBody,
          secret: webhookSecret,
          signature: stringValue(envelope?.signature),
        })
      ) {
        return reply.code(401).send({ error: "invalid webhook signature" });
      }

      try {
        payload = JSON.parse(rawBody) as AshbyWebhookPayload;
      } catch {
        return reply.code(400).send({ error: "invalid Ashby webhook json" });
      }
    } else {
      payload = objectValue(envelope?.payload) as AshbyWebhookPayload | null;
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

    const webhookActionId = stringValue(payload.webhookActionId);
    if (!webhookActionId) {
      return reply.code(400).send({ error: "webhookActionId is required" });
    }

    const insert = webhookEventInsertStatement({
      webhookActionId,
      integrationId: resolvedIntegrationId,
      action,
      payload,
    });
    const inserted = await getPool().query<WebhookEventRow>(insert.sql, [...insert.params]);
    const eventRow = inserted.rows[0];
    if (eventRow?.inserted === false && eventRow.processed_at) {
      return reply.send({ ok: true, duplicate: true });
    }

    if (resolvedIntegrationId && ACTIVE_APPLICATION_ACTIONS.has(action)) {
      const application = applicationFromPayload(payload);
      if (application) {
        const synced = syncedApplicationFromAshby({
          integrationId: resolvedIntegrationId,
          application,
        });
        if (synced) {
          const upsert = activeApplicationUpsertStatement({
            ...synced,
            status: action === "candidateHire" ? "Hired" : synced.status,
          });
          await getPool().query(upsert.sql, [...upsert.params]);
        }
      }
    }

    const candidateId = candidateIdFromPayload(payload);
    if (resolvedIntegrationId && candidateId && INACTIVE_CANDIDATE_ACTIONS.has(action)) {
      const inactive = inactiveCandidateApplicationsStatement({
        integrationId: resolvedIntegrationId,
        candidateId,
        status: action === "candidateDelete" ? "Deleted" : "Merged",
      });
      await getPool().query(inactive.sql, [...inactive.params]);
    }

    const processed = webhookEventProcessedStatement(webhookActionId);
    await getPool().query(processed.sql, [...processed.params]);
    return reply.send({ ok: true, action });
  });

  app.post<{ Body: AshbySyncRequest }>(
    "/integrations/ashby/sync-active-applications",
    async (request, reply) => {
      const identity = companyIdentity(request.body);
      if (!identity) {
        return reply.code(400).send({ error: "valid emailDomain is required" });
      }

      const integration = await integrationForIdentity(identity);
      const integrationId = integrationIdFrom(integration);
      if (!integrationId) {
        return reply.code(404).send({ error: "Ashby integration is not configured" });
      }

      if (!integration?.connected_at) {
        return reply.code(409).send({ error: "Ashby webhook ping has not been verified" });
      }

      const secretLookup = integrationSecretLookupStatement(integrationId);
      const secretResult = await getPool().query<IntegrationRow>(secretLookup.sql, [
        ...secretLookup.params,
      ]);
      const configuredIntegration = secretResult.rows[0];
      const encryptedApiKey = stringValue(configuredIntegration?.ashby_api_key_ciphertext);
      const jobIds = stringArray(configuredIntegration?.selected_job_ids);
      if (!encryptedApiKey || jobIds.length === 0) {
        return reply.code(404).send({ error: "Ashby integration is not configured" });
      }

      const apiKey = decryptIntegrationSecret(encryptedApiKey, integrationSecretKeyFromEnv());
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
      return reply.send({ ok: true, syncedCount });
    },
  );

  app.post("/integrations/ashby/applications/search", async (request, reply) => {
    const identity = companyIdentity(request.body);
    const body = objectValue(request.body);
    if (!identity) {
      return reply.code(400).send({ error: "valid emailDomain is required" });
    }

    const integration = await integrationForIdentity(identity);
    const integrationId = integrationIdFrom(integration);
    if (!integrationId) {
      return reply.code(404).send({ error: "Ashby integration is not configured" });
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
    const roleId = stringValue(body?.roleId);
    const reviewerEmail = stringValue(body?.reviewerEmail);
    if (
      !identity ||
      !applicationId ||
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

    const stmt = scoreUpsertStatement({
      integrationId,
      emailDomain: identity.emailDomain,
      organizationId: identity.organizationId,
      applicationId,
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
      return reply.code(400).send({ error: "valid emailDomain is required" });
    }

    const integration = await integrationForIdentity(identity);
    const integrationId = integrationIdFrom(integration);
    if (!integrationId) {
      return reply.code(404).send({ error: "Ashby integration is not configured" });
    }

    const stmt = recentScreensStatement({
      integrationId,
      limit: limitValue(body?.limit, 20, 50),
    });
    const { rows } = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.send({ screens: rows });
  });
}
