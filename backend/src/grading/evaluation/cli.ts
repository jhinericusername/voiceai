import { pathToFileURL } from "node:url";
import {
  closePool,
  closeWeavePool,
  getPool,
  getWeavePool,
} from "../../db/pool.js";
import { BedrockGradingModel } from "../bedrock.js";
import type { GradingModel, TranscriptTurnLike } from "../scoring.js";
import {
  historicalSessionEvaluationLinksStatement,
  puddleScoredSessionLabelsStatement,
  transcriptTurnsForEvaluationStatement,
  weaveCandidateEvaluationsByIdStatement,
  type SqlStatement,
} from "./repository.js";
import {
  evaluateLabeledInterviews,
  type LabeledInterviewCase,
} from "./runner.js";

interface EnvLike {
  readonly [key: string]: string | undefined;
}

type Row = Record<string, unknown>;

export interface Queryable {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

export interface GradingEvaluationCliOptions {
  readonly organizationId: string;
  readonly ashbyJobId?: string;
  readonly limit: number;
  readonly batchSize: number;
  readonly dryRun: boolean;
  readonly includeTranscriptOutput: boolean;
  readonly calibrationExampleLimit: number;
}

export interface GradingEvaluationInventorySummary {
  readonly requestedLimit: number;
  readonly loadedPuddleLabels: number;
  readonly loadedHistoricalLinks: number;
  readonly weaveEvaluationIds: number;
  readonly weaveLabelsLoaded: number;
  readonly sessionsWithTranscripts: number;
  readonly evaluatableCases: number;
  readonly skipped: {
    readonly missingTranscript: number;
    readonly missingScores: number;
    readonly missingWeaveLabel: number;
    readonly missingAshbyJobId: number;
  };
}

export interface GradingEvaluationCliDeps {
  readonly env?: EnvLike;
  readonly getPuddlePool?: () => Queryable;
  readonly getWeavePool?: () => Queryable;
  readonly closePuddlePool?: () => Promise<void>;
  readonly closeWeavePool?: () => Promise<void>;
  readonly createModel?: () => GradingModel;
  readonly evaluate?: (input: {
    readonly cases: readonly LabeledInterviewCase[];
    readonly rubric: unknown;
    readonly model: GradingModel;
    readonly options: {
      readonly batchSize: number;
      readonly calibrationExampleLimit: number;
      readonly includeTranscriptInOutput?: boolean;
    };
  }) => Promise<unknown>;
  readonly write?: (message: string) => void;
  readonly rubric?: unknown;
}

export type GradingEvaluationCliResult =
  | {
      readonly mode: "dry-run";
      readonly inventory: GradingEvaluationInventorySummary;
    }
  | {
      readonly mode: "evaluation";
      readonly inventory: GradingEvaluationInventorySummary;
      readonly report: unknown;
    };

interface EvaluationInventory {
  readonly summary: GradingEvaluationInventorySummary;
  readonly cases: readonly LabeledInterviewCase[];
}

type SkipReason = keyof GradingEvaluationInventorySummary["skipped"];

type CaseMapping =
  | { readonly interviewCase: LabeledInterviewCase }
  | { readonly reason: SkipReason };

const defaultLimit = 25;
const maxLimit = 100;
const defaultBatchSize = 3;
const maxBatchSize = 5;
const defaultCalibrationExampleLimit = 3;
const dimensions = [
  "problem_solving",
  "agency",
  "competitiveness",
  "curious",
] as const;

export function parseEvaluationCliArgs(
  argv: readonly string[],
  _env: EnvLike = process.env,
): GradingEvaluationCliOptions {
  const parsed = parseFlags(argv);
  const organizationId = nonEmptyString(parsed.value("organization-id"));
  if (!organizationId) {
    throw new Error("--organization-id is required");
  }

  return {
    organizationId,
    ashbyJobId: nonEmptyString(parsed.value("ashby-job-id")),
    limit: parseBoundedInteger(parsed.value("limit"), "--limit", {
      defaultValue: defaultLimit,
      min: 1,
      max: maxLimit,
    }),
    batchSize: parseBoundedInteger(parsed.value("batch-size"), "--batch-size", {
      defaultValue: defaultBatchSize,
      min: 1,
      max: maxBatchSize,
    }),
    dryRun: parsed.has("dry-run"),
    includeTranscriptOutput: parsed.has("include-transcript-output"),
    calibrationExampleLimit: parseBoundedInteger(
      parsed.value("calibration-example-limit"),
      "--calibration-example-limit",
      {
        defaultValue: defaultCalibrationExampleLimit,
        min: 0,
      },
    ),
  };
}

export async function runGradingEvaluationCli(
  argv: readonly string[] = process.argv.slice(2),
  deps: GradingEvaluationCliDeps = {},
): Promise<GradingEvaluationCliResult> {
  const options = parseEvaluationCliArgs(argv, deps.env ?? process.env);
  const resolvePuddlePool = deps.getPuddlePool ?? getPool;
  const resolveWeavePool = deps.getWeavePool ?? getWeavePool;
  const createModel = deps.createModel ?? (() => new BedrockGradingModel());
  const evaluate = deps.evaluate ?? evaluateLabeledInterviews;
  const write = deps.write ?? ((message: string) => process.stdout.write(message));
  const shouldClosePuddlePool = deps.getPuddlePool === undefined;
  const shouldCloseWeavePool = deps.getWeavePool === undefined;

  let weavePoolWasOpened = false;

  try {
    const puddleDb = resolvePuddlePool();
    const inventory = await loadEvaluationInventory({
      options,
      puddleDb,
      getWeaveDb: () => {
        weavePoolWasOpened = true;
        return resolveWeavePool();
      },
    });

    if (options.dryRun) {
      const result = {
        mode: "dry-run",
        inventory: inventory.summary,
      } as const;
      writeJson(write, result);
      return result;
    }

    const report = await evaluate({
      cases: inventory.cases,
      rubric: deps.rubric ?? defaultRubric(),
      model: createModel(),
      options: {
        batchSize: options.batchSize,
        calibrationExampleLimit: options.calibrationExampleLimit,
        includeTranscriptInOutput: options.includeTranscriptOutput,
      },
    });
    const result = {
      mode: "evaluation",
      inventory: inventory.summary,
      report: options.includeTranscriptOutput ? report : redactReportForDefaultOutput(report),
    } as const;
    writeJson(write, result);
    return result;
  } finally {
    const cleanup: Promise<void>[] = [];
    if (shouldCloseWeavePool && weavePoolWasOpened) {
      cleanup.push((deps.closeWeavePool ?? closeWeavePool)());
    }
    if (shouldClosePuddlePool) {
      cleanup.push((deps.closePuddlePool ?? closePool)());
    }
    await Promise.allSettled(cleanup);
  }
}

async function loadEvaluationInventory(input: {
  readonly options: GradingEvaluationCliOptions;
  readonly puddleDb: Queryable;
  readonly getWeaveDb: () => Queryable;
}): Promise<EvaluationInventory> {
  const [puddleLabels, historicalLinks] = await Promise.all([
    queryStatement(
      input.puddleDb,
      puddleScoredSessionLabelsStatement({
        organizationId: input.options.organizationId,
        ashbyJobId: input.options.ashbyJobId,
        limit: input.options.limit,
      }),
    ),
    queryStatement(
      input.puddleDb,
      historicalSessionEvaluationLinksStatement({
        organizationId: input.options.organizationId,
        ashbyJobId: input.options.ashbyJobId,
        limit: input.options.limit,
      }),
    ),
  ]);

  const evaluationIds = uniqueStrings(
    historicalLinks.map((row) => valueString(row, "candidate_evaluation_id")),
  );
  const weaveLabels =
    evaluationIds.length === 0
      ? []
      : await queryStatement(
          input.getWeaveDb(),
          weaveCandidateEvaluationsByIdStatement(evaluationIds),
        );
  const weaveLabelsById = new Map(
    weaveLabels
      .map((row) => [valueString(row, "candidate_evaluation_id"), row] as const)
      .filter((entry): entry is readonly [string, Row] => entry[0] !== null),
  );

  const sessionIds = uniqueStrings([
    ...puddleLabels.map((row) => valueString(row, "session_id")),
    ...historicalLinks.map((row) => valueString(row, "session_id")),
  ]);
  const transcriptRows =
    sessionIds.length === 0
      ? []
      : await queryStatement(input.puddleDb, transcriptTurnsForEvaluationStatement(sessionIds));
  const transcriptTurnsBySession = groupTranscriptTurnsBySession(transcriptRows);

  const skipped = {
    missingTranscript: 0,
    missingScores: 0,
    missingWeaveLabel: 0,
    missingAshbyJobId: 0,
  };
  const cases: LabeledInterviewCase[] = [];

  for (const row of puddleLabels) {
    const mapped = caseFromLabelRow({
      row,
      transcriptTurnsBySession,
      source: "puddle_ashby_score",
    });
    if ("interviewCase" in mapped) {
      cases.push(mapped.interviewCase);
    } else {
      skipped[mapped.reason] += 1;
    }
  }

  for (const link of historicalLinks) {
    const evaluationId = valueString(link, "candidate_evaluation_id");
    const weaveLabel = evaluationId ? weaveLabelsById.get(evaluationId) : undefined;
    if (!weaveLabel) {
      skipped.missingWeaveLabel += 1;
      continue;
    }

    const mapped = caseFromLabelRow({
      row: {
        ...link,
        ...weaveLabel,
        session_id: link.session_id,
        ashby_job_id: weaveLabel.ashby_job_id ?? link.ashby_job_id,
        candidate_name: weaveLabel.candidate_name ?? link.candidate_name,
      },
      transcriptTurnsBySession,
      source: "weave_candidate_evaluation",
    });
    if ("interviewCase" in mapped) {
      cases.push(mapped.interviewCase);
    } else {
      skipped[mapped.reason] += 1;
    }
  }

  return {
    cases,
    summary: {
      requestedLimit: input.options.limit,
      loadedPuddleLabels: puddleLabels.length,
      loadedHistoricalLinks: historicalLinks.length,
      weaveEvaluationIds: evaluationIds.length,
      weaveLabelsLoaded: weaveLabels.length,
      sessionsWithTranscripts: transcriptTurnsBySession.size,
      evaluatableCases: cases.length,
      skipped,
    },
  };
}

function caseFromLabelRow(input: {
  readonly row: Row;
  readonly transcriptTurnsBySession: ReadonlyMap<string, readonly TranscriptTurnLike[]>;
  readonly source: LabeledInterviewCase["source"];
}): CaseMapping {
  const sessionId = valueString(input.row, "session_id");
  if (!sessionId) {
    return { reason: "missingTranscript" };
  }

  const transcriptTurns = input.transcriptTurnsBySession.get(sessionId) ?? [];
  if (transcriptTurns.length === 0) {
    return { reason: "missingTranscript" };
  }

  const problemSolving = valueScore(input.row, "problem_solving", 4);
  const agency = valueScore(input.row, "agency", 4);
  const competitiveness = valueScore(input.row, "competitiveness", 4);
  const curious = valueScore(input.row, "curious", 4);
  if (
    problemSolving === null ||
    agency === null ||
    competitiveness === null ||
    curious === null
  ) {
    return { reason: "missingScores" };
  }

  const humanScores = {
    problem_solving: problemSolving,
    agency,
    competitiveness,
    curious,
  };

  const ashbyJobId = valueString(input.row, "ashby_job_id");
  if (!ashbyJobId) {
    return { reason: "missingAshbyJobId" };
  }

  const totalScore = optionalScore(input.row, "total_score", 16);
  if (totalScore === "invalid") {
    return { reason: "missingScores" };
  }
  const humanTotalScore =
    totalScore ??
    humanScores.problem_solving +
      humanScores.agency +
      humanScores.competitiveness +
      humanScores.curious;
  const humanComment = valueString(input.row, "comments");

  return {
    interviewCase: {
      sessionId,
      candidateName: valueString(input.row, "candidate_name"),
      ashbyJobId,
      transcriptTurns,
      humanScores,
      humanTotalScore,
      ...(humanComment ? { humanComment } : {}),
      source: input.source,
    },
  };
}

function groupTranscriptTurnsBySession(rows: readonly Row[]): Map<string, TranscriptTurnLike[]> {
  const grouped = new Map<string, TranscriptTurnLike[]>();
  for (const row of rows) {
    const sessionId = valueString(row, "session_id");
    const speaker = valueString(row, "speaker");
    const text = valueString(row, "text");
    if (!sessionId || !speaker || !text) {
      continue;
    }

    const turns = grouped.get(sessionId) ?? [];
    const turnIndex = valueNumber(row, "turn_index");
    turns.push({
      speaker,
      text,
      ...(turnIndex === null ? {} : { turnIndex }),
    });
    grouped.set(sessionId, turns);
  }
  return grouped;
}

async function queryStatement(db: Queryable, statement: SqlStatement): Promise<Row[]> {
  const result = await db.query(statement.text, statement.values);
  return result.rows.filter(isRow);
}

function parseFlags(argv: readonly string[]) {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  const valueFlags = new Set([
    "organization-id",
    "ashby-job-id",
    "limit",
    "batch-size",
    "calibration-example-limit",
  ]);
  const booleanFlags = new Set(["dry-run", "include-transcript-output"]);

  const args = argv[0] === "--" ? argv.slice(1) : argv;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token ?? ""}`);
    }

    const name = token.slice(2);
    if (valueFlags.has(name)) {
      const value = args[index + 1];
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

function parseBoundedInteger(
  value: string | undefined,
  flag: string,
  options: { readonly defaultValue: number; readonly min: number; readonly max?: number },
): number {
  if (value === undefined) {
    return options.defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${flag} must be an integer`);
  }
  if (parsed < options.min || (options.max !== undefined && parsed > options.max)) {
    if (options.max === undefined) {
      throw new Error(`${flag} must be ${options.min} or greater`);
    }
    throw new Error(`${flag} must be between ${options.min} and ${options.max}`);
  }
  return parsed;
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function valueString(row: Row, key: string): string | null {
  const value = row[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function valueNumber(row: Row, key: string): number | null {
  const value = row[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function valueScore(row: Row, key: string, max: number): number | null {
  const parsed = valueNumber(row, key);
  return parsed !== null && parsed >= 0 && parsed <= max && Number.isInteger(parsed * 2)
    ? parsed
    : null;
}

function optionalScore(row: Row, key: string, max: number): number | "invalid" | null {
  if (!Object.prototype.hasOwnProperty.call(row, key) || row[key] === null || row[key] === undefined) {
    return null;
  }
  const parsed = valueScore(row, key, max);
  return parsed === null ? "invalid" : parsed;
}

function uniqueStrings(values: readonly (string | null)[]): string[] {
  return Array.from(new Set(values.filter((value): value is string => value !== null)));
}

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultRubric(): unknown {
  return {
    script_version: "offline-grading-evaluation-v1",
    dimensions: dimensions.map((key) => ({
      key,
      name: dimensionName(key),
    })),
  };
}

function dimensionName(key: (typeof dimensions)[number]): string {
  switch (key) {
    case "problem_solving":
      return "Problem Solving";
    case "agency":
      return "Agency";
    case "competitiveness":
      return "Competitiveness";
    case "curious":
      return "Curious";
  }
}

function redactReportForDefaultOutput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactReportForDefaultOutput(item));
  }
  if (!isRow(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (sensitiveOutputKey(key)) {
        return [];
      }
      if (key === "warnings") {
        return [[key, Array.isArray(child) && child.length > 0 ? ["redacted_model_warnings"] : []]];
      }
      if (key === "candidateName" || key === "candidate_name") {
        return [[key, null]];
      }
      return [[key, redactReportForDefaultOutput(child)]];
    }),
  );
}

function sensitiveOutputKey(key: string): boolean {
  const normalized = key.replace(/[_-]/g, "").toLowerCase();
  return (
    normalized.includes("transcript") ||
    normalized.includes("email") ||
    normalized.includes("evidence") ||
    normalized.includes("rationale") ||
    normalized.includes("comment") ||
    normalized === "humancomment" ||
    normalized === "comments" ||
    normalized.includes("secret")
  );
}

function writeJson(write: (message: string) => void, value: unknown): void {
  write(`${JSON.stringify(value, null, 2)}\n`);
}

function cliErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGradingEvaluationCli().catch((error: unknown) => {
    process.stderr.write(`${cliErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
