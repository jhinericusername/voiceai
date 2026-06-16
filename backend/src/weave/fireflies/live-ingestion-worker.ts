import { pathToFileURL } from "node:url";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import {
  closePool,
  closeWeavePool,
  getPool,
  getWeavePool,
} from "../../db/pool.js";
import {
  executeHistoricalFirefliesImport,
  type ExecuteHistoricalFirefliesImportInput,
  type ExecuteHistoricalFirefliesImportResult,
  type PuddleDb,
  type S3LikeClient,
} from "./historicalImportExecutor.js";
import {
  buildHistoricalFirefliesInventory,
  type HistoricalFirefliesRecording,
} from "./historicalInventory.js";
import type { Queryable } from "./historicalWeaveMatches.js";
import {
  buildSingleRecordingImportInput,
  firefliesRecordingPrefixFromKey,
  firefliesRecordingReadiness,
} from "./liveIngestion.js";

export interface SqsLikeClient {
  send(command: unknown): Promise<unknown>;
}

export interface FirefliesLiveIngestionMessage {
  readonly body: string;
  readonly receiptHandle: string;
}

export interface ProcessFirefliesLiveIngestionMessageInput {
  readonly message: FirefliesLiveIngestionMessage;
  readonly queueUrl: string;
  readonly sourceBucket: string;
  readonly sourceRootPrefix: string;
  readonly sourceRegion?: string;
  readonly targetBucket: string;
  readonly targetRegion?: string;
  readonly orgId: string;
  readonly sourceS3: S3LikeClient;
  readonly targetS3: S3LikeClient;
  readonly sqs: SqsLikeClient;
  readonly weaveDb: Queryable;
  readonly puddleDb: PuddleDb;
  readonly requeueVisibilitySeconds?: number;
  readonly execute?: (
    input: ExecuteHistoricalFirefliesImportInput,
  ) => Promise<ExecuteHistoricalFirefliesImportResult>;
}

export interface FirefliesLiveIngestionMessageResult {
  readonly status: "ignored" | "requeued" | "imported";
  readonly prefixes: readonly string[];
  readonly importedCount: number;
  readonly missingRequiredKinds: readonly string[];
}

export interface RunFirefliesLiveIngestionWorkerOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly sourceS3?: S3LikeClient;
  readonly targetS3?: S3LikeClient;
  readonly sqs?: SqsLikeClient;
  readonly createSqsClient?: (region: string) => SqsLikeClient;
  readonly weaveDb?: Queryable;
  readonly puddleDb?: PuddleDb;
  readonly execute?: (
    input: ExecuteHistoricalFirefliesImportInput,
  ) => Promise<ExecuteHistoricalFirefliesImportResult>;
  readonly write?: (message: string) => void;
  readonly once?: boolean;
  readonly pollWaitSeconds?: number;
  readonly maxNumberOfMessages?: number;
}

interface S3EventRecord {
  readonly s3?: {
    readonly object?: {
      readonly key?: unknown;
    };
  };
}

interface ListableSourceObject {
  readonly key: string;
  readonly size: number | null;
}

const defaultSourceRootPrefix = "raw/fireflies/";
const defaultSourceRegion = "us-west-2";
const defaultTargetRegion = "us-west-1";
const defaultRequeueVisibilitySeconds = 120;

export function s3ObjectKeysFromEventBody(body: string): string[] {
  const value = parseJsonObject(body);
  const event = typeof value.Message === "string" ? parseJsonObject(value.Message) : value;
  const records = Array.isArray(event.Records) ? event.Records : [];
  const keys: string[] = [];

  for (const record of records) {
    const key = (record as S3EventRecord).s3?.object?.key;
    if (typeof key === "string" && key.length > 0) {
      keys.push(decodeS3ObjectKey(key));
    }
  }

  return keys;
}

export function uniqueFirefliesRecordingPrefixesFromMessageBody(
  body: string,
  sourceRootPrefix: string,
): string[] {
  const prefixes = new Set<string>();
  for (const key of s3ObjectKeysFromEventBody(body)) {
    const prefix = firefliesRecordingPrefixFromKey(key, sourceRootPrefix);
    if (prefix) prefixes.add(prefix);
  }
  return [...prefixes].sort((left, right) => left.localeCompare(right));
}

export async function processFirefliesLiveIngestionMessage(
  input: ProcessFirefliesLiveIngestionMessageInput,
): Promise<FirefliesLiveIngestionMessageResult> {
  const sourceRootPrefix = normalizedPrefix(input.sourceRootPrefix);
  const prefixes = uniqueFirefliesRecordingPrefixesFromMessageBody(
    input.message.body,
    sourceRootPrefix,
  );

  if (prefixes.length === 0) {
    await deleteMessage(input.sqs, input.queueUrl, input.message.receiptHandle);
    return {
      status: "ignored",
      prefixes,
      importedCount: 0,
      missingRequiredKinds: [],
    };
  }

  const recordings = await Promise.all(
    prefixes.map((prefix) =>
      loadRecordingFromPrefix(input.sourceS3, input.sourceBucket, prefix, sourceRootPrefix),
    ),
  );
  const missingRequiredKinds = missingRequiredKindsFor(recordings);

  if (missingRequiredKinds.length > 0) {
    await requeueMessage(
      input.sqs,
      input.queueUrl,
      input.message.receiptHandle,
      input.requeueVisibilitySeconds ?? defaultRequeueVisibilitySeconds,
    );
    return {
      status: "requeued",
      prefixes,
      importedCount: 0,
      missingRequiredKinds,
    };
  }

  const execute = input.execute ?? executeHistoricalFirefliesImport;
  let importedCount = 0;
  for (let index = 0; index < prefixes.length; index += 1) {
    try {
      const recording = recordings[index];
      const prefix = prefixes[index];
      if (!recording || !prefix) {
        throw new Error("Fireflies recording readiness changed before import");
      }
      const result = await execute(
        buildSingleRecordingImportInput({
          orgId: input.orgId,
          sourceBucket: input.sourceBucket,
          sourceRegion: input.sourceRegion ?? defaultSourceRegion,
          sourceRootPrefix,
          recordingPrefix: prefix,
          targetBucket: input.targetBucket,
          targetRegion: input.targetRegion ?? defaultTargetRegion,
          sourceS3: input.sourceS3,
          targetS3: input.targetS3,
          weaveDb: input.weaveDb,
          puddleDb: input.puddleDb,
        }),
      );
      importedCount += result.importedCount;
    } catch (error) {
      throw new Error(safeErrorMessage(error));
    }
  }

  await deleteMessage(input.sqs, input.queueUrl, input.message.receiptHandle);
  return {
    status: "imported",
    prefixes,
    importedCount,
    missingRequiredKinds: [],
  };
}

export async function runFirefliesLiveIngestionWorker(
  options: RunFirefliesLiveIngestionWorkerOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const config = workerConfigFromEnv(env);
  const sourceS3 = options.sourceS3 ?? new S3Client({ region: config.sourceRegion });
  const targetS3 = options.targetS3 ?? new S3Client({ region: config.targetRegion });
  const sqs =
    options.sqs ??
    (options.createSqsClient ?? ((region: string) => new SQSClient({ region })))(
      config.sourceRegion,
    );
  const weaveDb = options.weaveDb ?? getWeavePool();
  const puddleDb = options.puddleDb ?? getPool();
  const write = options.write ?? ((message: string) => process.stdout.write(message));
  const pollWaitSeconds = options.pollWaitSeconds ?? 20;
  const maxNumberOfMessages = options.maxNumberOfMessages ?? 5;

  try {
    do {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: config.queueUrl,
          MaxNumberOfMessages: maxNumberOfMessages,
          WaitTimeSeconds: pollWaitSeconds,
        }),
      );
      const messages = receivedMessages(response);
      for (const message of messages) {
        try {
          const result = await processFirefliesLiveIngestionMessage({
            message,
            queueUrl: config.queueUrl,
            sourceBucket: config.sourceBucket,
            sourceRootPrefix: config.sourceRootPrefix,
            sourceRegion: config.sourceRegion,
            targetBucket: config.targetBucket,
            targetRegion: config.targetRegion,
            orgId: config.orgId,
            sourceS3,
            targetS3,
            sqs,
            weaveDb,
            puddleDb,
            execute: options.execute,
          });
          write(
            [
              `status=${result.status}`,
              `prefix_count=${result.prefixes.length}`,
              `imported_count=${result.importedCount}`,
              `missing_required_kinds=${result.missingRequiredKinds.join(",")}`,
            ].join(" ") + "\n",
          );
        } catch (error) {
          write(`status=failed message=${safeErrorMessage(error)}\n`);
        }
      }
    } while (!options.once);
  } finally {
    if (!options.puddleDb) {
      await closePool();
    }
    if (!options.weaveDb) {
      await closeWeavePool();
    }
  }
}

async function loadRecordingFromPrefix(
  sourceS3: S3LikeClient,
  sourceBucket: string,
  recordingPrefix: string,
  sourceRootPrefix: string,
): Promise<HistoricalFirefliesRecording | null> {
  const objects = await listSourceObjects(sourceS3, sourceBucket, recordingPrefix);
  const inventory = buildHistoricalFirefliesInventory(
    objects.map((object) => object.key),
    sourceRootPrefix,
  );
  return inventory.find((recording) => recording.prefix === recordingPrefix) ?? null;
}

async function listSourceObjects(
  sourceS3: S3LikeClient,
  sourceBucket: string,
  sourcePrefix: string,
): Promise<ListableSourceObject[]> {
  const objects: ListableSourceObject[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await sourceS3.send(
      new ListObjectsV2Command({
        Bucket: sourceBucket,
        Prefix: sourcePrefix,
        ContinuationToken: continuationToken,
      }),
    );
    const contents = Array.isArray((response as { Contents?: unknown }).Contents)
      ? ((response as { Contents?: unknown[] }).Contents ?? [])
      : [];
    for (const object of contents) {
      const key = (object as { Key?: unknown }).Key;
      if (typeof key !== "string") continue;
      const size = (object as { Size?: unknown }).Size;
      objects.push({
        key,
        size: typeof size === "number" && Number.isFinite(size) ? size : null,
      });
    }
    const nextToken = (response as { NextContinuationToken?: unknown }).NextContinuationToken;
    continuationToken = typeof nextToken === "string" ? nextToken : undefined;
  } while (continuationToken);

  return objects;
}

function missingRequiredKindsFor(
  recordings: readonly (HistoricalFirefliesRecording | null)[],
): string[] {
  const missing = new Set<string>();
  for (const recording of recordings) {
    if (!recording) {
      missing.add("folder");
      continue;
    }
    for (const kind of firefliesRecordingReadiness(recording).missingRequiredKinds) {
      missing.add(kind);
    }
  }
  return [...missing].sort((left, right) => left.localeCompare(right));
}

async function deleteMessage(
  sqs: SqsLikeClient,
  queueUrl: string,
  receiptHandle: string,
): Promise<void> {
  await sqs.send(
    new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
    }),
  );
}

async function requeueMessage(
  sqs: SqsLikeClient,
  queueUrl: string,
  receiptHandle: string,
  visibilityTimeout: number,
): Promise<void> {
  await sqs.send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: visibilityTimeout,
    }),
  );
}

function receivedMessages(response: unknown): FirefliesLiveIngestionMessage[] {
  const messages = Array.isArray((response as { Messages?: unknown }).Messages)
    ? ((response as { Messages?: unknown[] }).Messages ?? [])
    : [];
  return messages.flatMap((message) => {
    const body = (message as { Body?: unknown }).Body;
    const receiptHandle = (message as { ReceiptHandle?: unknown }).ReceiptHandle;
    return typeof body === "string" && typeof receiptHandle === "string"
      ? [{ body, receiptHandle }]
      : [];
  });
}

function workerConfigFromEnv(env: NodeJS.ProcessEnv) {
  const queueUrl = requiredEnv(env, "FIREFLIES_INGESTION_QUEUE_URL");
  const orgId = requiredEnv(env, "FIREFLIES_INGESTION_ORG_ID");
  const sourceBucket = requiredEnv(env, "WEAVE_HISTORICAL_RECORDINGS_BUCKET");
  const targetBucket = requiredEnv(env, "PUDDLE_ARTIFACTS_BUCKET");
  const sourceRootPrefix =
    nonEmpty(env.WEAVE_HISTORICAL_RECORDINGS_PREFIX) ?? defaultSourceRootPrefix;
  const sourceRegion =
    nonEmpty(env.WEAVE_HISTORICAL_RECORDINGS_REGION) ?? defaultSourceRegion;
  const targetRegion =
    nonEmpty(env.PUDDLE_ARTIFACTS_REGION) ?? nonEmpty(env.AWS_REGION) ?? defaultTargetRegion;

  return {
    queueUrl,
    orgId,
    sourceBucket,
    targetBucket,
    sourceRootPrefix,
    sourceRegion,
    targetRegion,
  };
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = nonEmpty(env[key]);
  if (!value) {
    throw new Error(`${key} must be set`);
  }
  return value;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function decodeS3ObjectKey(key: string): string {
  return decodeURIComponent(key.replace(/\+/g, " "));
}

function normalizedPrefix(prefix: string): string {
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n", 1)[0]?.replace(/:\s+.+$/, "").slice(0, 300) ?? "unknown error";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFirefliesLiveIngestionWorker().catch((error: unknown) => {
    process.stderr.write(`${safeErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
