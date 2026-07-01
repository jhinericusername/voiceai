import { pathToFileURL } from "node:url";
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type { Pool } from "pg";
import { closePool, getPool } from "../../db/pool.js";
import {
  validateWeaveCandidateEvaluationEvent,
  type WeaveCandidateEvaluationEvent,
} from "./payload.js";
import {
  processWeaveCandidateEvaluationEvent,
  type ProcessWeaveCandidateEvaluationInput,
  type ProcessWeaveCandidateEvaluationResult,
} from "./processor.js";

export interface SqsLikeClient {
  send(command: unknown): Promise<unknown>;
}

export interface WeaveCandidateEvaluationSqsMessage {
  readonly body: string;
  readonly receiptHandle: string;
}

export interface ParsedWeaveCandidateEvaluationMessage {
  readonly organizationId: string;
  readonly event: WeaveCandidateEvaluationEvent;
}

export interface ProcessWeaveCandidateEvaluationMessageInput {
  readonly message: WeaveCandidateEvaluationSqsMessage;
  readonly queueUrl: string;
  readonly sqs: SqsLikeClient;
  readonly pool: Pick<Pool, "connect">;
  readonly process?: (
    input: ProcessWeaveCandidateEvaluationInput,
  ) => Promise<ProcessWeaveCandidateEvaluationResult>;
}

export interface ProcessWeaveCandidateEvaluationMessageResult {
  readonly status: "processed";
  readonly organizationId: string;
  readonly eventId: string;
}

export interface RunWeaveCandidateEvaluationWorkerOptions {
  readonly once?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly sqs?: SqsLikeClient;
  readonly createSqsClient?: (region: string) => SqsLikeClient;
  readonly pool?: Pick<Pool, "connect">;
  readonly write?: (message: string) => void;
  readonly pollWaitSeconds?: number;
  readonly maxNumberOfMessages?: number;
  readonly process?: (
    input: ProcessWeaveCandidateEvaluationInput,
  ) => Promise<ProcessWeaveCandidateEvaluationResult>;
}

const defaultRegion = "us-west-1";

export function parseWeaveCandidateEvaluationMessageBody(
  body: string,
): ParsedWeaveCandidateEvaluationMessage {
  const value = parseJsonObject(body);
  const organizationId = requiredString(value.organizationId);
  const event = eventValue(value.event);
  if (!organizationId || !event) {
    throw new Error("Invalid Weave candidate evaluation message");
  }
  return { organizationId, event };
}

export async function processWeaveCandidateEvaluationMessage(
  input: ProcessWeaveCandidateEvaluationMessageInput,
): Promise<ProcessWeaveCandidateEvaluationMessageResult> {
  const parsed = parseWeaveCandidateEvaluationMessageBody(input.message.body);
  const process = input.process ?? processWeaveCandidateEvaluationEvent;

  try {
    await process({
      pool: input.pool,
      organizationId: parsed.organizationId,
      event: parsed.event,
    });
  } catch (error) {
    throw new Error(safeErrorMessage(error));
  }

  await deleteMessage(input.sqs, input.queueUrl, input.message.receiptHandle);
  return {
    status: "processed",
    organizationId: parsed.organizationId,
    eventId: parsed.event.eventId,
  };
}

export async function runWeaveCandidateEvaluationWorker(
  options: RunWeaveCandidateEvaluationWorkerOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const config = workerConfigFromEnv(env);
  const sqs =
    options.sqs ??
    (options.createSqsClient ?? ((region: string) => new SQSClient({ region })))(
      config.region,
    );
  const pool = options.pool ?? getPool();
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

      for (const message of receivedMessages(response)) {
        try {
          const result = await processWeaveCandidateEvaluationMessage({
            message,
            queueUrl: config.queueUrl,
            sqs,
            pool,
            process: options.process,
          });
          write(
            [
              "status=processed",
              `organization_id=${result.organizationId}`,
              `event_id=${result.eventId}`,
            ].join(" ") + "\n",
          );
        } catch (error) {
          write(`status=failed message=${safeErrorMessage(error)}\n`);
        }
      }
    } while (!options.once);
  } finally {
    if (!options.pool) {
      await closePool();
    }
  }
}

function eventValue(value: unknown): WeaveCandidateEvaluationEvent | null {
  const rawValidation = validateWeaveCandidateEvaluationEvent(value);
  if (rawValidation.ok) {
    return rawValidation.event;
  }

  return normalizedEventValue(value);
}

function normalizedEventValue(value: unknown): WeaveCandidateEvaluationEvent | null {
  const event = asRecord(value);
  const evaluation = asRecord(event?.evaluation);
  const rawRecord = asRecord(evaluation?.rawRecord);
  const operation = event?.operation === "INSERT" || event?.operation === "UPDATE"
    ? event.operation
    : null;
  if (
    !event ||
    !evaluation ||
    !rawRecord ||
    !operation ||
    event.source !== "weave_supabase_candidate_evaluation"
  ) {
    return null;
  }

  const eventId = requiredString(event.eventId);
  const sourceEvaluationId = requiredString(evaluation.sourceEvaluationId);
  const candidateName = requiredString(evaluation.candidateName);
  const ashbyApplicationId = requiredString(evaluation.ashbyApplicationId);
  const ashbyCandidateId = requiredString(evaluation.ashbyCandidateId);
  const ashbyJobId = requiredString(evaluation.ashbyJobId);
  const problemSolving = scoreValue(evaluation.problemSolving);
  const agency = scoreValue(evaluation.agency);
  const competitiveness = scoreValue(evaluation.competitiveness);
  const curiosity = scoreValue(evaluation.curiosity);
  const totalScore = numberValue(evaluation.totalScore);
  const comments = typeof evaluation.comments === "string" ? evaluation.comments : null;
  if (
    !eventId ||
    !sourceEvaluationId ||
    !candidateName ||
    !ashbyApplicationId ||
    !ashbyCandidateId ||
    !ashbyJobId ||
    problemSolving === null ||
    agency === null ||
    competitiveness === null ||
    curiosity === null ||
    totalScore === null ||
    comments === null
  ) {
    return null;
  }

  return {
    eventId,
    source: "weave_supabase_candidate_evaluation",
    operation,
    evaluation: {
      sourceEvaluationId,
      candidateName,
      interviewDate: nullableString(evaluation.interviewDate),
      problemSolving,
      agency,
      competitiveness,
      curiosity,
      totalScore,
      comments,
      ashbyApplicationId,
      ashbyCandidateId,
      ashbyJobId,
      sourceCreatedAt: nullableString(evaluation.sourceCreatedAt),
      sourceUpdatedAt: nullableString(evaluation.sourceUpdatedAt),
      rawRecord,
    },
  };
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

function receivedMessages(response: unknown): WeaveCandidateEvaluationSqsMessage[] {
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
  return {
    queueUrl: requiredEnv(env, "WEAVE_CANDIDATE_EVALUATION_QUEUE_URL"),
    region: nonEmpty(env.AWS_REGION) ?? defaultRegion,
  };
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = nonEmpty(env[key]);
  if (!value) {
    throw new Error(`${key} must be set`);
  }
  return value;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function scoreValue(value: unknown): number | null {
  const parsed = numberValue(value);
  if (parsed === null || parsed < 0 || parsed > 4 || parsed * 2 !== Math.trunc(parsed * 2)) {
    return null;
  }
  return parsed;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n", 1)[0]?.replace(/:\s+.+$/, "").slice(0, 300) ?? "unknown error";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWeaveCandidateEvaluationWorker().catch((error: unknown) => {
    process.stderr.write(`${safeErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
