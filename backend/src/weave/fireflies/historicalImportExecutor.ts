import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { buildHistoricalFirefliesInventory } from "./historicalInventory.js";
import { buildHistoricalImportPlan } from "./historicalImportPlan.js";
import type { HistoricalFirefliesRecording } from "./historicalInventory.js";
import type { HistoricalImportPlan } from "./historicalImportPlan.js";
import {
  historicalImportRunFinishStatement,
  historicalImportRunInsertStatement,
  historicalRecordingArtifactUpsertStatement,
  historicalRecordingUpsertStatement,
  historicalSessionLegacyIdentityReconcileStatement,
  historicalSessionSourceLookupStatement,
  historicalSessionUpsertStatement,
  historicalTranscriptTurnUpsertStatement,
} from "./historicalImportRepository.js";
import {
  loadHistoricalWeaveMatchBundle,
  type Queryable,
} from "./historicalWeaveMatches.js";

export type HistoricalImportMode = "dry-run" | "apply";

export interface S3LikeClient {
  send(command: unknown): Promise<unknown>;
}

export interface PuddleDbClient {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}

export interface PuddleDb extends Queryable {
  connect(): Promise<PuddleDbClient>;
}

export interface ExecuteHistoricalFirefliesImportInput {
  readonly mode?: HistoricalImportMode;
  readonly orgId: string;
  readonly sourceBucket: string;
  readonly sourcePrefix: string;
  readonly sourceRootPrefix?: string;
  readonly targetBucket: string;
  readonly sourceS3: S3LikeClient | S3Client;
  readonly targetS3: S3LikeClient | S3Client;
  readonly weaveDb: Queryable;
  readonly puddleDb?: PuddleDb;
  readonly limit?: number;
  readonly sinceDate?: string;
  readonly untilDate?: string;
  readonly batchSize?: number;
  readonly importRunId?: string;
}

export interface ExecuteHistoricalFirefliesImportResult {
  readonly mode: HistoricalImportMode;
  readonly plannedCount: number;
  readonly importedCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  readonly copyCount: number;
  readonly skippedCopyCount: number;
  readonly dbWriteCount: number;
  readonly selectedMatches: number;
  readonly rankedMatchCandidates: number;
  readonly unindexedRecordings: number;
  readonly plans: readonly HistoricalImportPlan[];
  readonly failures: readonly { readonly transcriptId: string; readonly message: string }[];
}

interface SourceObject {
  readonly key: string;
  readonly size: number | null;
}

interface MutableCounters {
  importedCount: number;
  skippedCount: number;
  copyCount: number;
  skippedCopyCount: number;
  dbWriteCount: number;
}

interface ExistingHistoricalSessionSource {
  readonly sessionId: string;
  readonly orgId: string;
  readonly externalId: string;
  readonly sourceMetadata: unknown;
}

export async function executeHistoricalFirefliesImport(
  input: ExecuteHistoricalFirefliesImportInput,
): Promise<ExecuteHistoricalFirefliesImportResult> {
  const mode = input.mode ?? "dry-run";
  if (mode === "apply" && !input.puddleDb) {
    throw new Error("puddleDb is required when historical Fireflies import mode is apply");
  }

  const sourceObjects = await listSourceObjects(input.sourceS3, input.sourceBucket, input.sourcePrefix);
  const sourceSizes = new Map(sourceObjects.map((object) => [object.key, object.size]));
  const recordings = applyRecordingFilters(
    buildHistoricalFirefliesInventory(
      sourceObjects.map((object) => object.key),
      input.sourceRootPrefix ?? input.sourcePrefix,
    ),
    input,
  );
  const plans: HistoricalImportPlan[] = [];
  const failures: { transcriptId: string; message: string }[] = [];

  for (const recording of recordings) {
    try {
      const plan = await buildPlanForRecording(input, recording);
      plans.push(plan);
    } catch (error) {
      failures.push({
        transcriptId: recording.transcriptId,
        message: errorMessage(error),
      });
    }
  }

  const counters: MutableCounters = {
    importedCount: 0,
    skippedCount: 0,
    copyCount: mode === "dry-run" ? plans.reduce((count, plan) => count + plan.copies.length, 0) : 0,
    skippedCopyCount: 0,
    dbWriteCount: 0,
  };

  if (mode === "apply") {
    await applyPlans(input, plans, sourceSizes, counters, failures);
  }

  return {
    mode,
    plannedCount: plans.length,
    importedCount: counters.importedCount,
    skippedCount: counters.skippedCount,
    failedCount: failures.length,
    copyCount: counters.copyCount,
    skippedCopyCount: counters.skippedCopyCount,
    dbWriteCount: counters.dbWriteCount,
    selectedMatches: plans.filter((plan) => plan.session.sourceMetadata.ashby.selected !== null)
      .length,
    rankedMatchCandidates: plans.reduce(
      (count, plan) => count + plan.session.sourceMetadata.ashby.matchCandidates.length,
      0,
    ),
    unindexedRecordings: plans.filter(
      (plan) => plan.session.sourceMetadata.fireflies.matchStatus === "unindexed",
    ).length,
    plans,
    failures,
  };
}

async function buildPlanForRecording(
  input: ExecuteHistoricalFirefliesImportInput,
  recording: HistoricalFirefliesRecording,
): Promise<HistoricalImportPlan> {
  if (!recording.transcriptKey) {
    throw new Error(`Fireflies transcript is required for transcript ${recording.transcriptId}`);
  }

  const [metadata, transcript, summary, ingestionResult, weaveBundle] = await Promise.all([
    readOptionalJsonObject(input.sourceS3, input.sourceBucket, recording.metadataKey),
    readRequiredJsonObject(input.sourceS3, input.sourceBucket, recording.transcriptKey),
    readOptionalJsonObject(input.sourceS3, input.sourceBucket, recording.summaryKey),
    readOptionalJsonObject(input.sourceS3, input.sourceBucket, recording.ingestionResultKey),
    loadHistoricalWeaveMatchBundle(input.weaveDb, recording.transcriptId),
  ]);

  return buildHistoricalImportPlan({
    orgId: input.orgId,
    sourceBucket: input.sourceBucket,
    targetBucket: input.targetBucket,
    recording,
    metadata,
    transcript,
    summary,
    ingestionResult,
    weaveMatch: weaveBundle.weaveMatch,
    weaveMatchCandidates: weaveBundle.weaveMatchCandidates,
  });
}

async function applyPlans(
  input: ExecuteHistoricalFirefliesImportInput,
  plans: readonly HistoricalImportPlan[],
  sourceSizes: ReadonlyMap<string, number | null>,
  counters: MutableCounters,
  failures: { transcriptId: string; message: string }[],
): Promise<void> {
  const puddleDb = input.puddleDb;
  if (!puddleDb) throw new Error("puddleDb is required when historical Fireflies import mode is apply");
  const importRunId = input.importRunId ?? `fireflies-historical-${new Date().toISOString()}`;
  const copiedPlans: HistoricalImportPlan[] = [];

  for (const plan of plans) {
    try {
      await preflightPlanSource(puddleDb, plan);
      await copyPlanObjects(input.sourceS3, input.targetS3, plan, sourceSizes, counters);
      copiedPlans.push(plan);
    } catch (error) {
      failures.push({
        transcriptId: plan.session.sourceMetadata.fireflies.transcriptId,
        message: errorMessage(error),
      });
    }
  }

  await executeStatement(
    puddleDb,
    historicalImportRunInsertStatement({
      importRunId,
      source: "fireflies",
      orgId: input.orgId,
      sourceBucket: input.sourceBucket,
      sourcePrefix: input.sourcePrefix,
      targetBucket: input.targetBucket,
      mode: "apply",
      plannedCount: plans.length,
      summary: importSummary(counters, failures),
    }),
  );

  for (const plan of copiedPlans) {
    try {
      const writes = await writePlan(puddleDb, plan);
      counters.dbWriteCount += writes;
      counters.importedCount += 1;
    } catch (error) {
      failures.push({
        transcriptId: plan.session.sourceMetadata.fireflies.transcriptId,
        message: errorMessage(error),
      });
    }
  }

  await executeStatement(
    puddleDb,
    historicalImportRunFinishStatement({
      importRunId,
      importedCount: counters.importedCount,
      skippedCount: counters.skippedCount,
      failedCount: failures.length,
      summary: importSummary(counters, failures),
    }),
  );
}

async function preflightPlanSource(
  puddleDb: PuddleDb,
  plan: HistoricalImportPlan,
): Promise<void> {
  const legacyExternalId = plan.session.sourceMetadata.fireflies.transcriptId;
  const lookup = await executeStatement(
    puddleDb,
    historicalSessionSourceLookupStatement({
      externalSource: plan.session.externalSource,
      occurrenceExternalId: plan.session.externalId,
      legacyExternalId,
    }),
  );
  const existingSources = lookup.rows.map(existingHistoricalSessionSource).filter(isNonNull);

  for (const existing of existingSources) {
    if (existing.orgId !== plan.session.orgId) {
      throw new Error(
        `Historical Fireflies source ${existing.externalId} already belongs to org ${existing.orgId}`,
      );
    }
  }

  const occurrence = existingSources.find(
    (existing) => existing.externalId === plan.session.externalId,
  );
  if (occurrence) return;

  const legacy = existingSources.find((existing) => existing.externalId === legacyExternalId);
  if (!legacy) return;
  if (!isCompatibleLegacySource(legacy.sourceMetadata, plan)) {
    throw new Error(
      `Historical Fireflies legacy source ${legacyExternalId} does not match the planned source location`,
    );
  }

  const reconcile = await executeStatement(
    puddleDb,
    historicalSessionLegacyIdentityReconcileStatement({
      externalSource: plan.session.externalSource,
      legacyExternalId,
      occurrenceExternalId: plan.session.externalId,
      orgId: plan.session.orgId,
      sourceMetadata: plan.session.sourceMetadata,
    }),
  );
  const reconciledSessionId = stringValue(reconcile.rows[0]?.session_id);
  if (!reconciledSessionId) {
    throw new Error(
      `Unable to reconcile historical Fireflies legacy source ${legacyExternalId} to occurrence ${plan.session.externalId}`,
    );
  }
}

async function writePlan(puddleDb: PuddleDb, plan: HistoricalImportPlan): Promise<number> {
  const client = await puddleDb.connect();
  let writeCount = 0;
  try {
    await client.query("BEGIN");
    const sessionStatement = historicalSessionUpsertStatement(plan.session);
    const sessionResult = await executeStatement(client, sessionStatement);

    const canonicalSessionId = stringValue(sessionResult.rows[0]?.session_id);
    if (!canonicalSessionId) {
      throw new Error(
        `Historical Fireflies session upsert returned no row for org ${plan.session.orgId}; possible cross-org source conflict`,
      );
    }
    writeCount += 1;

    await executeStatement(client, {
      ...historicalRecordingUpsertStatement({
        ...plan.recording,
        sessionId: canonicalSessionId,
      }),
    });
    writeCount += 1;

    for (const artifact of plan.artifacts) {
      await executeStatement(
        client,
        historicalRecordingArtifactUpsertStatement({
          ...artifact,
          sessionId: canonicalSessionId,
        }),
      );
      writeCount += 1;
    }

    for (const turn of plan.transcriptTurns) {
      await executeStatement(
        client,
        historicalTranscriptTurnUpsertStatement({
          ...turn,
          sessionId: canonicalSessionId,
        }),
      );
      writeCount += 1;
    }

    await client.query("COMMIT");
    return writeCount;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function copyPlanObjects(
  sourceS3: S3LikeClient | S3Client,
  targetS3: S3LikeClient | S3Client,
  plan: HistoricalImportPlan,
  sourceSizes: ReadonlyMap<string, number | null>,
  counters: MutableCounters,
): Promise<void> {
  for (const copy of plan.copies) {
    const sourceSize = sourceSizes.get(copy.sourceKey) ?? null;
    if (await targetHasSameSize(targetS3, copy.targetBucket, copy.targetKey, sourceSize)) {
      counters.skippedCopyCount += 1;
      continue;
    }
    try {
      await targetS3.send(
        new CopyObjectCommand({
          Bucket: copy.targetBucket,
          Key: copy.targetKey,
          CopySource: `${copy.sourceBucket}/${encodeURIComponent(copy.sourceKey).replace(/%2F/g, "/")}`,
        }),
      );
    } catch (error) {
      if (!isCrossRegionVpcEndpointCopyError(error)) throw error;
      await streamCopyObject(sourceS3, targetS3, copy);
    }
    counters.copyCount += 1;
  }
}

async function streamCopyObject(
  sourceS3: S3LikeClient | S3Client,
  targetS3: S3LikeClient | S3Client,
  copy: HistoricalImportPlan["copies"][number],
): Promise<void> {
  const source = (await sourceS3.send(
    new GetObjectCommand({
      Bucket: copy.sourceBucket,
      Key: copy.sourceKey,
    }),
  )) as { Body?: unknown };
  if (!source.Body) {
    throw new Error(`Source object ${copy.sourceKey} has no body`);
  }
  await targetS3.send(
    new PutObjectCommand({
      Bucket: copy.targetBucket,
      Key: copy.targetKey,
      Body: source.Body as PutObjectCommandInput["Body"],
    }),
  );
}

async function targetHasSameSize(
  targetS3: S3LikeClient | S3Client,
  bucket: string,
  key: string,
  sourceSize: number | null,
): Promise<boolean> {
  if (sourceSize === null) return false;
  try {
    const head = (await targetS3.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    )) as { ContentLength?: number };
    return head.ContentLength === sourceSize;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function listSourceObjects(
  sourceS3: S3LikeClient | S3Client,
  bucket: string,
  prefix: string,
): Promise<SourceObject[]> {
  const objects: SourceObject[] = [];
  let continuationToken: string | undefined;
  do {
    const response = (await sourceS3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    )) as {
      Contents?: readonly { Key?: string; Size?: number }[];
      NextContinuationToken?: string;
    };
    for (const object of response.Contents ?? []) {
      if (!object.Key) continue;
      objects.push({
        key: object.Key,
        size: typeof object.Size === "number" ? object.Size : null,
      });
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  return objects;
}

function applyRecordingFilters(
  recordings: readonly HistoricalFirefliesRecording[],
  input: ExecuteHistoricalFirefliesImportInput,
): HistoricalFirefliesRecording[] {
  const filtered = recordings.filter((recording) => {
    if (input.sinceDate && (!recording.meetingDate || recording.meetingDate < input.sinceDate)) {
      return false;
    }
    if (input.untilDate && (!recording.meetingDate || recording.meetingDate > input.untilDate)) {
      return false;
    }
    return true;
  });
  const limited = typeof input.limit === "number" ? filtered.slice(0, input.limit) : filtered;
  return typeof input.batchSize === "number" ? limited.slice(0, input.batchSize) : limited;
}

async function readOptionalJsonObject(
  s3: S3LikeClient | S3Client,
  bucket: string,
  key: string | null,
): Promise<unknown> {
  if (!key) return {};
  try {
    return await readJsonObject(s3, bucket, key);
  } catch (error) {
    if (isNotFoundError(error)) return {};
    throw error;
  }
}

async function readRequiredJsonObject(
  s3: S3LikeClient | S3Client,
  bucket: string,
  key: string,
): Promise<unknown> {
  try {
    return await readJsonObject(s3, bucket, key);
  } catch (error) {
    throw new Error(`Unable to read Fireflies transcript artifact ${key}: ${errorMessage(error)}`);
  }
}

async function readJsonObject(
  s3: S3LikeClient | S3Client,
  bucket: string,
  key: string,
): Promise<unknown> {
  const response = (await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  )) as { Body?: unknown };
  const text = await bodyToString(response.Body);
  return text.trim() ? (JSON.parse(text) as unknown) : {};
}

async function bodyToString(body: unknown): Promise<string> {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (body && typeof body === "object") {
    const maybeTransform = body as { transformToString?: () => Promise<string> | string };
    if (typeof maybeTransform.transformToString === "function") {
      return await maybeTransform.transformToString();
    }
    if (Symbol.asyncIterator in body) {
      const chunks: Buffer[] = [];
      for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString("utf8");
    }
  }
  return "";
}

async function executeStatement(
  queryable: Queryable,
  statement: { readonly sql: string; readonly params?: readonly unknown[] },
): Promise<{ rows: Record<string, unknown>[] }> {
  return await queryable.query(statement.sql, statement.params);
}

function existingHistoricalSessionSource(
  row: Record<string, unknown>,
): ExistingHistoricalSessionSource | null {
  const sessionId = stringValue(row.session_id);
  const orgId = stringValue(row.org_id);
  const externalId = stringValue(row.external_id);
  if (!sessionId || !orgId || !externalId) return null;
  return {
    sessionId,
    orgId,
    externalId,
    sourceMetadata: row.source_metadata,
  };
}

function isCompatibleLegacySource(
  sourceMetadata: unknown,
  plan: HistoricalImportPlan,
): boolean {
  const metadata = asRecord(sourceMetadata);
  const fireflies = asRecord(metadata.fireflies);
  return (
    stringValue(fireflies.transcriptId) === plan.session.sourceMetadata.fireflies.transcriptId &&
    stringValue(fireflies.sourceBucket) === plan.session.sourceMetadata.fireflies.sourceBucket &&
    stringValue(fireflies.sourcePrefix) === plan.session.sourceMetadata.fireflies.sourcePrefix
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}

function importSummary(
  counters: MutableCounters,
  failures: readonly { transcriptId: string; message: string }[],
): Record<string, unknown> {
  return {
    importedCount: counters.importedCount,
    skippedCount: counters.skippedCount,
    failedCount: failures.length,
    copyCount: counters.copyCount,
    skippedCopyCount: counters.skippedCopyCount,
    dbWriteCount: counters.dbWriteCount,
  };
}

function isNotFoundError(error: unknown): boolean {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const metadata = record.$metadata as Record<string, unknown> | undefined;
  return (
    record.name === "NotFound" ||
    record.name === "NoSuchKey" ||
    metadata?.httpStatusCode === 404
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCrossRegionVpcEndpointCopyError(error: unknown): boolean {
  return /VPC endpoints do not support cross-region requests/i.test(errorMessage(error));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
