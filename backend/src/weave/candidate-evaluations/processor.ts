import type { Pool, PoolClient } from "pg";
import {
  stableWeaveEvaluationPayloadHash,
  weaveReviewerEmail,
  type WeaveCandidateEvaluationEvent,
} from "./payload.js";
import {
  existingImportForUpdateStatement,
  importedApplicationUpsertStatement,
  importedScoreUpsertStatement,
  provenanceUpsertStatement,
  stableTargetId,
  weaveIntegrationForOrganizationStatement,
  weaveRoleProfileUpsertStatement,
} from "./repository.js";
import type { SqlStatement } from "../../consent/repository.js";

export interface ProcessWeaveCandidateEvaluationInput {
  readonly pool: Pick<Pool, "connect">;
  readonly organizationId: string;
  readonly event: WeaveCandidateEvaluationEvent;
}

export interface ProcessWeaveCandidateEvaluationResult {
  readonly status: "synced";
  readonly sourceEvaluationId: string;
  readonly applicationId: string;
  readonly scoreId: string;
}

export async function processWeaveCandidateEvaluationEvent(
  input: ProcessWeaveCandidateEvaluationInput,
): Promise<ProcessWeaveCandidateEvaluationResult> {
  const client = await input.pool.connect();

  try {
    await client.query("BEGIN");

    const evaluation = input.event.evaluation;
    const integration = await queryOne(
      client,
      weaveIntegrationForOrganizationStatement(input.organizationId),
    );
    const integrationId = stringValue(integration?.integration_id);
    if (!integrationId) {
      throw new Error(`No Ashby integration found for organization ${input.organizationId}`);
    }

    const scoreId = stableTargetId("score", evaluation.sourceEvaluationId);
    const existingImport = await queryOne(
      client,
      existingImportForUpdateStatement(evaluation.sourceEvaluationId),
    );
    if (isExistingImportNewer(existingImport?.source_updated_at, evaluation.sourceUpdatedAt)) {
      await client.query("COMMIT");
      return {
        status: "synced",
        sourceEvaluationId: evaluation.sourceEvaluationId,
        applicationId:
          stringValue(existingImport?.application_id) ?? evaluation.ashbyApplicationId,
        scoreId: stringValue(existingImport?.score_id) ?? scoreId,
      };
    }

    await queryOne(
      client,
      importedApplicationUpsertStatement({
        applicationId: evaluation.ashbyApplicationId,
        integrationId,
        candidateId: evaluation.ashbyCandidateId,
        candidateName: evaluation.candidateName,
        candidateEmail: null,
        jobId: evaluation.ashbyJobId,
        ashbyUpdatedAt: evaluation.sourceUpdatedAt,
        rawPayload: evaluation.rawRecord,
      }),
    );

    const roleProfileId = stableTargetId(
      "role",
      `${input.organizationId}:${evaluation.ashbyJobId}`,
    );
    const roleProfile = await queryOne(
      client,
      weaveRoleProfileUpsertStatement({
        profileId: roleProfileId,
        organizationId: input.organizationId,
        integrationId,
        ashbyJobId: evaluation.ashbyJobId,
      }),
    );

    const score = await queryOne(
      client,
      importedScoreUpsertStatement({
        scoreId,
        integrationId,
        applicationId: evaluation.ashbyApplicationId,
        roleId: evaluation.ashbyJobId,
        reviewerEmail: weaveReviewerEmail(evaluation.sourceEvaluationId),
        problemSolving: evaluation.problemSolving,
        agency: evaluation.agency,
        competitiveness: evaluation.competitiveness,
        curiosity: evaluation.curiosity,
        comments: evaluation.comments,
      }),
    );
    const resolvedScoreId = stringValue(score?.score_id) ?? scoreId;

    await queryOne(
      client,
      provenanceUpsertStatement({
        sourceEvaluationId: evaluation.sourceEvaluationId,
        organizationId: input.organizationId,
        integrationId,
        applicationId: evaluation.ashbyApplicationId,
        ashbyCandidateId: evaluation.ashbyCandidateId,
        ashbyJobId: evaluation.ashbyJobId,
        roleProfileId: stringValue(roleProfile?.profile_id) ?? roleProfileId,
        scoreId: resolvedScoreId,
        sourceCreatedAt: evaluation.sourceCreatedAt,
        sourceUpdatedAt: evaluation.sourceUpdatedAt,
        sourcePayloadHash: stableWeaveEvaluationPayloadHash(evaluation.rawRecord),
        lastEventId: input.event.eventId,
        syncStatus: "synced",
        syncError: null,
      }),
    );

    await client.query("COMMIT");

    return {
      status: "synced",
      sourceEvaluationId: evaluation.sourceEvaluationId,
      applicationId: evaluation.ashbyApplicationId,
      scoreId: resolvedScoreId,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original processing error.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function queryOne(
  client: PoolClient,
  statement: SqlStatement,
): Promise<Record<string, unknown> | undefined> {
  const result = await client.query(statement.sql, [...statement.params]);
  return result.rows[0] as Record<string, unknown> | undefined;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isExistingImportNewer(existingUpdatedAt: unknown, incomingUpdatedAt: unknown): boolean {
  const existingMillis = dateMillis(existingUpdatedAt);
  const incomingMillis = dateMillis(incomingUpdatedAt);
  return existingMillis !== null && incomingMillis !== null && existingMillis > incomingMillis;
}

function dateMillis(value: unknown): number | null {
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
