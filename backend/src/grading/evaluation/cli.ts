import { createHash } from "node:crypto";
import { mkdir, readFile as readFileDefault, writeFile as writeFileDefault } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  closePool,
  closeWeavePool,
  getPool,
  getWeavePool,
} from "../../db/pool.js";
import { BedrockGradingModel } from "../bedrock.js";
import {
  OpenAIGradingModel,
  type OpenAIReasoningEffort,
  type OpenAITextVerbosity,
} from "../openai.js";
import type { GradingModel, TranscriptTurnLike } from "../scoring.js";
import {
  calibrationExamplesFromExport,
  type CalibrationExample,
} from "./calibration.js";
import {
  historicalSessionEvaluationLinksStatement,
  puddleScoredSessionLabelsStatement,
  transcriptTurnsForEvaluationStatement,
  weaveCandidateEvaluationsByIdStatement,
  type SqlStatement,
} from "./repository.js";
import {
  evaluateLabeledInterviews,
  type EvaluationProgressEvent,
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
  readonly sessionIds?: readonly string[];
  readonly limit: number;
  readonly batchSize: number;
  readonly dryRun: boolean;
  readonly exportCalibration: boolean;
  readonly includeTranscriptOutput: boolean;
  readonly calibrationExampleLimit: number;
  readonly sampleSize: number;
  readonly sampleSeed: string;
  readonly outputFile?: string;
  readonly calibrationFile?: string;
  readonly errorReportFile?: string;
  readonly calibrationTranscriptMaxChars: number;
  readonly modelProvider: GradingModelProvider;
  readonly bedrockRegion: string;
  readonly modelId: string;
  readonly openaiReasoningEffort: OpenAIReasoningEffort;
  readonly openaiVerbosity: OpenAITextVerbosity;
  readonly modelCallTimeoutMs: number;
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
      readonly calibrationExamples?: readonly CalibrationExample[];
      readonly modelCallTimeoutMs?: number;
      readonly progress?: (event: EvaluationProgressEvent) => void;
    };
  }) => Promise<unknown>;
  readonly readFile?: (path: string) => Promise<string>;
  readonly writeFile?: (path: string, contents: string) => Promise<void>;
  readonly write?: (message: string) => void;
  readonly writeProgress?: (message: string) => void;
  readonly rubric?: unknown;
}

export interface GradingCalibrationExportExample {
  readonly id: string;
  readonly sessionId: string;
  readonly candidateName: string | null;
  readonly ashbyJobId: string;
  readonly source: LabeledInterviewCase["source"];
  readonly scores: LabeledInterviewCase["humanScores"];
  readonly totalScore: number;
  readonly comment?: string;
  readonly transcriptTurnCount: number;
  readonly transcriptTurns?: readonly TranscriptTurnLike[];
}

export interface GradingCalibrationExportSample {
  readonly seed: string;
  readonly requestedExampleCount: number;
  readonly eligibleCaseCount: number;
  readonly excludedOutOfScaleScoreCases: number;
  readonly exampleCount: number;
  readonly examples: readonly GradingCalibrationExportExample[];
}

export interface GradingEvaluationSetSummary {
  readonly loadedCases: number;
  readonly excludedCalibrationCases: number;
  readonly excludedOutOfScaleScoreCases: number;
  readonly evaluatedCases: number;
  readonly calibrationExampleCount: number;
  readonly calibrationFile?: string;
}

export interface GradingModelConfigSummary {
  readonly provider: GradingModelProvider;
  readonly region?: string;
  readonly modelId: string;
  readonly reasoningEffort?: OpenAIReasoningEffort;
  readonly verbosity?: OpenAITextVerbosity;
  readonly modelCallTimeoutMs: number;
}

export type GradingEvaluationCliResult =
  | {
      readonly mode: "dry-run";
      readonly inventory: GradingEvaluationInventorySummary;
    }
  | {
      readonly mode: "calibration-export";
      readonly inventory: GradingEvaluationInventorySummary;
      readonly sample: GradingCalibrationExportSample;
      readonly outputFile?: string;
    }
  | {
      readonly mode: "evaluation";
      readonly inventory: GradingEvaluationInventorySummary;
      readonly evaluationSet: GradingEvaluationSetSummary;
      readonly modelConfig: GradingModelConfigSummary;
      readonly report: unknown;
      readonly errorReportFile?: string;
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
const defaultSampleSize = 6;
const maxSampleSize = 20;
const defaultSampleSeed = "weave-calibration-v1";
const defaultCalibrationTranscriptMaxChars = 4000;
const maxCalibrationTranscriptMaxChars = 12000;
const defaultBedrockRegion = "us-east-1";
const defaultGradingModelId = "us.anthropic.claude-opus-4-8";
const defaultOpenAIGradingModelId = "gpt-5.5";
const defaultModelCallTimeoutMs = 180000;
const maxModelCallTimeoutMs = 1800000;
type GradingModelProvider = "bedrock" | "openai";
const modelProviders = ["bedrock", "openai"] as const;
const openaiReasoningEfforts = ["low", "medium", "high", "xhigh"] as const;
const openaiVerbosities = ["low", "medium", "high"] as const;
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
  const modelProvider = parseEnumFlag(
    parsed.value("model-provider") ?? nonEmptyString(_env.PUDDLE_GRADING_MODEL_PROVIDER),
    "--model-provider",
    modelProviders,
    "bedrock",
  );
  const modelId =
    nonEmptyString(parsed.value("model-id")) ??
    nonEmptyString(_env.PUDDLE_GRADING_MODEL_ID) ??
    (modelProvider === "openai" ? defaultOpenAIGradingModelId : defaultGradingModelId);
  const sessionIds = parseSessionIdFilter(parsed.values("session-id"));

  return {
    organizationId,
    ashbyJobId: nonEmptyString(parsed.value("ashby-job-id")),
    ...(sessionIds === undefined ? {} : { sessionIds }),
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
    exportCalibration: parsed.has("export-calibration"),
    includeTranscriptOutput: parsed.has("include-transcript-output"),
    calibrationExampleLimit: parseBoundedInteger(
      parsed.value("calibration-example-limit"),
      "--calibration-example-limit",
      {
        defaultValue: defaultCalibrationExampleLimit,
        min: 0,
      },
    ),
    sampleSize: parseBoundedInteger(parsed.value("sample-size"), "--sample-size", {
      defaultValue: defaultSampleSize,
      min: 1,
      max: maxSampleSize,
    }),
    sampleSeed: nonEmptyString(parsed.value("sample-seed")) ?? defaultSampleSeed,
    outputFile: nonEmptyString(parsed.value("output-file")),
    calibrationFile: nonEmptyString(parsed.value("calibration-file")),
    errorReportFile: nonEmptyString(parsed.value("error-report-file")),
    calibrationTranscriptMaxChars: parseBoundedInteger(
      parsed.value("calibration-transcript-max-chars"),
      "--calibration-transcript-max-chars",
      {
        defaultValue: defaultCalibrationTranscriptMaxChars,
        min: 0,
        max: maxCalibrationTranscriptMaxChars,
      },
    ),
    modelProvider,
    bedrockRegion:
      nonEmptyString(parsed.value("bedrock-region")) ??
      nonEmptyString(_env.AWS_REGION) ??
      defaultBedrockRegion,
    modelId,
    openaiReasoningEffort: parseEnumFlag(
      parsed.value("openai-reasoning-effort") ??
        nonEmptyString(_env.PUDDLE_GRADING_OPENAI_REASONING_EFFORT),
      "--openai-reasoning-effort",
      openaiReasoningEfforts,
      "high",
    ),
    openaiVerbosity: parseEnumFlag(
      parsed.value("openai-verbosity") ?? nonEmptyString(_env.PUDDLE_GRADING_OPENAI_VERBOSITY),
      "--openai-verbosity",
      openaiVerbosities,
      "low",
    ),
    modelCallTimeoutMs: parseBoundedInteger(
      nonEmptyString(parsed.value("model-call-timeout-ms")) ??
        nonEmptyString(_env.PUDDLE_GRADING_MODEL_CALL_TIMEOUT_MS),
      "--model-call-timeout-ms",
      {
        defaultValue: defaultModelCallTimeoutMs,
        min: 0,
        max: maxModelCallTimeoutMs,
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
  const createModel =
    deps.createModel ??
    (() => createGradingModel(options));
  const evaluate = deps.evaluate ?? evaluateLabeledInterviews;
  const write = deps.write ?? ((message: string) => process.stdout.write(message));
  const writeProgress = deps.writeProgress ?? ((message: string) => process.stderr.write(message));
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
    const cases = filterCasesBySessionId(inventory.cases, options.sessionIds);

    if (options.exportCalibration) {
      const result = {
        mode: "calibration-export",
        inventory: inventory.summary,
        ...(options.outputFile ? { outputFile: options.outputFile } : {}),
        sample: buildCalibrationExportSample({
          cases,
          sampleSize: options.sampleSize,
          seed: options.sampleSeed,
          includeTranscriptInOutput: options.includeTranscriptOutput,
        }),
      } as const;

      if (options.outputFile) {
        const writeFile = deps.writeFile ?? writeCalibrationExportFile;
        await writeFile(options.outputFile, `${JSON.stringify(result, null, 2)}\n`);
        writeJson(write, redactReportForDefaultOutput(result));
        return result;
      }

      writeJson(write, result);
      return result;
    }

    if (options.dryRun) {
      const result = {
        mode: "dry-run",
        inventory: inventory.summary,
      } as const;
      writeJson(write, result);
      return result;
    }

    const calibrationFilePayload =
      options.calibrationFile === undefined
        ? undefined
        : JSON.parse(await (deps.readFile ?? readTextFile)(options.calibrationFile));
    const calibrationExamples =
      calibrationFilePayload === undefined
        ? undefined
        : calibrationExamplesFromExport(calibrationFilePayload, {
            maxTranscriptChars: options.calibrationTranscriptMaxChars,
          });
    const evaluationSet = buildEvaluationSet({
      cases,
      calibrationFile: options.calibrationFile,
      calibrationPayload: calibrationFilePayload,
      calibrationExampleCount: calibrationExamples?.length ?? 0,
    });

    const report = await evaluate({
      cases: evaluationSet.cases,
      rubric: deps.rubric ?? defaultRubric(),
      model: createModel(),
      options: {
        batchSize: options.batchSize,
        calibrationExampleLimit: options.calibrationExampleLimit,
        includeTranscriptInOutput: options.includeTranscriptOutput,
        modelCallTimeoutMs: options.modelCallTimeoutMs,
        progress(event) {
          writeEvaluationProgress(writeProgress, event);
        },
        ...(calibrationExamples === undefined ? {} : { calibrationExamples }),
      },
    });
    if (options.errorReportFile) {
      const writeFile = deps.writeFile ?? writeCalibrationExportFile;
      await writeFile(
        options.errorReportFile,
        `${JSON.stringify(buildEvaluationErrorReport(report, evaluationSet.summary), null, 2)}\n`,
      );
    }
    const result = {
      mode: "evaluation",
      inventory: inventory.summary,
      evaluationSet: evaluationSet.summary,
      modelConfig: modelConfigSummary(options),
      ...(options.errorReportFile ? { errorReportFile: options.errorReportFile } : {}),
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
  const multiValues = new Map<string, string[]>();
  const booleans = new Set<string>();
  const valueFlags = new Set([
    "organization-id",
    "ashby-job-id",
    "session-id",
    "limit",
    "batch-size",
    "calibration-example-limit",
    "sample-size",
    "sample-seed",
    "output-file",
    "calibration-file",
    "error-report-file",
    "calibration-transcript-max-chars",
    "model-provider",
    "bedrock-region",
    "model-id",
    "openai-reasoning-effort",
    "openai-verbosity",
    "model-call-timeout-ms",
  ]);
  const booleanFlags = new Set(["dry-run", "export-calibration", "include-transcript-output"]);
  const multiValueFlags = new Set(["session-id"]);

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
      if (multiValueFlags.has(name)) {
        multiValues.set(name, [...(multiValues.get(name) ?? []), value]);
      } else {
        values.set(name, value);
      }
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
    values(name: string) {
      return multiValues.get(name) ?? [];
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

function parseEnumFlag<const T extends readonly string[]>(
  value: string | undefined,
  flag: string,
  allowed: T,
  defaultValue: T[number],
): T[number] {
  if (value === undefined) {
    return defaultValue;
  }
  if ((allowed as readonly string[]).includes(value)) {
    return value as T[number];
  }
  throw new Error(`${flag} must be one of: ${allowed.join(", ")}`);
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function parseSessionIdFilter(values: readonly string[]): readonly string[] | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sessionIds = uniqueStrings(
    values.flatMap((value) => value.split(",").map(nonEmptyString)),
  );
  if (sessionIds.length === 0) {
    throw new Error("--session-id requires at least one non-empty value");
  }
  return sessionIds;
}

function filterCasesBySessionId(
  cases: readonly LabeledInterviewCase[],
  sessionIds: readonly string[] | undefined,
): readonly LabeledInterviewCase[] {
  if (sessionIds === undefined || sessionIds.length === 0) {
    return cases;
  }
  const allowedSessionIds = new Set(sessionIds);
  return cases.filter((interviewCase) => allowedSessionIds.has(interviewCase.sessionId));
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

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => value !== null && value !== undefined)),
  );
}

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildCalibrationExportSample(input: {
  readonly cases: readonly LabeledInterviewCase[];
  readonly sampleSize: number;
  readonly seed: string;
  readonly includeTranscriptInOutput: boolean;
}): GradingCalibrationExportSample {
  const eligibleCases = input.cases.filter(isCalibrationExportEligibleCase);
  const examples = seededSampleCases(eligibleCases, input.sampleSize, input.seed).map((interviewCase) =>
    calibrationExportExampleFromCase(interviewCase, input.includeTranscriptInOutput),
  );

  return {
    seed: input.seed,
    requestedExampleCount: input.sampleSize,
    eligibleCaseCount: eligibleCases.length,
    excludedOutOfScaleScoreCases: input.cases.length - eligibleCases.length,
    exampleCount: examples.length,
    examples,
  };
}

function isCalibrationExportEligibleCase(interviewCase: LabeledInterviewCase): boolean {
  return Object.values(interviewCase.humanScores).every((score) => score >= 1 && score <= 4);
}

function seededSampleCases(
  cases: readonly LabeledInterviewCase[],
  sampleSize: number,
  seed: string,
): readonly LabeledInterviewCase[] {
  return [...cases]
    .map((interviewCase, index) => ({
      interviewCase,
      index,
      sortKey: stableSampleKey(interviewCase, seed, index),
    }))
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey) || left.index - right.index)
    .slice(0, sampleSize)
    .map(({ interviewCase }) => interviewCase);
}

function stableSampleKey(
  interviewCase: LabeledInterviewCase,
  seed: string,
  index: number,
): string {
  return createHash("sha256")
    .update(seed)
    .update("\0")
    .update(interviewCase.source)
    .update("\0")
    .update(interviewCase.sessionId)
    .update("\0")
    .update(interviewCase.ashbyJobId)
    .update("\0")
    .update(String(index))
    .digest("hex");
}

function calibrationExportExampleFromCase(
  interviewCase: LabeledInterviewCase,
  includeTranscriptInOutput: boolean,
): GradingCalibrationExportExample {
  return {
    id: `${interviewCase.source}:${interviewCase.sessionId}`,
    sessionId: interviewCase.sessionId,
    candidateName: interviewCase.candidateName,
    ashbyJobId: interviewCase.ashbyJobId,
    source: interviewCase.source,
    scores: interviewCase.humanScores,
    totalScore: interviewCase.humanTotalScore,
    ...(interviewCase.humanComment ? { comment: interviewCase.humanComment } : {}),
    transcriptTurnCount: interviewCase.transcriptTurns.length,
    ...(includeTranscriptInOutput ? { transcriptTurns: interviewCase.transcriptTurns } : {}),
  };
}

async function writeCalibrationExportFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFileDefault(path, contents, "utf8");
}

async function readTextFile(path: string): Promise<string> {
  return readFileDefault(path, "utf8");
}

function buildEvaluationSet(input: {
  readonly cases: readonly LabeledInterviewCase[];
  readonly calibrationFile?: string;
  readonly calibrationPayload?: unknown;
  readonly calibrationExampleCount: number;
}): { readonly cases: readonly LabeledInterviewCase[]; readonly summary: GradingEvaluationSetSummary } {
  const calibrationSessionIds = calibrationSessionIdsFromExport(input.calibrationPayload);
  const cases: LabeledInterviewCase[] = [];
  let excludedCalibrationCases = 0;
  let excludedOutOfScaleScoreCases = 0;

  for (const interviewCase of input.cases) {
    if (calibrationSessionIds.has(interviewCase.sessionId)) {
      excludedCalibrationCases += 1;
      continue;
    }
    if (input.calibrationPayload !== undefined && !isCurrentRubricScaleCase(interviewCase)) {
      excludedOutOfScaleScoreCases += 1;
      continue;
    }
    cases.push(interviewCase);
  }

  return {
    cases,
    summary: {
      loadedCases: input.cases.length,
      excludedCalibrationCases,
      excludedOutOfScaleScoreCases,
      evaluatedCases: cases.length,
      calibrationExampleCount: input.calibrationExampleCount,
      ...(input.calibrationFile ? { calibrationFile: input.calibrationFile } : {}),
    },
  };
}

function calibrationSessionIdsFromExport(value: unknown): Set<string> {
  if (!isRow(value) || !isRow(value.sample) || !Array.isArray(value.sample.examples)) {
    return new Set();
  }
  return new Set(
    value.sample.examples.flatMap((example) => {
      if (!isRow(example)) {
        return [];
      }
      const sessionId = valueString(example, "sessionId") ?? valueString(example, "session_id");
      return sessionId ? [sessionId] : [];
    }),
  );
}

function isCurrentRubricScaleCase(interviewCase: LabeledInterviewCase): boolean {
  return Object.values(interviewCase.humanScores).every((score) => score >= 1 && score <= 4);
}

function buildEvaluationErrorReport(
  report: unknown,
  evaluationSet: GradingEvaluationSetSummary,
): unknown {
  const reportRow = isRow(report) ? report : {};
  return {
    mode: "evaluation-error-report",
    evaluationSet,
    aggregate: reportRow.aggregate ?? null,
    largestDisagreements: errorReportCases(reportRow.cases),
  };
}

function errorReportCases(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((item) => {
      if (!isRow(item) || item.status !== "succeeded" || !isRow(item.comparison)) {
        return [];
      }
      return [
        {
          sessionId: item.sessionId,
          ashbyJobId: item.ashbyJobId,
          source: item.source,
          humanScores: item.humanScores,
          humanTotalScore: item.humanTotalScore,
          predictedScores: predictedScoreRecord(item.predictedCategoryScores),
          predictedTotalScore: item.predictedTotalScore,
          meanAbsoluteError: item.comparison.meanAbsoluteError,
          exactRate: item.comparison.exactRate,
          withinHalfPointRate: item.comparison.withinHalfPointRate,
          dimensionErrors: Array.isArray(item.comparison.dimensionErrors)
            ? item.comparison.dimensionErrors
            : [],
        },
      ];
    })
    .sort((left, right) => numericValue(right, "meanAbsoluteError") - numericValue(left, "meanAbsoluteError"))
    .slice(0, 25);
}

function predictedScoreRecord(value: unknown): Record<string, number> {
  if (!Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    value.flatMap((item) => {
      if (!isRow(item)) {
        return [];
      }
      const category = valueString(item, "category");
      const score = valueNumber(item, "score");
      return category && score !== null ? [[category, score]] : [];
    }),
  );
}

function numericValue(row: unknown, key: string): number {
  return isRow(row) ? valueNumber(row, key) ?? 0 : 0;
}

function createGradingModel(options: GradingEvaluationCliOptions): GradingModel {
  if (options.modelProvider === "openai") {
    return new OpenAIGradingModel({
      modelId: options.modelId,
      reasoningEffort: options.openaiReasoningEffort,
      verbosity: options.openaiVerbosity,
    });
  }

  return new BedrockGradingModel({
    region: options.bedrockRegion,
    modelId: options.modelId,
  });
}

function modelConfigSummary(options: GradingEvaluationCliOptions): GradingModelConfigSummary {
  if (options.modelProvider === "openai") {
    return {
      provider: "openai",
      modelId: options.modelId,
      reasoningEffort: options.openaiReasoningEffort,
      verbosity: options.openaiVerbosity,
      modelCallTimeoutMs: options.modelCallTimeoutMs,
    };
  }

  return {
    provider: "bedrock",
    region: options.bedrockRegion,
    modelId: options.modelId,
    modelCallTimeoutMs: options.modelCallTimeoutMs,
  };
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
  if (normalized === "missingtranscript" || normalized === "transcriptturncount") {
    return false;
  }
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

function writeEvaluationProgress(
  writeProgress: (message: string) => void,
  event: EvaluationProgressEvent,
): void {
  const base = {
    event: `grading_evaluation_${event.type}`,
    caseIndex: event.caseIndex,
    caseCount: event.caseCount,
    sessionId: event.sessionId,
    ashbyJobId: event.ashbyJobId,
    source: event.source,
    modelCallCount: event.modelCallCount,
  };
  if (event.type === "case_finished") {
    writeProgress(
      `${JSON.stringify({
        ...base,
        status: event.status,
        elapsedMs: event.elapsedMs,
      })}\n`,
    );
    return;
  }
  writeProgress(`${JSON.stringify(base)}\n`);
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
