import { pathToFileURL } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";
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
  type HistoricalImportMode,
  type PuddleDb,
  type S3LikeClient,
} from "./historicalImportExecutor.js";
import type { Queryable } from "./historicalWeaveMatches.js";

interface EnvLike {
  readonly [key: string]: string | undefined;
}

export interface HistoricalImportCliOptions {
  readonly mode: HistoricalImportMode;
  readonly sourceBucket: string;
  readonly sourcePrefix: string;
  readonly sourceRegion: string;
  readonly targetBucket: string;
  readonly targetRegion: string;
  readonly orgId: string;
  readonly limit?: number;
  readonly sinceDate?: string;
  readonly untilDate?: string;
  readonly batchSize: number;
  readonly requireWeaveMatchEnrichment: boolean;
  readonly confirmApply: boolean;
}

export interface HistoricalImportCliDeps {
  readonly env?: EnvLike;
  readonly createS3Client?: (region: string) => S3LikeClient | S3Client;
  readonly getWeavePool?: () => Queryable;
  readonly getPuddlePool?: () => PuddleDb;
  readonly execute?: (input: ExecuteHistoricalFirefliesImportInput) => Promise<ExecuteHistoricalFirefliesImportResult>;
  readonly write?: (message: string) => void;
  readonly closePuddlePool?: () => Promise<void>;
  readonly closeWeavePool?: () => Promise<void>;
}

const defaultSourcePrefix = "raw/fireflies/";
const expectedMatchCandidatesTable = "weave_fireflies_recording_match_candidates";

export function parseHistoricalImportCliArgs(
  argv: readonly string[],
  env: EnvLike = process.env,
): HistoricalImportCliOptions {
  const parsed = parseFlags(argv);
  const mode = parseMode(parsed.value("mode") ?? "dry-run");
  const sourceBucket =
    nonEmptyString(parsed.value("source-bucket")) ??
    nonEmptyString(env.WEAVE_HISTORICAL_RECORDINGS_BUCKET);
  const sourcePrefix =
    nonEmptyString(parsed.value("source-prefix")) ??
    nonEmptyString(env.WEAVE_HISTORICAL_RECORDINGS_PREFIX) ??
    defaultSourcePrefix;
  const sourceRegion =
    nonEmptyString(parsed.value("source-region")) ??
    nonEmptyString(env.WEAVE_HISTORICAL_RECORDINGS_REGION) ??
    "us-west-2";
  const targetBucket =
    nonEmptyString(parsed.value("target-bucket")) ?? nonEmptyString(env.PUDDLE_ARTIFACTS_BUCKET);
  const targetRegion =
    nonEmptyString(parsed.value("target-region")) ??
    nonEmptyString(env.PUDDLE_ARTIFACTS_REGION) ??
    nonEmptyString(env.AWS_REGION) ??
    "us-west-1";
  const orgId = nonEmptyString(parsed.value("org-id"));

  if (!orgId) {
    throw new Error("--org-id is required");
  }
  if (!sourceBucket) {
    throw new Error("--source-bucket is required or WEAVE_HISTORICAL_RECORDINGS_BUCKET must be set");
  }
  if (!targetBucket) {
    throw new Error("--target-bucket is required or PUDDLE_ARTIFACTS_BUCKET must be set");
  }

  return {
    mode,
    sourceBucket,
    sourcePrefix,
    sourceRegion,
    targetBucket,
    targetRegion,
    orgId,
    limit: parseOptionalPositiveInteger(parsed.value("limit"), "--limit"),
    sinceDate: parseOptionalDate(parsed.value("since-date"), "--since-date"),
    untilDate: parseOptionalDate(parsed.value("until-date"), "--until-date"),
    batchSize: parseOptionalPositiveInteger(parsed.value("batch-size"), "--batch-size") ?? 25,
    requireWeaveMatchEnrichment: parsed.has("no-require-weave-match-enrichment")
      ? false
      : true,
    confirmApply: parsed.has("confirm-apply"),
  };
}

export async function assertWeaveMatchCandidateTable(weaveDb: Queryable): Promise<void> {
  const result = await weaveDb.query(
    "SELECT to_regclass('public.weave_fireflies_recording_match_candidates') AS match_candidates_table;",
  );
  const tableName = result.rows[0]?.match_candidates_table;
  if (tableName !== expectedMatchCandidatesTable) {
    throw new Error(
      `Required Weave table public.${expectedMatchCandidatesTable} is missing or inaccessible`,
    );
  }
}

export function formatHistoricalImportResult(result: ExecuteHistoricalFirefliesImportResult): string {
  const lines = [
    `mode=${result.mode}`,
    `planned_count=${result.plannedCount}`,
    `imported_count=${result.importedCount}`,
    `skipped_count=${result.skippedCount}`,
    `failed_count=${result.failedCount}`,
    `copy_count=${result.copyCount}`,
    `skipped_copy_count=${result.skippedCopyCount}`,
    `db_write_count=${result.dbWriteCount}`,
    `selected_matches=${result.selectedMatches}`,
    `ranked_match_candidates=${result.rankedMatchCandidates}`,
    `unindexed_recordings=${result.unindexedRecordings}`,
  ];

  for (const failure of result.failures) {
    lines.push(`failed transcript_id=${failure.transcriptId}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function runHistoricalFirefliesImportCli(
  argv: readonly string[] = process.argv.slice(2),
  deps: HistoricalImportCliDeps = {},
): Promise<ExecuteHistoricalFirefliesImportResult> {
  const options = parseHistoricalImportCliArgs(argv, deps.env ?? process.env);
  if (options.mode === "apply" && !options.confirmApply) {
    throw new Error("Refusing to run --mode apply without --confirm-apply");
  }

  const createS3Client = deps.createS3Client ?? ((region: string) => new S3Client({ region }));
  const resolveWeavePool = deps.getWeavePool ?? getWeavePool;
  const resolvePuddlePool = deps.getPuddlePool ?? getPool;
  const execute = deps.execute ?? executeHistoricalFirefliesImport;
  const write = deps.write ?? ((message: string) => process.stdout.write(message));
  const shouldCloseWeavePool = deps.getWeavePool === undefined;
  const shouldClosePuddlePool = deps.getPuddlePool === undefined && options.mode === "apply";
  let weaveDb: Queryable | undefined;
  let puddleDb: PuddleDb | undefined;

  try {
    weaveDb = options.requireWeaveMatchEnrichment
      ? resolveWeavePool()
      : emptyWeaveMatchQueryable();
    puddleDb = options.mode === "apply" ? resolvePuddlePool() : undefined;

    if (options.requireWeaveMatchEnrichment) {
      await assertWeaveMatchCandidateTable(weaveDb);
    }

    const result = await execute({
      mode: options.mode,
      orgId: options.orgId,
      sourceBucket: options.sourceBucket,
      sourcePrefix: options.sourcePrefix,
      targetBucket: options.targetBucket,
      sourceS3: createS3Client(options.sourceRegion),
      targetS3: createS3Client(options.targetRegion),
      weaveDb,
      puddleDb,
      limit: options.limit,
      sinceDate: options.sinceDate,
      untilDate: options.untilDate,
      batchSize: options.batchSize,
    });
    write(formatHistoricalImportResult(result));
    return result;
  } finally {
    if (shouldClosePuddlePool) {
      await (deps.closePuddlePool ?? closePool)();
    }
    if (shouldCloseWeavePool) {
      await (deps.closeWeavePool ?? closeWeavePool)();
    }
  }
}

function parseFlags(argv: readonly string[]) {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  const valueFlags = new Set([
    "mode",
    "source-bucket",
    "source-prefix",
    "source-region",
    "target-bucket",
    "target-region",
    "org-id",
    "limit",
    "since-date",
    "until-date",
    "batch-size",
  ]);
  const booleanFlags = new Set([
    "require-weave-match-enrichment",
    "no-require-weave-match-enrichment",
    "confirm-apply",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token ?? ""}`);
    }

    const name = token.slice(2);
    if (valueFlags.has(name)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${token} requires a value`);
      }
      values.set(name, value);
      index += 1;
    } else if (booleanFlags.has(name)) {
      booleans.add(name);
    } else {
      throw new Error(`Unknown option: ${token}`);
    }
  }

  return {
    value(name: string) {
      return values.get(name);
    },
    has(name: string) {
      return booleans.has(name);
    },
  };
}

function parseMode(value: string): HistoricalImportMode {
  if (value === "dry-run" || value === "apply") {
    return value;
  }
  throw new Error("--mode must be dry-run or apply");
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

function parseOptionalPositiveInteger(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseOptionalDate(value: string | undefined, flag: string): string | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`${flag} must use a real YYYY-MM-DD calendar date`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${flag} must use a real YYYY-MM-DD calendar date`);
  }

  return value;
}

function emptyWeaveMatchQueryable(): Queryable {
  return {
    async query() {
      return {
        rows: [
          {
            selected: null,
            ranked_candidates: [],
          },
        ],
      };
    },
  };
}

function cliErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHistoricalFirefliesImportCli().catch((error: unknown) => {
    process.stderr.write(`${cliErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
