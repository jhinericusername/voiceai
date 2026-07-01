import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
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

export type WeaveCandidateEvaluationBackfillMode = "dry-run" | "apply";

export interface WeaveCandidateEvaluationBackfillCliArgs {
  readonly inputPath: string;
  readonly organizationId: string;
  readonly mode: WeaveCandidateEvaluationBackfillMode;
}

export interface WeaveCandidateEvaluationBackfillResult {
  readonly mode: WeaveCandidateEvaluationBackfillMode;
  readonly readCount: number;
  readonly validCount: number;
  readonly invalidCount: number;
  readonly syncedCount: number;
  readonly failedCount: number;
  readonly invalidLines?: readonly number[];
  readonly failedLines?: readonly number[];
}

export interface ExecuteWeaveCandidateEvaluationBackfillOptions
  extends WeaveCandidateEvaluationBackfillCliArgs {
  readonly pool?: Pick<Pool, "connect">;
  readonly getDefaultPool?: () => Pick<Pool, "connect">;
  readonly closeDefaultPool?: () => Promise<void>;
  readonly process?: (
    input: ProcessWeaveCandidateEvaluationInput,
  ) => Promise<ProcessWeaveCandidateEvaluationResult>;
}

export interface RunWeaveCandidateEvaluationBackfillCliOptions {
  readonly argv?: readonly string[];
  readonly write?: (message: string) => void;
  readonly pool?: Pick<Pool, "connect">;
  readonly getDefaultPool?: () => Pick<Pool, "connect">;
  readonly closeDefaultPool?: () => Promise<void>;
  readonly process?: (
    input: ProcessWeaveCandidateEvaluationInput,
  ) => Promise<ProcessWeaveCandidateEvaluationResult>;
}

interface ParsedLine {
  readonly lineNumber: number;
  readonly event?: WeaveCandidateEvaluationEvent;
}

const usage =
  "Usage: cli.ts --input <path> --organization-id <org_id> (--dry-run | --apply)";

export function parseWeaveCandidateEvaluationBackfillCliArgs(
  argv: readonly string[],
): WeaveCandidateEvaluationBackfillCliArgs {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  let inputPath: string | undefined;
  let organizationId: string | undefined;
  let dryRun = false;
  let apply = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--input") {
      inputPath = requiredValue(args, index, "--input");
      index += 1;
    } else if (arg === "--organization-id") {
      organizationId = requiredValue(args, index, "--organization-id");
      index += 1;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--apply") {
      apply = true;
    } else {
      throw new Error(`Unknown argument ${arg ?? ""}. ${usage}`);
    }
  }

  if (!inputPath) {
    throw new Error(`--input is required. ${usage}`);
  }
  if (!organizationId) {
    throw new Error(`--organization-id is required. ${usage}`);
  }
  if (Number(dryRun) + Number(apply) !== 1) {
    throw new Error(`Select exactly one of --dry-run or --apply. ${usage}`);
  }

  return {
    inputPath,
    organizationId,
    mode: dryRun ? "dry-run" : "apply",
  };
}

export async function executeWeaveCandidateEvaluationBackfill(
  options: ExecuteWeaveCandidateEvaluationBackfillOptions,
): Promise<WeaveCandidateEvaluationBackfillResult> {
  const parsed = await readAndValidateJsonl(options.inputPath);
  const base = {
    mode: options.mode,
    readCount: parsed.readCount,
    validCount: parsed.validEvents.length,
    invalidCount: parsed.invalidLines.length,
  };

  if (options.mode === "dry-run") {
    return {
      ...base,
      syncedCount: 0,
      failedCount: 0,
    };
  }

  const processor = options.process ?? processWeaveCandidateEvaluationEvent;
  const pool = options.pool ?? (options.getDefaultPool ?? getPool)();
  const shouldClosePool = !options.pool;
  const failedLines: number[] = [];
  let syncedCount = 0;

  try {
    for (const validLine of parsed.validEvents) {
      try {
        await processor({
          pool,
          organizationId: options.organizationId,
          event: validLine.event,
        });
        syncedCount += 1;
      } catch {
        failedLines.push(validLine.lineNumber);
      }
    }
  } finally {
    if (shouldClosePool) {
      await (options.closeDefaultPool ?? closePool)();
    }
  }

  return {
    ...base,
    syncedCount,
    failedCount: failedLines.length,
    ...(parsed.invalidLines.length > 0 ? { invalidLines: parsed.invalidLines } : {}),
    ...(failedLines.length > 0 ? { failedLines } : {}),
  };
}

export async function runWeaveCandidateEvaluationBackfillCli(
  options: RunWeaveCandidateEvaluationBackfillCliOptions = {},
): Promise<WeaveCandidateEvaluationBackfillResult> {
  const args = parseWeaveCandidateEvaluationBackfillCliArgs(
    options.argv ?? process.argv.slice(2),
  );
  const result = await executeWeaveCandidateEvaluationBackfill({
    ...args,
    pool: options.pool,
    getDefaultPool: options.getDefaultPool,
    closeDefaultPool: options.closeDefaultPool,
    process: options.process,
  });
  const write = options.write ?? ((message: string) => process.stdout.write(message));
  write(`${JSON.stringify(result)}\n`);
  return result;
}

async function readAndValidateJsonl(inputPath: string): Promise<{
  readonly readCount: number;
  readonly validEvents: readonly Required<ParsedLine>[];
  readonly invalidLines: readonly number[];
}> {
  const content = await readFile(inputPath, "utf8");
  const validEvents: Required<ParsedLine>[] = [];
  const invalidLines: number[] = [];
  let readCount = 0;

  content.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;

    readCount += 1;
    const lineNumber = index + 1;
    const parsed = parseJson(line);
    if (!parsed.ok) {
      invalidLines.push(lineNumber);
      return;
    }

    const validation = validateWeaveCandidateEvaluationEvent(parsed.value);
    if (!validation.ok) {
      invalidLines.push(lineNumber);
      return;
    }

    validEvents.push({ lineNumber, event: validation.event });
  });

  return { readCount, validEvents, invalidLines };
}

function requiredValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value. ${usage}`);
  }
  return value;
}

function parseJson(value: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n", 1)[0]?.replace(/:\s+.+$/, "").slice(0, 300) ?? "unknown error";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWeaveCandidateEvaluationBackfillCli().catch((error: unknown) => {
    process.stderr.write(`${safeErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}
