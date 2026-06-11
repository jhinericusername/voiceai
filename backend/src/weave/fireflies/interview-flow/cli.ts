import {
  access,
  appendFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createBedrockJsonClient, createS3TranscriptClient } from "./aws.js";
import {
  buildAggregationPrompt,
  buildExtractionPrompt,
  buildJsonRepairPrompt,
  buildManifestEntries,
  extractJsonObject,
  firefliesTranscriptToText,
  isAggregateOutput,
  isExtractionOutput,
} from "./core.js";
import {
  BedrockJsonClient,
  ManifestEntry,
  ManifestFile,
  RunLogEvent,
  S3TranscriptClient,
  TranscriptInput,
} from "./types.js";

type Command = "extract" | "aggregate" | "run";

interface RunInterviewFlowOptions {
  readonly command: Command;
  readonly bucket: string;
  readonly prefix: string;
  readonly limit: number;
  readonly outputDir: string;
  readonly refreshManifest?: boolean;
  readonly s3Region?: string;
  readonly bedrockRegion?: string;
  readonly modelId?: string;
  readonly manifestPath?: string;
  readonly maxExtractionTokens?: number;
  readonly maxAggregationTokens?: number;
  readonly s3?: S3TranscriptClient;
  readonly bedrock?: BedrockJsonClient;
}

interface OutputPaths {
  readonly outputDir: string;
  readonly inputsDir: string;
  readonly extractionsDir: string;
  readonly aggregateDir: string;
  readonly debugDir: string;
  readonly manifestPath: string;
  readonly logPath: string;
}

const DEFAULT_BUCKET = "weave-fireflies-prod-851725544921-us-west-2";
const DEFAULT_PREFIX = "raw/fireflies/";
const DEFAULT_LIMIT = 50;
const DEFAULT_OUTPUT_DIR = "artifacts/interview-flow";
const DEFAULT_S3_REGION = "us-west-2";
const DEFAULT_BEDROCK_REGION = "us-east-1";
const DEFAULT_MODEL_ID = "us.anthropic.claude-opus-4-8";
const DEFAULT_EXTRACTION_TOKENS = 32000;
const DEFAULT_AGGREGATION_TOKENS = 32000;

export async function runCli(argv: readonly string[]): Promise<void> {
  const options = parseArgs(argv);
  await runInterviewFlow(options);
}

export async function runInterviewFlow(options: RunInterviewFlowOptions): Promise<void> {
  const paths = outputPaths(options.outputDir, options.manifestPath);
  await ensureOutputDirs(paths);
  const logger = (event: Omit<RunLogEvent, "timestamp">) => appendRunLog(paths.logPath, event);

  const s3 =
    options.s3 ??
    createS3TranscriptClient(options.s3Region ?? DEFAULT_S3_REGION);
  const bedrock =
    options.bedrock ??
    createBedrockJsonClient(
      options.bedrockRegion ?? DEFAULT_BEDROCK_REGION,
      options.modelId ?? DEFAULT_MODEL_ID,
    );

  const manifest = await readOrCreateManifest({
    options,
    paths,
    s3,
    logger,
  });

  if (options.command === "extract" || options.command === "run") {
    await runExtraction({
      manifest,
      paths,
      s3,
      bedrock,
      logger,
      maxTokens: options.maxExtractionTokens ?? DEFAULT_EXTRACTION_TOKENS,
    });
  }

  if (options.command === "aggregate" || options.command === "run") {
    await runAggregation({
      manifest,
      paths,
      bedrock,
      logger,
      maxTokens: options.maxAggregationTokens ?? DEFAULT_AGGREGATION_TOKENS,
    });
  }
}

async function readOrCreateManifest(input: {
  readonly options: RunInterviewFlowOptions;
  readonly paths: OutputPaths;
  readonly s3: S3TranscriptClient;
  readonly logger: (event: Omit<RunLogEvent, "timestamp">) => Promise<void>;
}): Promise<ManifestFile> {
  if (!input.options.refreshManifest && (await fileExists(input.paths.manifestPath))) {
    const existing = JSON.parse(await readFile(input.paths.manifestPath, "utf8")) as ManifestFile;
    await input.logger({
      level: "info",
      event: "manifest.reused",
      message: "Reused existing interview-flow manifest.",
      details: { entries: existing.entries.length },
    });
    return existing;
  }

  const keys = await input.s3.listTranscriptKeys({
    bucket: input.options.bucket,
    prefix: input.options.prefix,
  });
  const entries = buildManifestEntries(input.options.bucket, keys, input.options.limit);
  if (entries.length === 0) {
    throw new Error(
      `No transcript.json objects found under s3://${input.options.bucket}/${input.options.prefix}`,
    );
  }

  const manifest: ManifestFile = {
    version: 1,
    createdAt: new Date().toISOString(),
    bucket: input.options.bucket,
    prefix: input.options.prefix,
    limit: input.options.limit,
    entries,
  };
  await writeJson(input.paths.manifestPath, manifest);
  await input.logger({
    level: "info",
    event: "manifest.created",
    message: "Created interview-flow manifest.",
    details: { entries: manifest.entries.length },
  });
  return manifest;
}

async function runExtraction(input: {
  readonly manifest: ManifestFile;
  readonly paths: OutputPaths;
  readonly s3: S3TranscriptClient;
  readonly bedrock: BedrockJsonClient;
  readonly logger: (event: Omit<RunLogEvent, "timestamp">) => Promise<void>;
  readonly maxTokens: number;
}): Promise<void> {
  let successCount = 0;
  for (const entry of input.manifest.entries) {
    const extractionPath = join(input.paths.extractionsDir, `${entry.transcriptId}.json`);
    if (await validExistingExtraction(extractionPath)) {
      successCount += 1;
      await input.logger({
        level: "info",
        event: "extraction.skipped",
        transcriptId: entry.transcriptId,
        message: "Skipped valid existing extraction.",
      });
      continue;
    }

    try {
      const transcriptInput = await loadOrCreateTranscriptInput(entry, input.paths, input.s3);
      const prompt = buildExtractionPrompt(transcriptInput);
      const raw = await input.bedrock.invokeJsonPrompt({
        prompt,
        maxTokens: input.maxTokens,
        label: entry.transcriptId,
      });
      const extraction = await parseAndRepair({
        raw,
        bedrock: input.bedrock,
        label: entry.transcriptId,
        target: "extraction",
        maxTokens: input.maxTokens,
        debugDir: input.paths.debugDir,
        validate: isExtractionOutput,
      });
      await writeJson(extractionPath, extraction);
      successCount += 1;
      await input.logger({
        level: "info",
        event: "extraction.completed",
        transcriptId: entry.transcriptId,
        message: "Completed per-transcript extraction.",
      });
    } catch (error) {
      await input.logger({
        level: "error",
        event: "extraction.failed",
        transcriptId: entry.transcriptId,
        message: errorMessage(error),
      });
    }
  }

  if (successCount === 0) {
    throw new Error("No interview-flow extractions completed successfully.");
  }
}

async function runAggregation(input: {
  readonly manifest: ManifestFile;
  readonly paths: OutputPaths;
  readonly bedrock: BedrockJsonClient;
  readonly logger: (event: Omit<RunLogEvent, "timestamp">) => Promise<void>;
  readonly maxTokens: number;
}): Promise<void> {
  const extractionInputs: Array<{
    readonly transcript_id: string;
    readonly candidate_name: string | null;
    readonly extraction: unknown;
  }> = [];

  for (const entry of input.manifest.entries) {
    const extractionPath = join(input.paths.extractionsDir, `${entry.transcriptId}.json`);
    if (!(await fileExists(extractionPath))) {
      continue;
    }
    const extraction = JSON.parse(await readFile(extractionPath, "utf8"));
    if (isExtractionOutput(extraction)) {
      extractionInputs.push({
        transcript_id: entry.transcriptId,
        candidate_name: entry.candidateName,
        extraction,
      });
    }
  }

  if (extractionInputs.length === 0) {
    throw new Error("No valid extraction JSON files are available for aggregation.");
  }

  const raw = await input.bedrock.invokeJsonPrompt({
    prompt: buildAggregationPrompt(extractionInputs),
    maxTokens: input.maxTokens,
    label: "aggregate",
  });
  const aggregate = await parseAndRepair({
    raw,
    bedrock: input.bedrock,
    label: "aggregate",
    target: "aggregate",
    maxTokens: input.maxTokens,
    debugDir: input.paths.debugDir,
    validate: isAggregateOutput,
  });

  await writeJson(join(input.paths.aggregateDir, "interview-flow.json"), aggregate);
  await writeFile(
    join(input.paths.aggregateDir, "interview-flow.mmd"),
    `${aggregate.mermaid_flowchart.trim()}\n`,
  );
  await writeFile(
    join(input.paths.aggregateDir, "summary.md"),
    aggregateSummaryMarkdown(aggregate),
  );
  await input.logger({
    level: "info",
    event: "aggregation.completed",
    message: "Completed interview-flow aggregation.",
    details: { extractions: extractionInputs.length },
  });
}

async function loadOrCreateTranscriptInput(
  entry: ManifestEntry,
  paths: OutputPaths,
  s3: S3TranscriptClient,
): Promise<TranscriptInput> {
  const inputPath = join(paths.inputsDir, `${entry.transcriptId}.json`);
  if (await fileExists(inputPath)) {
    return JSON.parse(await readFile(inputPath, "utf8")) as TranscriptInput;
  }

  const transcriptJson = await s3.getJsonObject({
    bucket: entry.s3Bucket,
    key: entry.transcriptKey,
  });
  const transcriptInput: TranscriptInput = {
    transcriptId: entry.transcriptId,
    candidateName: entry.candidateName,
    transcriptText: firefliesTranscriptToText(transcriptJson),
  };
  await writeJson(inputPath, transcriptInput);
  return transcriptInput;
}

async function parseAndRepair<T extends Record<string, unknown>>(input: {
  readonly raw: string;
  readonly bedrock: BedrockJsonClient;
  readonly label: string;
  readonly target: "extraction" | "aggregate";
  readonly maxTokens: number;
  readonly debugDir: string;
  readonly validate: (value: unknown) => value is T;
}): Promise<T> {
  const parsed = parseAndValidate(input.raw, input.validate);
  if (parsed) {
    return parsed;
  }
  await writeDebugResponse(input.debugDir, input.label, input.target, 1, input.raw);

  const repairedRaw = await input.bedrock.invokeJsonPrompt({
    prompt: buildJsonRepairPrompt(input.raw, input.target),
    maxTokens: input.maxTokens,
    label: `${input.label}:repair`,
  });
  const repaired = parseAndValidate(repairedRaw, input.validate);
  if (!repaired) {
    await writeDebugResponse(input.debugDir, input.label, input.target, 2, repairedRaw);
    throw new Error(`Model response for ${input.label} was not valid ${input.target} JSON.`);
  }
  return repaired;
}

function parseAndValidate<T extends Record<string, unknown>>(
  raw: string,
  validate: (value: unknown) => value is T,
): T | null {
  try {
    const parsed = extractJsonObject(raw);
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function validExistingExtraction(path: string): Promise<boolean> {
  if (!(await fileExists(path))) {
    return false;
  }
  try {
    return isExtractionOutput(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return false;
  }
}

function outputPaths(outputDir: string, manifestPath?: string): OutputPaths {
  return {
    outputDir,
    inputsDir: join(outputDir, "inputs"),
    extractionsDir: join(outputDir, "extractions"),
    aggregateDir: join(outputDir, "aggregate"),
    debugDir: join(outputDir, "debug"),
    manifestPath: manifestPath ?? join(outputDir, "manifest.json"),
    logPath: join(outputDir, "run-log.jsonl"),
  };
}

async function ensureOutputDirs(paths: OutputPaths): Promise<void> {
  await mkdir(paths.outputDir, { recursive: true });
  await mkdir(paths.inputsDir, { recursive: true });
  await mkdir(paths.extractionsDir, { recursive: true });
  await mkdir(paths.aggregateDir, { recursive: true });
  await mkdir(paths.debugDir, { recursive: true });
}

async function appendRunLog(
  path: string,
  event: Omit<RunLogEvent, "timestamp">,
): Promise<void> {
  const payload: RunLogEvent = { timestamp: new Date().toISOString(), ...event };
  await appendFile(path, `${JSON.stringify(payload)}\n`);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeDebugResponse(
  debugDir: string,
  label: string,
  target: "extraction" | "aggregate",
  attempt: number,
  raw: string,
): Promise<void> {
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_");
  await writeFile(join(debugDir, `${target}-${safeLabel}-attempt-${attempt}.txt`), raw);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function aggregateSummaryMarkdown(aggregate: Record<string, unknown>): string {
  const summary = asRecord(aggregate.summary);
  return [
    "# Interview Flow Summary",
    "",
    `Top-level strategy: ${stringValue(summary.top_level_interview_strategy) ?? "Not provided."}`,
    "",
    "## Most Common Questions",
    listItems(summary.most_common_questions),
    "",
    "## Most Common Probe Triggers",
    listItems(summary.most_common_probe_triggers),
    "",
    "## Signals Prioritized",
    listItems(summary.signals_interviewer_prioritizes),
    "",
    "## Surprising Patterns",
    listItems(summary.surprising_patterns),
    "",
    "## Low-Confidence Findings",
    listItems(summary.low_confidence_findings),
    "",
  ].join("\n");
}

function listItems(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    return "- None reported.";
  }
  return value.map((item) => `- ${String(item)}`).join("\n");
}

function parseArgs(argv: readonly string[]): RunInterviewFlowOptions {
  const command = parseCommand(argv[0]);
  const flags = argv.slice(1);
  return {
    command,
    bucket: stringFlag(flags, "--bucket") ?? process.env.WEAVE_HISTORICAL_RECORDINGS_BUCKET ?? DEFAULT_BUCKET,
    prefix: stringFlag(flags, "--prefix") ?? process.env.WEAVE_HISTORICAL_RECORDINGS_PREFIX ?? DEFAULT_PREFIX,
    limit: numberFlag(flags, "--limit") ?? DEFAULT_LIMIT,
    outputDir: stringFlag(flags, "--output-dir") ?? DEFAULT_OUTPUT_DIR,
    refreshManifest: booleanFlag(flags, "--refresh-manifest"),
    s3Region: stringFlag(flags, "--s3-region") ?? process.env.WEAVE_HISTORICAL_RECORDINGS_REGION ?? DEFAULT_S3_REGION,
    bedrockRegion: stringFlag(flags, "--bedrock-region") ?? process.env.BEDROCK_REGION ?? DEFAULT_BEDROCK_REGION,
    modelId: stringFlag(flags, "--model-id") ?? process.env.BEDROCK_MODEL_ID ?? DEFAULT_MODEL_ID,
    manifestPath: stringFlag(flags, "--manifest"),
    maxExtractionTokens: numberFlag(flags, "--max-extraction-tokens") ?? DEFAULT_EXTRACTION_TOKENS,
    maxAggregationTokens: numberFlag(flags, "--max-aggregation-tokens") ?? DEFAULT_AGGREGATION_TOKENS,
  };
}

function parseCommand(value: string | undefined): Command {
  if (value === "extract" || value === "aggregate" || value === "run") {
    return value;
  }
  return "run";
}

function stringFlag(flags: readonly string[], name: string): string | undefined {
  const index = flags.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = flags[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function numberFlag(flags: readonly string[], name: string): number | undefined {
  const value = stringFlag(flags, name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function booleanFlag(flags: readonly string[], name: string): boolean {
  return flags.includes(name);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function listArtifactFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).sort();
}
