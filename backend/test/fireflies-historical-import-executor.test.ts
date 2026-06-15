import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import {
  executeHistoricalFirefliesImport,
  type PuddleDb,
  type PuddleDbClient,
  type S3LikeClient,
} from "../src/weave/fireflies/historicalImportExecutor.js";
import type { Queryable } from "../src/weave/fireflies/historicalWeaveMatches.js";

const orgId = "org_01KV4FF7KX24B76H7Q57QVB5CT";
const sourceBucket = "weave-fireflies-raw";
const targetBucket = "puddle-artifacts";
const sourcePrefix = "raw/fireflies/";

interface StoredObject {
  readonly key: string;
  readonly size: number;
  readonly body?: unknown;
}

class FakeS3Client implements S3LikeClient {
  readonly commands: unknown[] = [];
  readonly copiedSources: string[] = [];
  readonly copiedKeys: string[] = [];

  constructor(
    private readonly objects: readonly StoredObject[] = [],
    private readonly existingTargetSizes = new Map<string, number>(),
    private readonly operationLog?: string[],
  ) {}

  async send(command: unknown): Promise<unknown> {
    this.commands.push(command);
    this.operationLog?.push(`s3:${command?.constructor?.name ?? typeof command}`);
    if (command instanceof ListObjectsV2Command) {
      const input = command.input;
      const matching = this.objects.filter((object) => object.key.startsWith(input.Prefix ?? ""));
      const firstPage = !input.ContinuationToken;
      const page = firstPage ? matching.slice(0, 3) : matching.slice(3);
      return {
        Contents: page.map((object) => ({ Key: object.key, Size: object.size })),
        NextContinuationToken: firstPage && matching.length > 3 ? "next-page" : undefined,
      };
    }
    if (command instanceof GetObjectCommand) {
      const object = this.objects.find((candidate) => candidate.key === command.input.Key);
      if (!object) {
        const error = new Error(`No such key: ${String(command.input.Key)}`);
        error.name = "NoSuchKey";
        throw error;
      }
      return { Body: bodyFromJson(object.body ?? {}) };
    }
    if (command instanceof HeadObjectCommand) {
      const size = this.existingTargetSizes.get(String(command.input.Key));
      if (size === undefined) {
        const error = new Error("Not found");
        error.name = "NotFound";
        Object.assign(error, { $metadata: { httpStatusCode: 404 } });
        throw error;
      }
      return { ContentLength: size };
    }
    if (command instanceof CopyObjectCommand) {
      this.copiedSources.push(String(command.input.CopySource));
      this.copiedKeys.push(String(command.input.Key));
      return {};
    }
    throw new Error(`Unexpected command: ${command?.constructor?.name ?? typeof command}`);
  }
}

class FakeWeaveDb implements Queryable {
  constructor(
    private readonly rowsByTranscriptId: Record<string, { selected: unknown; ranked_candidates: unknown[] }>,
  ) {}

  async query(_sql: string, params?: readonly unknown[]) {
    return {
      rows: [
        this.rowsByTranscriptId[String(params?.[0])] ?? {
          selected: null,
          ranked_candidates: [],
        },
      ],
    };
  }
}

class FakePuddleDbClient implements PuddleDbClient {
  readonly statements: { sql: string; params?: readonly unknown[] }[] = [];
  readonly transactionLog: string[] = [];

  constructor(
    private readonly failOnTranscriptId: string | null = null,
    private readonly operationLog?: string[],
  ) {}

  async query(sql: string, params?: readonly unknown[]) {
    this.statements.push({ sql, params });
    this.operationLog?.push(`db:${sql}`);
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      this.transactionLog.push(sql);
    }
    if (
      this.failOnTranscriptId &&
      sql.startsWith("INSERT INTO recordings") &&
      params?.[1] === `fireflies:${this.failOnTranscriptId}`
    ) {
      throw new Error(`recording write failed for ${this.failOnTranscriptId}`);
    }
    if (sql.includes("RETURNING session_id")) {
      return { rows: [{ session_id: params?.[0] }] };
    }
    return { rows: [] };
  }

  release(): void {}
}

class FakePuddleDb implements PuddleDb {
  readonly queryLog: { sql: string; params?: readonly unknown[] }[] = [];
  readonly client: FakePuddleDbClient;

  constructor(
    failOnTranscriptId: string | null = null,
    private readonly operationLog?: string[],
  ) {
    this.client = new FakePuddleDbClient(failOnTranscriptId, operationLog);
  }

  async query(sql: string, params?: readonly unknown[]) {
    this.queryLog.push({ sql, params });
    this.operationLog?.push(`db:${sql}`);
    return { rows: [] };
  }

  async connect(): Promise<PuddleDbClient> {
    return this.client;
  }
}

function bodyFromJson(value: unknown) {
  return {
    async transformToString() {
      return JSON.stringify(value);
    },
  };
}

function recordingObjects(transcriptId: string, options: { video?: boolean; date?: string } = {}) {
  const date = options.date ?? "2026-04-09";
  const [year, month, day] = date.split("-");
  const prefix =
    `raw/fireflies/owner=owner@example.com/year=${year}/month=${month}/day=${day}` +
    `/transcript_id=${transcriptId}/`;
  const objects: StoredObject[] = [
    {
      key: `${prefix}audio.mp3`,
      size: 101,
      body: "audio",
    },
    {
      key: `${prefix}transcript.json`,
      size: 303,
      body: {
        attendees: [{ email: `${transcriptId.toLowerCase()}@example.com` }],
        sentences: [
          {
            speaker_name: "Prakul Singh",
            text: `Question for ${transcriptId}`,
            start_time: 3,
          },
          {
            speaker_name: "Candidate",
            text: `Answer from ${transcriptId}`,
            start_time: 8,
          },
        ],
      },
    },
    {
      key: `${prefix}metadata.json`,
      size: 202,
      body: {
        targetEmail: `${transcriptId.toLowerCase()}@example.com`,
        meetingStartedAt: `${date}T15:30:00.000Z`,
        durationSeconds: 1800,
      },
    },
    {
      key: `${prefix}summary.json`,
      size: 57,
      body: { overview: `Summary for ${transcriptId}` },
    },
    {
      key: `${prefix}ingestion-result.json`,
      size: 58,
      body: { status: "ok" },
    },
  ];

  if (options.video !== false) {
    objects.splice(1, 0, {
      key: `${prefix}video.mp4`,
      size: 404,
      body: "video",
    });
  }

  return objects;
}

function selectedWeaveRow(transcriptId: string) {
  return {
    selected: {
      fireflies_transcript_id: transcriptId,
      match_status: "matched",
      match_confidence: 0.99,
      match_method: "manual",
      match_reasons: ["manual selection"],
      ashby_candidate_id: `cand_${transcriptId}`,
      ashby_application_id: `app_${transcriptId}`,
      ashby_job_id: `job_${transcriptId}`,
      candidate_evaluation_id: `eval_${transcriptId}`,
      decision_source: "manual",
      decision_reason: ["selected in Weave"],
      decided_at: "2026-04-10T12:00:00.000Z",
    },
    ranked_candidates: [
      {
        match_rank: 2,
        score: 90,
        ashby_candidate_id: `cand_alt_${transcriptId}`,
        ashby_application_id: `app_alt_${transcriptId}`,
        ashby_job_id: null,
        candidate_evaluation_id: null,
        matched_email: `${transcriptId.toLowerCase()}@example.com`,
        date_delta_days: 1,
        stage_delta_days: null,
        stage_titles: ["Phone Screen"],
        application_active_on_meeting_date: true,
        active_application_count: 2,
        reasons: ["secondary"],
      },
      {
        match_rank: 1,
        score: 98,
        ashby_candidate_id: `cand_${transcriptId}`,
        ashby_application_id: `app_${transcriptId}`,
        ashby_job_id: `job_${transcriptId}`,
        candidate_evaluation_id: `eval_${transcriptId}`,
        matched_email: `${transcriptId.toLowerCase()}@example.com`,
        date_delta_days: 0,
        stage_delta_days: 0,
        stage_titles: ["Technical Interview"],
        application_active_on_meeting_date: true,
        active_application_count: 1,
        reasons: ["email match"],
      },
    ],
  };
}

function commandNames(client: FakeS3Client): string[] {
  return client.commands.map((command) => command?.constructor?.name ?? typeof command);
}

describe("Fireflies historical import executor", () => {
  it("dry-runs without copying, target head checks, or Puddle DB writes while returning enrichment counts", async () => {
    const sourceS3 = new FakeS3Client([
      ...recordingObjects("01MATCHED"),
      ...recordingObjects("02UNINDEXED"),
    ]);
    const targetS3 = new FakeS3Client();
    const puddleDb = new FakePuddleDb();
    const weaveDb = new FakeWeaveDb({
      "01MATCHED": selectedWeaveRow("01MATCHED"),
    });

    const result = await executeHistoricalFirefliesImport({
      orgId,
      sourceBucket,
      sourcePrefix,
      targetBucket,
      sourceS3,
      targetS3,
      weaveDb,
      puddleDb,
    });

    expect(result.mode).toBe("dry-run");
    expect(result.plannedCount).toBe(2);
    expect(result.importedCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(result.selectedMatches).toBe(1);
    expect(result.rankedMatchCandidates).toBe(2);
    expect(result.unindexedRecordings).toBe(1);
    expect(result.copyCount).toBe(12);
    expect(result.skippedCopyCount).toBe(0);
    expect(result.dbWriteCount).toBe(0);
    expect(commandNames(targetS3)).not.toContain("HeadObjectCommand");
    expect(commandNames(targetS3)).not.toContain("CopyObjectCommand");
    expect(puddleDb.queryLog).toEqual([]);
    expect(puddleDb.client.statements).toEqual([]);
  });

  it("apply mode copies source objects before writing database rows", async () => {
    const operationLog: string[] = [];
    const sourceS3 = new FakeS3Client(recordingObjects("01APPLY"));
    const targetS3 = new FakeS3Client([], new Map(), operationLog);
    const puddleDb = new FakePuddleDb(null, operationLog);

    const result = await executeHistoricalFirefliesImport({
      mode: "apply",
      orgId,
      sourceBucket,
      sourcePrefix,
      targetBucket,
      sourceS3,
      targetS3,
      weaveDb: new FakeWeaveDb({ "01APPLY": selectedWeaveRow("01APPLY") }),
      puddleDb,
      importRunId: "run_apply",
    });

    expect(result.importedCount).toBe(1);
    expect(result.copyCount).toBe(6);
    expect(result.dbWriteCount).toBe(7);
    expect(commandNames(targetS3).filter((name) => name === "CopyObjectCommand")).toHaveLength(6);
    expect(targetS3.copiedSources[0]).toBe(
      "weave-fireflies-raw/raw/fireflies/owner%3Downer%40example.com/year%3D2026/month%3D04/day%3D09/transcript_id%3D01APPLY/video.mp4",
    );
    const firstCopyIndex = operationLog.indexOf("s3:CopyObjectCommand");
    const firstDbWriteIndex = operationLog.findIndex((entry) => entry.startsWith("db:"));
    expect(firstCopyIndex).toBeGreaterThanOrEqual(0);
    expect(firstDbWriteIndex).toBeGreaterThanOrEqual(0);
    expect(firstDbWriteIndex).toBeGreaterThan(firstCopyIndex);
    expect(puddleDb.queryLog[0]?.sql).toContain("INSERT INTO historical_interview_import_runs");
    expect(puddleDb.queryLog.at(-1)?.sql).toContain("UPDATE historical_interview_import_runs SET");
  });

  it("skips copying an existing destination object when the target size matches the source size", async () => {
    const objects = recordingObjects("01SKIP");
    const targetKey =
      "org_01KV4FF7KX24B76H7Q57QVB5CT/interviews/hist_fireflies_01SKIP/media/candidate_audio.mp3";
    const targetS3 = new FakeS3Client([], new Map([[targetKey, 101]]));

    const result = await executeHistoricalFirefliesImport({
      mode: "apply",
      orgId,
      sourceBucket,
      sourcePrefix,
      targetBucket,
      sourceS3: new FakeS3Client(objects),
      targetS3,
      weaveDb: new FakeWeaveDb({}),
      puddleDb: new FakePuddleDb(),
    });

    expect(result.importedCount).toBe(1);
    expect(result.skippedCopyCount).toBe(1);
    expect(result.copyCount).toBe(5);
    expect(targetS3.copiedKeys).not.toContain(targetKey);
  });

  it("imports recordings without video while preserving audio and transcript artifacts", async () => {
    const result = await executeHistoricalFirefliesImport({
      orgId,
      sourceBucket,
      sourcePrefix,
      targetBucket,
      sourceS3: new FakeS3Client(recordingObjects("01AUDIO", { video: false })),
      targetS3: new FakeS3Client(),
      weaveDb: new FakeWeaveDb({}),
    });

    expect(result.plannedCount).toBe(1);
    expect(result.plans[0]?.artifacts.map((artifact) => artifact.kind)).toEqual([
      "candidate_audio",
      "transcript",
    ]);
    expect(result.plans[0]?.copies.map((copy) => copy.artifactId)).toEqual([
      "hist_fireflies_01AUDIO_candidate_audio",
      "hist_fireflies_01AUDIO_transcript",
      null,
      null,
      null,
    ]);
  });

  it("records a failure for one recording and continues with later recordings", async () => {
    const brokenPrefix =
      "raw/fireflies/owner=owner@example.com/year=2026/month=04/day=09/transcript_id=01BROKEN/";
    const sourceS3 = new FakeS3Client([
      { key: `${brokenPrefix}audio.mp3`, size: 101 },
      ...recordingObjects("02LATER"),
    ]);

    const result = await executeHistoricalFirefliesImport({
      orgId,
      sourceBucket,
      sourcePrefix,
      targetBucket,
      sourceS3,
      targetS3: new FakeS3Client(),
      weaveDb: new FakeWeaveDb({}),
    });

    expect(result.plannedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.failures[0]?.transcriptId).toBe("01BROKEN");
    expect(result.failures[0]?.message).toContain("transcript");
    expect(result.plans[0]?.session.externalId).toBe("02LATER");
  });

  it("keeps the selected Ashby application and ranked candidates from Weave in plan source metadata", async () => {
    const result = await executeHistoricalFirefliesImport({
      orgId,
      sourceBucket,
      sourcePrefix,
      targetBucket,
      sourceS3: new FakeS3Client(recordingObjects("01ASHBY")),
      targetS3: new FakeS3Client(),
      weaveDb: new FakeWeaveDb({
        "01ASHBY": selectedWeaveRow("01ASHBY"),
      }),
    });

    expect(result.selectedMatches).toBe(1);
    expect(result.rankedMatchCandidates).toBe(2);
    expect(result.plans[0]?.session.sourceMetadata.ashby.selected).toMatchObject({
      candidateId: "cand_01ASHBY",
      applicationId: "app_01ASHBY",
      jobId: "job_01ASHBY",
      candidateEvaluationId: "eval_01ASHBY",
    });
    expect(
      result.plans[0]?.session.sourceMetadata.ashby.matchCandidates.map((candidate) => [
        candidate.rank,
        candidate.applicationId,
      ]),
    ).toEqual([
      [1, "app_01ASHBY"],
      [2, "app_alt_01ASHBY"],
    ]);
  });

  it("keeps ranked candidates from Weave when no selected recording row exists", async () => {
    const result = await executeHistoricalFirefliesImport({
      orgId,
      sourceBucket,
      sourcePrefix,
      targetBucket,
      sourceS3: new FakeS3Client(recordingObjects("01CANDIDATES")),
      targetS3: new FakeS3Client(),
      weaveDb: new FakeWeaveDb({
        "01CANDIDATES": {
          selected: null,
          ranked_candidates: selectedWeaveRow("01CANDIDATES").ranked_candidates,
        },
      }),
    });

    expect(result.selectedMatches).toBe(0);
    expect(result.rankedMatchCandidates).toBe(2);
    expect(result.unindexedRecordings).toBe(1);
    expect(result.plans[0]?.session.sourceMetadata.fireflies.matchStatus).toBe("unindexed");
    expect(result.plans[0]?.session.sourceMetadata.ashby.selected).toBeNull();
    expect(
      result.plans[0]?.session.sourceMetadata.ashby.matchCandidates.map((candidate) => [
        candidate.rank,
        candidate.applicationId,
      ]),
    ).toEqual([
      [1, "app_01CANDIDATES"],
      [2, "app_alt_01CANDIDATES"],
    ]);
  });
});
