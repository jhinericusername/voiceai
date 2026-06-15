import { describe, expect, it, vi } from "vitest";
import {
  assertWeaveMatchCandidateTable,
  formatHistoricalImportResult,
  parseHistoricalImportCliArgs,
  runHistoricalFirefliesImportCli,
} from "../src/weave/fireflies/historical-import.js";

const orgId = "org_01KV4FF7KX24B76H7Q57QVB5CT";

describe("historical Fireflies import CLI argument parsing", () => {
  it("parses explicit production import options", () => {
    const options = parseHistoricalImportCliArgs(
      [
        "--mode",
        "apply",
        "--source-bucket",
        "weave-fireflies-prod-851725544921-us-west-2",
        "--source-prefix",
        "raw/fireflies/",
        "--source-region",
        "us-west-2",
        "--target-bucket",
        "puddle-videoagent-artifacts-851725544921-us-west-1",
        "--target-region",
        "us-west-1",
        "--org-id",
        orgId,
        "--limit",
        "5",
        "--since-date",
        "2026-06-11",
        "--until-date",
        "2026-06-13",
        "--batch-size",
        "25",
        "--require-weave-match-enrichment",
        "--confirm-apply",
      ],
      {},
    );

    expect(options).toEqual({
      mode: "apply",
      sourceBucket: "weave-fireflies-prod-851725544921-us-west-2",
      sourcePrefix: "raw/fireflies/",
      sourceRegion: "us-west-2",
      targetBucket: "puddle-videoagent-artifacts-851725544921-us-west-1",
      targetRegion: "us-west-1",
      orgId,
      limit: 5,
      sinceDate: "2026-06-11",
      untilDate: "2026-06-13",
      batchSize: 25,
      requireWeaveMatchEnrichment: true,
      confirmApply: true,
    });
  });

  it("uses safe defaults from environment", () => {
    const options = parseHistoricalImportCliArgs(
      ["--org-id", orgId],
      {
        WEAVE_HISTORICAL_RECORDINGS_BUCKET: "weave-default-bucket",
        PUDDLE_ARTIFACTS_BUCKET: "puddle-default-bucket",
        AWS_REGION: "us-east-2",
      },
    );

    expect(options).toMatchObject({
      mode: "dry-run",
      sourceBucket: "weave-default-bucket",
      sourcePrefix: "raw/fireflies/",
      sourceRegion: "us-west-2",
      targetBucket: "puddle-default-bucket",
      targetRegion: "us-east-2",
      orgId,
      batchSize: 25,
      requireWeaveMatchEnrichment: true,
      confirmApply: false,
    });
  });

  it("treats empty env vars as absent for defaults and required buckets", () => {
    const options = parseHistoricalImportCliArgs(
      [
        "--org-id",
        orgId,
        "--source-bucket",
        "weave-cli-bucket",
        "--target-bucket",
        "puddle-cli-bucket",
      ],
      {
        WEAVE_HISTORICAL_RECORDINGS_BUCKET: "",
        WEAVE_HISTORICAL_RECORDINGS_PREFIX: "",
        WEAVE_HISTORICAL_RECORDINGS_REGION: "",
        PUDDLE_ARTIFACTS_BUCKET: "",
        PUDDLE_ARTIFACTS_REGION: "",
        AWS_REGION: "",
      },
    );

    expect(options).toMatchObject({
      sourceBucket: "weave-cli-bucket",
      targetBucket: "puddle-cli-bucket",
      sourcePrefix: "raw/fireflies/",
      sourceRegion: "us-west-2",
      targetRegion: "us-west-1",
    });

    expect(() =>
      parseHistoricalImportCliArgs(["--org-id", orgId], {
        WEAVE_HISTORICAL_RECORDINGS_BUCKET: "",
        PUDDLE_ARTIFACTS_BUCKET: "",
      }),
    ).toThrow(/--source-bucket is required/);
  });

  it("rejects impossible calendar dates while accepting valid import windows", () => {
    expect(
      parseHistoricalImportCliArgs(
        [
          "--org-id",
          orgId,
          "--source-bucket",
          "weave",
          "--target-bucket",
          "puddle",
          "--since-date",
          "2026-06-13",
          "--until-date",
          "2026-06-13",
        ],
        {},
      ),
    ).toMatchObject({
      sinceDate: "2026-06-13",
      untilDate: "2026-06-13",
    });

    expect(() =>
      parseHistoricalImportCliArgs(
        [
          "--org-id",
          orgId,
          "--source-bucket",
          "weave",
          "--target-bucket",
          "puddle",
          "--since-date",
          "2026-02-31",
        ],
        {},
      ),
    ).toThrow(/--since-date must use a real YYYY-MM-DD calendar date/);

    expect(() =>
      parseHistoricalImportCliArgs(
        [
          "--org-id",
          orgId,
          "--source-bucket",
          "weave",
          "--target-bucket",
          "puddle",
          "--until-date",
          "2026-04-31",
        ],
        {},
      ),
    ).toThrow(/--until-date must use a real YYYY-MM-DD calendar date/);
  });

  it("requires an org id", () => {
    expect(() =>
      parseHistoricalImportCliArgs(["--source-bucket", "weave", "--target-bucket", "puddle"], {}),
    ).toThrow(/--org-id is required/);
  });
});

describe("historical Fireflies import Weave preflight", () => {
  it("checks the match candidate table before importing", async () => {
    const queries: string[] = [];
    await assertWeaveMatchCandidateTable({
      async query(sql: string) {
        queries.push(sql);
        return {
          rows: [
            {
              match_candidates_table: "weave_fireflies_recording_match_candidates",
            },
          ],
        };
      },
    });

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("to_regclass('public.weave_fireflies_recording_match_candidates')");
  });

  it("fails when the match candidate table is missing", async () => {
    await expect(
      assertWeaveMatchCandidateTable({
        async query() {
          return { rows: [{ match_candidates_table: null }] };
        },
      }),
    ).rejects.toThrow(/weave_fireflies_recording_match_candidates/);
  });
});

describe("historical Fireflies import CLI runner", () => {
  it("fails before importing when required Weave enrichment cannot be opened", async () => {
    const execute = vi.fn();

    await expect(
      runHistoricalFirefliesImportCli(["--org-id", orgId], {
        env: {
          WEAVE_HISTORICAL_RECORDINGS_BUCKET: "weave",
          PUDDLE_ARTIFACTS_BUCKET: "puddle",
        },
        getWeavePool() {
          throw new Error("WEAVE_DATABASE_URL or split Weave DB config must be set");
        },
        execute,
        write() {},
      }),
    ).rejects.toThrow(/WEAVE_DATABASE_URL/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("prints dry-run count fields without transcript content or secrets", async () => {
    const output: string[] = [];
    const execute = vi.fn(async () => ({
      mode: "dry-run",
      plannedCount: 3,
      importedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      copyCount: 7,
      skippedCopyCount: 0,
      dbWriteCount: 0,
      selectedMatches: 2,
      rankedMatchCandidates: 5,
      unindexedRecordings: 1,
      plans: [{ transcript: { turns: [{ text: "do not print this transcript text" }] } }],
      failures: [],
    }));

    await runHistoricalFirefliesImportCli(
      [
        "--mode",
        "dry-run",
        "--source-bucket",
        "weave-fireflies-prod-851725544921-us-west-2",
        "--source-prefix",
        "raw/fireflies/",
        "--source-region",
        "us-west-2",
        "--target-bucket",
        "puddle-videoagent-artifacts-851725544921-us-west-1",
        "--target-region",
        "us-west-1",
        "--org-id",
        orgId,
        "--limit",
        "5",
        "--since-date",
        "2026-06-11",
        "--until-date",
        "2026-06-13",
        "--batch-size",
        "25",
        "--require-weave-match-enrichment",
      ],
      {
        env: {},
        createS3Client: (region) => ({ region }),
        getWeavePool: () => ({
          async query() {
            return {
              rows: [
                {
                  match_candidates_table: "weave_fireflies_recording_match_candidates",
                },
              ],
            };
          },
        }),
        execute,
        write(message) {
          output.push(message);
        },
      },
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "dry-run",
        orgId,
        sourceBucket: "weave-fireflies-prod-851725544921-us-west-2",
        sourcePrefix: "raw/fireflies/",
        targetBucket: "puddle-videoagent-artifacts-851725544921-us-west-1",
        sourceS3: { region: "us-west-2" },
        targetS3: { region: "us-west-1" },
        limit: 5,
        sinceDate: "2026-06-11",
        untilDate: "2026-06-13",
        batchSize: 25,
      }),
    );
    expect(output.join("")).toContain("planned_count=3");
    expect(output.join("")).toContain("selected_matches=2");
    expect(output.join("")).toContain("ranked_match_candidates=5");
    expect(output.join("")).toContain("unindexed_recordings=1");
    expect(output.join("")).toContain("db_write_count=0");
    expect(output.join("")).not.toContain("do not print this transcript text");
    expect(output.join("")).not.toContain("secret");
  });

  it("requires explicit confirmation before apply mode can run", async () => {
    const execute = vi.fn();

    await expect(
      runHistoricalFirefliesImportCli(
        [
          "--mode",
          "apply",
          "--source-bucket",
          "weave",
          "--target-bucket",
          "puddle",
          "--org-id",
          orgId,
        ],
        {
          env: {},
          execute,
          write() {},
        },
      ),
    ).rejects.toThrow(/--confirm-apply/);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("historical Fireflies import output formatting", () => {
  it("formats only summary counters and failure ids", () => {
    const output = formatHistoricalImportResult({
      mode: "dry-run",
      plannedCount: 1,
      importedCount: 0,
      skippedCount: 0,
      failedCount: 1,
      copyCount: 2,
      skippedCopyCount: 0,
      dbWriteCount: 0,
      selectedMatches: 0,
      rankedMatchCandidates: 1,
      unindexedRecordings: 1,
      plans: [{ transcript: { turns: [{ text: "raw transcript text" }] } }],
      failures: [{ transcriptId: "01ABC", message: "failed without secret details" }],
    });

    expect(output).toContain("planned_count=1");
    expect(output).toContain("failed transcript_id=01ABC");
    expect(output).not.toContain("raw transcript text");
  });
});
