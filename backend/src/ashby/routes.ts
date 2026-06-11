import type { FastifyInstance } from "fastify";
import { getPool } from "../db/pool.js";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  integrationSecretKeyFromEnv,
} from "./crypto.js";
import { listActiveApplicationsForJob, syncedApplicationFromAshby } from "./client.js";
import {
  activeApplicationForJobStatement,
  activeApplicationUpsertStatement,
  inactiveCandidateApplicationsStatement,
  integrationByIdStatement,
  integrationLookupStatement,
  integrationSetupUpsertStatement,
  isValidEmailDomain,
  markIntegrationPingStatement,
  normalizeEmailDomain,
  recentScreensStatement,
  scoreUpsertStatement,
  searchActiveApplicationsStatement,
  webhookEventInsertStatement,
  webhookEventProcessedStatement,
} from "./repository.js";
import type {
  AshbySetupRequest,
  AshbyWebhookEnvelope,
  AshbyWebhookPayload,
  CompanyIdentity,
  ScoreInput,
} from "./types.js";

interface IntegrationRow {
  readonly integration_id?: unknown;
  readonly email_domain?: unknown;
  readonly ashby_api_key_ciphertext?: unknown;
  readonly selected_job_ids?: unknown;
  readonly connected_at?: unknown;
  readonly last_ping_at?: unknown;
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
    return reply.send({
      connected: Boolean(integration?.connected_at),
      integrationId: integrationIdFrom(integration),
      emailDomain: stringValue(integration?.email_domain) ?? identity.emailDomain,
      selectedJobIds: stringArray(integration?.selected_job_ids),
      lastPingAt: integration?.last_ping_at ?? null,
    });
  });

  app.post<{ Body: AshbyWebhookEnvelope }>("/integrations/ashby/webhook", async (request, reply) => {
    const envelope = objectValue(request.body);
    const payload = objectValue(envelope?.payload) as AshbyWebhookPayload | null;
    const action = stringValue(payload?.action);
    if (!payload || !action) {
      return reply.code(400).send({ error: "valid Ashby webhook payload is required" });
    }

    const integration = await integrationForWebhook({
      integrationId: stringValue(envelope?.integrationId),
      companyDomain: stringValue(envelope?.companyDomain),
    });
    const resolvedIntegrationId = integrationIdFrom(integration);
    if (!resolvedIntegrationId) {
      return reply.code(404).send({ error: "Ashby integration is not configured" });
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

  app.post("/integrations/ashby/sync-active-applications", async (request, reply) => {
    const identity = companyIdentity(request.body);
    if (!identity) {
      return reply.code(400).send({ error: "valid emailDomain is required" });
    }

    const integration = await integrationForIdentity(identity);
    const integrationId = integrationIdFrom(integration);
    const encryptedApiKey = stringValue(integration?.ashby_api_key_ciphertext);
    const jobIds = stringArray(integration?.selected_job_ids);
    if (!integrationId || !encryptedApiKey || jobIds.length === 0) {
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

    return reply.send({ ok: true, syncedCount });
  });

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
