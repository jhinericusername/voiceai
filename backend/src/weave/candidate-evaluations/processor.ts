import type { Pool, PoolClient } from "pg";
import {
  stableWeaveEvaluationPayloadHash,
  weaveReviewerEmail,
  type WeaveCandidateEvaluationEvent,
} from "./payload.js";
import {
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

    const scoreId = stableTargetId("score", evaluation.sourceEvaluationId);
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
    await client.query("ROLLBACK");
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
