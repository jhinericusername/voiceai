import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import {
  processFirefliesLiveIngestionMessage,
  runFirefliesLiveIngestionWorker,
  s3ObjectKeysFromEventBody,
  uniqueFirefliesRecordingPrefixesFromMessageBody,
  type FirefliesLiveIngestionMessage,
  type RunFirefliesLiveIngestionWorkerOptions,
} from "../src/weave/fireflies/live-ingestion-worker.js";
import type {
  ExecuteHistoricalFirefliesImportInput,
  ExecuteHistoricalFirefliesImportResult,
  PuddleDb,
  PuddleDbClient,
  S3LikeClient,
} from "../src/weave/fireflies/historicalImportExecutor.js";
import type { Queryable } from "../src/weave/fireflies/historicalWeaveMatches.js";

const orgId = "org_01KV4FF7KX24B76H7Q57QVB5CT";
const sourceBucket = "weave-fireflies-raw";
const targetBucket = "puddle-artifacts";
const sourceRootPrefix = "raw/fireflies/";
const queueUrl = "https://sqs.us-west-1.amazonaws.com/123/fireflies";
const recordingPrefix =
  "raw/fireflies/owner=owner@example.com/year=2026/month=06/day=16/transcript_id=01LIVE/";

class FakeS3Client implements S3LikeClient {
  readonly commands: unknown[] = [];

  constructor(private readonly objects: readonly { key: string; size: number }[]) {}

  async send(command: unknown): Promise<unknown> {
    this.commands.push(command);
    if (command instanceof ListObjectsV2Command) {
      const prefix = command.input.Prefix ?? "";
      return {
        Contents: this.objects
          .filter((object) => object.key.startsWith(prefix))
          .map((object) => ({ Key: object.key, Size: object.size })),
      };
    }
    throw new Error(`Unexpected command: ${command?.constructor?.name ?? typeof command}`);
  }
}

class FakeSqsClient {
  readonly commands: unknown[] = [];

  async send(command: unknown): Promise<unknown> {
    this.commands.push(command);
    return {};
  }
}

class EmptyPollingSqsClient extends FakeSqsClient {
  async send(command: unknown): Promise<unknown> {
    this.commands.push(command);
    return { Messages: [] };
  }
}

class FakeWeaveDb implements Queryable {
  async query() {
    return { rows: [{ selected: null, ranked_candidates: [] }] };
  }
}

class FakePuddleDbClient implements PuddleDbClient {
  async query() {
    return { rows: [] };
  }

  release(): void {}
}

class FakePuddleDb implements PuddleDb {
  async query() {
    return { rows: [] };
  }

  async connect(): Promise<PuddleDbClient> {
    return new FakePuddleDbClient();
  }
}

function s3EventBody(keys: readonly string[]): string {
  return JSON.stringify({
    Records: keys.map((key) => ({
      s3: {
        bucket: { name: sourceBucket },
        object: { key: encodeURIComponent(key).replace(/%20/g, "+") },
      },
    })),
  });
}

function message(keys: readonly string[]): FirefliesLiveIngestionMessage {
  return {
    body: s3EventBody(keys),
    receiptHandle: "receipt-1",
  };
}

function completeObjects(prefix = recordingPrefix) {
  return [
    { key: `${prefix}audio.mp3`, size: 100 },
    { key: `${prefix}metadata.json`, size: 200 },
    { key: `${prefix}transcript.json`, size: 300 },
    { key: `${prefix}video.mp4`, size: 400 },
    { key: `${prefix}summary.json`, size: 500 },
    { key: `${prefix}ingestion-result.json`, size: 600 },
  ];
}

function minimalResult(input: ExecuteHistoricalFirefliesImportInput): ExecuteHistoricalFirefliesImportResult {
  return {
    mode: input.mode ?? "dry-run",
    plannedCount: 1,
    importedCount: 1,
    skippedCount: 0,
    failedCount: 0,
    copyCount: 6,
    skippedCopyCount: 0,
    dbWriteCount: 7,
    selectedMatches: 0,
    rankedMatchCandidates: 0,
    unindexedRecordings: 1,
    plans: [],
    failures: [],
  };
}

describe("Fireflies live ingestion worker", () => {
  it("extracts decoded S3 object keys from event bodies", () => {
    const keys = s3ObjectKeysFromEventBody(
      s3EventBody([`${recordingPrefix}metadata file.json`, `${recordingPrefix}audio.mp3`]),
    );

    expect(keys).toEqual([`${recordingPrefix}metadata file.json`, `${recordingPrefix}audio.mp3`]);
  });

  it("converts S3 event records into unique Fireflies recording prefixes", () => {
    const prefixes = uniqueFirefliesRecordingPrefixesFromMessageBody(
      s3EventBody([
        `${recordingPrefix}metadata.json`,
        `${recordingPrefix}transcript.json`,
        "raw/fireflies/not-a-recording/metadata.json",
      ]),
      sourceRootPrefix,
    );

    expect(prefixes).toEqual([recordingPrefix]);
  });

  it("requeues incomplete recording folders without importing or deleting the message", async () => {
    const sourceS3 = new FakeS3Client([
      { key: `${recordingPrefix}metadata.json`, size: 200 },
      { key: `${recordingPrefix}transcript.json`, size: 300 },
    ]);
    const sqs = new FakeSqsClient();
    const imported: ExecuteHistoricalFirefliesImportInput[] = [];

    const result = await processFirefliesLiveIngestionMessage({
      message: message([`${recordingPrefix}metadata.json`]),
      queueUrl,
      sourceBucket,
      sourceRootPrefix,
      targetBucket,
      orgId,
      sourceS3,
      targetS3: new FakeS3Client([]),
      sqs,
      weaveDb: new FakeWeaveDb(),
      puddleDb: new FakePuddleDb(),
      execute: async (input) => {
        imported.push(input);
        return minimalResult(input);
      },
    });

    expect(result).toEqual({
      status: "requeued",
      prefixes: [recordingPrefix],
      importedCount: 0,
      missingRequiredKinds: ["audio"],
    });
    expect(imported).toEqual([]);
    expect(commandNames(sqs)).toContain("ChangeMessageVisibilityCommand");
    expect(commandNames(sqs)).not.toContain("DeleteMessageCommand");
  });

  it("imports complete folders in apply mode with the exact single-folder prefix", async () => {
    const sourceS3 = new FakeS3Client(completeObjects());
    const sqs = new FakeSqsClient();
    const imported: ExecuteHistoricalFirefliesImportInput[] = [];

    const result = await processFirefliesLiveIngestionMessage({
      message: message([`${recordingPrefix}transcript.json`]),
      queueUrl,
      sourceBucket,
      sourceRootPrefix,
      targetBucket,
      orgId,
      sourceS3,
      targetS3: new FakeS3Client([]),
      sqs,
      weaveDb: new FakeWeaveDb(),
      puddleDb: new FakePuddleDb(),
      execute: async (input) => {
        imported.push(input);
        return minimalResult(input);
      },
    });

    expect(result.status).toBe("imported");
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      mode: "apply",
      orgId,
      sourceBucket,
      sourcePrefix: recordingPrefix,
      sourceRootPrefix,
      targetBucket,
      batchSize: 1,
    });
    expect(commandNames(sqs)).toContain("DeleteMessageCommand");
  });

  it("deduplicates duplicate object events for the same recording folder", async () => {
    const imported: ExecuteHistoricalFirefliesImportInput[] = [];

    await processFirefliesLiveIngestionMessage({
      message: message([`${recordingPrefix}audio.mp3`, `${recordingPrefix}transcript.json`]),
      queueUrl,
      sourceBucket,
      sourceRootPrefix,
      targetBucket,
      orgId,
      sourceS3: new FakeS3Client(completeObjects()),
      targetS3: new FakeS3Client([]),
      sqs: new FakeSqsClient(),
      weaveDb: new FakeWeaveDb(),
      puddleDb: new FakePuddleDb(),
      execute: async (input) => {
        imported.push(input);
        return minimalResult(input);
      },
    });

    expect(imported.map((input) => input.sourcePrefix)).toEqual([recordingPrefix]);
  });

  it("surfaces import failures without raw transcript text", async () => {
    let message = "";
    try {
      await processFirefliesLiveInestionMessageWithSensitiveFailure();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("database failed after transcript text");
    expect(message).not.toContain("secret answer");
  });

  it("does not delete SQS messages when the import executor returns failures", async () => {
    const sqs = new FakeSqsClient();
    let failureMessage = "";

    try {
      await processFirefliesLiveIngestionMessage({
        message: message([`${recordingPrefix}transcript.json`]),
        queueUrl,
        sourceBucket,
        sourceRootPrefix,
        targetBucket,
        orgId,
        sourceS3: new FakeS3Client(completeObjects()),
        targetS3: new FakeS3Client([]),
        sqs,
        weaveDb: new FakeWeaveDb(),
        puddleDb: new FakePuddleDb(),
        execute: async (input) => ({
          ...minimalResult(input),
          importedCount: 0,
          failedCount: 1,
          failures: [
            {
              transcriptId: "01LIVE",
              message: "copy failed after transcript text: secret answer",
            },
          ],
        }),
      });
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error);
    }

    expect(failureMessage).toContain("copy failed after transcript text");
    expect(failureMessage).not.toContain("secret answer");
    expect(commandNames(sqs)).not.toContain("DeleteMessageCommand");
  });

  async function processFirefliesLiveInestionMessageWithSensitiveFailure() {
    return processFirefliesLiveIngestionMessage({
        message: message([`${recordingPrefix}transcript.json`]),
        queueUrl,
        sourceBucket,
        sourceRootPrefix,
        targetBucket,
        orgId,
        sourceS3: new FakeS3Client(completeObjects()),
        targetS3: new FakeS3Client([]),
        sqs: new FakeSqsClient(),
        weaveDb: new FakeWeaveDb(),
        puddleDb: new FakePuddleDb(),
        execute: async () => {
          throw new Error("database failed after transcript text: secret answer");
        },
      });
  }

  it("creates the polling SQS client in the Fireflies source region", async () => {
    const sqsRegions: string[] = [];
    const options = {
      env: {
        FIREFLIES_INGESTION_QUEUE_URL: queueUrl,
        FIREFLIES_INGESTION_ORG_ID: orgId,
        WEAVE_HISTORICAL_RECORDINGS_BUCKET: sourceBucket,
        WEAVE_HISTORICAL_RECORDINGS_PREFIX: sourceRootPrefix,
        WEAVE_HISTORICAL_RECORDINGS_REGION: "us-west-2",
        PUDDLE_ARTIFACTS_BUCKET: targetBucket,
        PUDDLE_ARTIFACTS_REGION: "us-west-1",
        AWS_REGION: "us-west-1",
      },
      sourceS3: new FakeS3Client([]),
      targetS3: new FakeS3Client([]),
      weaveDb: new FakeWeaveDb(),
      puddleDb: new FakePuddleDb(),
      createSqsClient(region: string) {
        sqsRegions.push(region);
        return new EmptyPollingSqsClient();
      },
      once: true,
    } as RunFirefliesLiveIngestionWorkerOptions & {
      readonly createSqsClient: (region: string) => FakeSqsClient;
    };

    await runFirefliesLiveIngestionWorker(options);

    expect(sqsRegions).toEqual(["us-west-2"]);
  });
});

function commandNames(client: FakeSqsClient): string[] {
  return client.commands.map((command) => command?.constructor?.name ?? typeof command);
}
