import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  executeWeaveCandidateEvaluationBackfill,
  parseWeaveCandidateEvaluationBackfillCliArgs,
  runWeaveCandidateEvaluationBackfillCli,
} from "../src/weave/candidate-evaluations/cli.js";
import type {
  ProcessWeaveCandidateEvaluationInput,
  ProcessWeaveCandidateEvaluationResult,
} from "../src/weave/candidate-evaluations/processor.js";

const organizationId = "org_01KW0W3Y7RXZ5NPTRT8E1S3QVK";

describe("Weave candidate evaluation backfill CLI", () => {
  it("dry-runs JSONL validation without opening the DB processor", async () => {
    const inputPath = await writeJsonl([validRawEvent(), { eventId: "evt_bad" }]);

    const result = await executeWeaveCandidateEvaluationBackfill({
      inputPath,
      organizationId,
      mode: "dry-run",
      process: async () => {
        throw new Error("processor should not be called during dry-run");
      },
    });

    expect(result).toEqual({
      mode: "dry-run",
      readCount: 2,
      validCount: 1,
      invalidCount: 1,
      syncedCount: 0,
      failedCount: 0,
    });
  });

  it("applies only valid events with the requested organization id", async () => {
    const inputPath = await writeJsonl([validRawEvent(), { eventId: "evt_bad" }]);
    const processed: ProcessWeaveCandidateEvaluationInput[] = [];

    const result = await executeWeaveCandidateEvaluationBackfill({
      inputPath,
      organizationId,
      mode: "apply",
      pool: fakePool,
      process: async (input) => {
        processed.push(input);
        return processResult(input);
      },
    });

    expect(result).toMatchObject({
      mode: "apply",
      readCount: 2,
      validCount: 1,
      invalidCount: 1,
      syncedCount: 1,
      failedCount: 0,
    });
    expect(processed).toHaveLength(1);
    expect(processed[0]).toMatchObject({
      pool: fakePool,
      organizationId,
      event: { eventId: "evt_1" },
    });
  });

  it("parses required arguments and rejects ambiguous modes", () => {
    expect(() => parseWeaveCandidateEvaluationBackfillCliArgs([])).toThrow(
      /--input is required/,
    );
    expect(() =>
      parseWeaveCandidateEvaluationBackfillCliArgs(["--input", "events.jsonl"]),
    ).toThrow(/--organization-id is required/);
    expect(() =>
      parseWeaveCandidateEvaluationBackfillCliArgs([
        "--input",
        "events.jsonl",
        "--organization-id",
        organizationId,
      ]),
    ).toThrow(/exactly one of --dry-run or --apply/);
    expect(() =>
      parseWeaveCandidateEvaluationBackfillCliArgs([
        "--input",
        "events.jsonl",
        "--organization-id",
        organizationId,
        "--dry-run",
        "--apply",
      ]),
    ).toThrow(/exactly one of --dry-run or --apply/);

    expect(
      parseWeaveCandidateEvaluationBackfillCliArgs([
        "--",
        "--input",
        "events.jsonl",
        "--organization-id",
        organizationId,
        "--dry-run",
      ]),
    ).toEqual({
      inputPath: "events.jsonl",
      organizationId,
      mode: "dry-run",
    });
  });

  it("prints safe aggregate JSON without raw candidate payloads", async () => {
    const inputPath = await writeJsonl([validRawEvent({ candidate_name: "PRIVATE_NAME" })]);
    const output: string[] = [];

    const result = await runWeaveCandidateEvaluationBackfillCli({
      argv: ["--input", inputPath, "--organization-id", organizationId, "--dry-run"],
      write: (message) => output.push(message),
    });

    expect(result.mode).toBe("dry-run");
    const printed = output.join("");
    expect(JSON.parse(printed)).toEqual({
      mode: "dry-run",
      readCount: 1,
      validCount: 1,
      invalidCount: 0,
      syncedCount: 0,
      failedCount: 0,
    });
    expect(printed).not.toContain("PRIVATE_NAME");
  });
});

const fakePool = { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) };

async function writeJsonl(events: readonly unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "weave-candidate-evaluations-"));
  const path = join(dir, "events.jsonl");
  await writeFile(path, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  return path;
}

function processResult(
  input: ProcessWeaveCandidateEvaluationInput,
): ProcessWeaveCandidateEvaluationResult {
  return {
    status: "synced",
    sourceEvaluationId: input.event.evaluation.sourceEvaluationId,
    applicationId: input.event.evaluation.ashbyApplicationId,
    scoreId: "score_1",
  };
}

function validRawEvent(recordOverrides: Record<string, unknown> = {}) {
  return {
    eventId: "evt_1",
    source: "weave_supabase_candidate_evaluation",
    operation: "INSERT",
    record: {
      id: "eval_1",
      candidate_name: "Ada Lovelace",
      interview_date: "2026-06-15",
      problem_solving: 3,
      agency: 3,
      competitiveness: 3,
      curious: 3,
      comments: "Strong technical screen.",
      ashby_application_id: "app_1",
      ashby_candidate_id: "cand_1",
      ashby_job_id: "job_1",
      created_at: "2026-06-15T10:00:00.000Z",
      updated_at: "2026-06-15T10:05:00.000Z",
      ...recordOverrides,
    },
  };
}
