# Fireflies Interview Flow Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, resumable Opus 4.8 pipeline that extracts interview question-flow JSON from Fireflies transcripts and aggregates it into a Mermaid-backed flowchart.

**Architecture:** Add a focused TypeScript Fireflies interview-flow module under `backend/src/weave/fireflies/`. Keep transcript parsing, prompt rendering, JSON validation, AWS access, and CLI orchestration in separate units so tests can run without S3 or Bedrock. Write all transcript-derived artifacts under `artifacts/interview-flow/`, which must be gitignored.

**Tech Stack:** TypeScript, Vitest, Node 20, AWS SDK v3 for S3 and Bedrock Runtime, Amazon Bedrock Converse with `us.anthropic.claude-opus-4-8`.

---

## File Structure

- Modify: `.gitignore`  
  Add `artifacts/` so transcript-derived files never appear in git status.
- Modify: `backend/package.json`  
  Add AWS SDK dependencies and scripts: `interview-flow:extract`, `interview-flow:aggregate`, `interview-flow:run`.
- Modify: `pnpm-lock.yaml`  
  Updated by the package manager after adding AWS SDK dependencies.
- Create: `backend/src/weave/fireflies/interview-flow/prompts.ts`  
  Contains the user's extraction and aggregation prompt templates.
- Create: `backend/src/weave/fireflies/interview-flow/types.ts`  
  Shared manifest, transcript, extraction, aggregate, client, and run-log types.
- Create: `backend/src/weave/fireflies/interview-flow/core.ts`  
  Pure functions for S3 transcript key selection, stable ID assignment, Fireflies transcript normalization, prompt rendering, JSON parsing, schema-shape validation, and summary/Mermaid extraction.
- Create: `backend/src/weave/fireflies/interview-flow/aws.ts`  
  AWS SDK client adapters for listing/getting Fireflies transcripts and invoking Bedrock Converse.
- Create: `backend/src/weave/fireflies/interview-flow/cli.ts`  
  CLI entrypoint that discovers transcripts, writes/reuses the manifest, runs extraction, runs aggregation, handles resume behavior, and writes artifact files.
- Create: `backend/src/weave/fireflies/interview-flow.ts`  
  Thin executable wrapper importing `runCli`.
- Create: `backend/test/fireflies-interview-flow.test.ts`  
  Unit tests for pure functions, validation, prompt rendering, and orchestration with fake clients.

## Task 1: Add Package Wiring And Artifact Ignore

**Files:**
- Modify: `.gitignore`
- Modify: `backend/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add gitignore test by inspection**

  Run:

  ```bash
  rg -n "^artifacts/$" .gitignore || true
  ```

  Expected before implementation: no output.

- [ ] **Step 2: Add artifact ignore rule**

  Add this under `# Local artifacts` in `.gitignore`:

  ```gitignore
  artifacts/
  ```

- [ ] **Step 3: Add backend dependencies and scripts**

  Run:

  ```bash
  pnpm --filter @puddle/backend add @aws-sdk/client-s3 @aws-sdk/client-bedrock-runtime
  ```

  Then update `backend/package.json` scripts to include:

  ```json
  {
    "interview-flow:extract": "node --import tsx src/weave/fireflies/interview-flow.ts extract",
    "interview-flow:aggregate": "node --import tsx src/weave/fireflies/interview-flow.ts aggregate",
    "interview-flow:run": "node --import tsx src/weave/fireflies/interview-flow.ts run"
  }
  ```

  Keep existing scripts unchanged.

- [ ] **Step 4: Verify package wiring**

  Run:

  ```bash
  pnpm --filter @puddle/backend exec tsx --version
  pnpm --filter @puddle/backend exec node -e "import('@aws-sdk/client-s3').then(() => console.log('s3-ok'))"
  pnpm --filter @puddle/backend exec node -e "import('@aws-sdk/client-bedrock-runtime').then(() => console.log('bedrock-ok'))"
  ```

  Expected: command output includes `s3-ok` and `bedrock-ok`.

- [ ] **Step 5: Commit package wiring**

  ```bash
  git add .gitignore backend/package.json pnpm-lock.yaml
  git commit -m "Add interview flow extraction package wiring"
  ```

## Task 2: Add Pure Interview-Flow Core

**Files:**
- Create: `backend/src/weave/fireflies/interview-flow/prompts.ts`
- Create: `backend/src/weave/fireflies/interview-flow/types.ts`
- Create: `backend/src/weave/fireflies/interview-flow/core.ts`
- Create: `backend/test/fireflies-interview-flow.test.ts`

- [ ] **Step 1: Write failing pure-function tests**

  Add tests in `backend/test/fireflies-interview-flow.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import {
    buildExtractionPrompt,
    buildManifestEntries,
    extractJsonObject,
    firefliesTranscriptToText,
    isAggregateOutput,
    isExtractionOutput,
  } from "../src/weave/fireflies/interview-flow/core.js";

  describe("Fireflies interview flow core", () => {
    it("assigns stable transcript IDs from sorted transcript keys", () => {
      const entries = buildManifestEntries(
        "weave-fireflies-prod-851725544921-us-west-2",
        [
          "raw/fireflies/z/transcript.json",
          "raw/fireflies/a/transcript.json",
          "raw/fireflies/m/not-transcript.json",
          "raw/fireflies/b/transcript.json",
        ],
        2,
      );

      expect(entries).toEqual([
        {
          transcriptId: "interview_001",
          candidateName: null,
          s3Bucket: "weave-fireflies-prod-851725544921-us-west-2",
          transcriptKey: "raw/fireflies/a/transcript.json",
        },
        {
          transcriptId: "interview_002",
          candidateName: null,
          s3Bucket: "weave-fireflies-prod-851725544921-us-west-2",
          transcriptKey: "raw/fireflies/b/transcript.json",
        },
      ]);
    });

    it("normalizes Fireflies sentence transcripts into speaker-labeled text", () => {
      const text = firefliesTranscriptToText({
        sentences: [
          { speaker_name: "Prakul Singh", text: "Tell me about yourself.", start_time: 12.2 },
          { speaker_name: "Candidate", text: "I build tools.", start_time: 16 },
        ],
      });

      expect(text).toContain("[00:12] INTERVIEWER: Tell me about yourself.");
      expect(text).toContain("[00:16] CANDIDATE: I build tools.");
    });

    it("renders the extraction prompt with the stable transcript wrapper", () => {
      const prompt = buildExtractionPrompt({
        transcriptId: "interview_001",
        candidateName: null,
        transcriptText: "[00:01] INTERVIEWER: Hi",
      });

      expect(prompt).toContain("\"transcript_id\": \"interview_001\"");
      expect(prompt).toContain("<TRANSCRIPT>");
      expect(prompt).toContain("[00:01] INTERVIEWER: Hi");
    });

    it("extracts JSON objects from fenced model output", () => {
      expect(extractJsonObject("```json\n{\"ok\":true}\n```")).toEqual({ ok: true });
    });

    it("validates required extraction and aggregate shapes", () => {
      expect(
        isExtractionOutput({
          interview_metadata: {},
          question_events: [],
          observed_patterns: {},
          flowchart_edges: [],
          quality_notes: {},
        }),
      ).toBe(true);
      expect(isExtractionOutput({ question_events: [] })).toBe(false);

      expect(
        isAggregateOutput({
          global_interview_flow: {},
          canonical_questions: [],
          follow_up_logic: [],
          flowchart: {},
          mermaid_flowchart: "flowchart TD\nA-->B",
          summary: {},
        }),
      ).toBe(true);
      expect(isAggregateOutput({ mermaid_flowchart: "flowchart TD" })).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run:

  ```bash
  pnpm --filter @puddle/backend test -- --run backend/test/fireflies-interview-flow.test.ts
  ```

  Expected: FAIL because `interview-flow/core.js` does not exist.

- [ ] **Step 3: Add prompt templates**

  Create `backend/src/weave/fireflies/interview-flow/prompts.ts` with exported string constants named `EXTRACTION_PROMPT_TEMPLATE` and `AGGREGATION_PROMPT_TEMPLATE`.

  `EXTRACTION_PROMPT_TEMPLATE` must contain the complete per-transcript extraction prompt from the approved user request, including the full JSON schema from `interview_metadata` through `quality_notes`.

  `AGGREGATION_PROMPT_TEMPLATE` must contain the complete aggregation prompt from the approved user request, including the full JSON schema from `global_interview_flow` through `summary`.

  Both constants must preserve `{{TRANSCRIPT_TEXT}}` and `{{ALL_TRANSCRIPT_EXTRACTIONS_JSON}}` placeholders exactly so `core.ts` can render them.

- [ ] **Step 4: Add shared types**

  Create `backend/src/weave/fireflies/interview-flow/types.ts`:

  ```ts
  export interface ManifestEntry {
    readonly transcriptId: string;
    readonly candidateName: string | null;
    readonly s3Bucket: string;
    readonly transcriptKey: string;
  }

  export interface TranscriptInput {
    readonly transcriptId: string;
    readonly candidateName: string | null;
    readonly transcriptText: string;
  }

  export interface ManifestFile {
    readonly version: 1;
    readonly createdAt: string;
    readonly bucket: string;
    readonly prefix: string;
    readonly limit: number;
    readonly entries: readonly ManifestEntry[];
  }

  export interface RunLogEvent {
    readonly timestamp: string;
    readonly level: "info" | "warn" | "error";
    readonly event: string;
    readonly transcriptId?: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  }

  export interface S3TranscriptClient {
    listTranscriptKeys(input: { readonly bucket: string; readonly prefix: string }): Promise<string[]>;
    getJsonObject(input: { readonly bucket: string; readonly key: string }): Promise<unknown>;
  }

  export interface BedrockJsonClient {
    invokeJsonPrompt(input: {
      readonly prompt: string;
      readonly maxTokens: number;
      readonly label: string;
    }): Promise<string>;
  }
  ```

- [ ] **Step 5: Add pure core implementation**

  Create `backend/src/weave/fireflies/interview-flow/core.ts` with:

  ```ts
  import { AGGREGATION_PROMPT_TEMPLATE, EXTRACTION_PROMPT_TEMPLATE } from "./prompts.js";
  import { ManifestEntry, TranscriptInput } from "./types.js";

  type JsonRecord = Record<string, unknown>;

  export function buildManifestEntries(
    bucket: string,
    keys: readonly string[],
    limit: number,
  ): ManifestEntry[] {
    return keys
      .filter((key) => key.endsWith("/transcript.json") || key.endsWith("transcript.json"))
      .sort((left, right) => left.localeCompare(right))
      .slice(0, limit)
      .map((key, index) => ({
        transcriptId: `interview_${String(index + 1).padStart(3, "0")}`,
        candidateName: null,
        s3Bucket: bucket,
        transcriptKey: key,
      }));
  }

  export function firefliesTranscriptToText(value: unknown): string {
    const record = asRecord(value);
    const sentences = Array.isArray(record.sentences) ? record.sentences : [];
    return sentences
      .map((sentence) => sentenceToLine(asRecord(sentence)))
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  export function buildExtractionPrompt(input: TranscriptInput): string {
    const wrapper = JSON.stringify(
      {
        transcript_id: input.transcriptId,
        candidate_name: input.candidateName,
        transcript_text: input.transcriptText,
      },
      null,
      2,
    );
    return EXTRACTION_PROMPT_TEMPLATE.replace("{{TRANSCRIPT_TEXT}}", wrapper);
  }

  export function buildAggregationPrompt(extractions: readonly unknown[]): string {
    return AGGREGATION_PROMPT_TEMPLATE.replace(
      "{{ALL_TRANSCRIPT_EXTRACTIONS_JSON}}",
      JSON.stringify(extractions, null, 2),
    );
  }

  export function extractJsonObject(text: string): unknown {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const candidate = fenced ? fenced[1] ?? "" : trimmed;
    return JSON.parse(candidate);
  }

  export function isExtractionOutput(value: unknown): value is JsonRecord {
    const record = asRecord(value);
    return Boolean(
      record.interview_metadata &&
        Array.isArray(record.question_events) &&
        record.observed_patterns &&
        Array.isArray(record.flowchart_edges) &&
        record.quality_notes,
    );
  }

  export function isAggregateOutput(value: unknown): value is JsonRecord {
    const record = asRecord(value);
    return Boolean(
      record.global_interview_flow &&
        Array.isArray(record.canonical_questions) &&
        Array.isArray(record.follow_up_logic) &&
        record.flowchart &&
        typeof record.mermaid_flowchart === "string" &&
        record.summary,
    );
  }

  function sentenceToLine(sentence: JsonRecord): string | null {
    const text = stringValue(sentence.text);
    if (!text) {
      return null;
    }
    const speaker = normalizeSpeaker(stringValue(sentence.speaker_name) ?? stringValue(sentence.speaker));
    const timestamp = secondsToTimestamp(numberValue(sentence.start_time) ?? numberValue(sentence.startTime));
    return `[${timestamp}] ${speaker}: ${text}`;
  }

  function normalizeSpeaker(value: string | null): "INTERVIEWER" | "CANDIDATE" {
    if (value && /prakul|interviewer|host/i.test(value)) {
      return "INTERVIEWER";
    }
    return "CANDIDATE";
  }

  function secondsToTimestamp(value: number | null): string {
    const totalSeconds = Math.max(0, Math.floor(value ?? 0));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function asRecord(value: unknown): JsonRecord {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonRecord)
      : {};
  }

  function stringValue(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  function numberValue(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  ```

- [ ] **Step 6: Run pure tests**

  Run:

  ```bash
  pnpm --filter @puddle/backend test -- --run backend/test/fireflies-interview-flow.test.ts
  ```

  Expected: PASS for the core tests.

- [ ] **Step 7: Commit pure core**

  ```bash
  git add backend/src/weave/fireflies/interview-flow backend/test/fireflies-interview-flow.test.ts
  git commit -m "Add Fireflies interview flow core"
  ```

## Task 3: Add AWS SDK Adapters

**Files:**
- Create: `backend/src/weave/fireflies/interview-flow/aws.ts`
- Modify: `backend/test/fireflies-interview-flow.test.ts`

- [ ] **Step 1: Add adapter tests with fake clients**

  Extend `backend/test/fireflies-interview-flow.test.ts` with tests that instantiate adapter helpers using fake send functions:

  ```ts
  import { makeBedrockJsonClient, makeS3TranscriptClient } from "../src/weave/fireflies/interview-flow/aws.js";

  it("lists transcript keys across paginated S3 responses", async () => {
    const calls: unknown[] = [];
    const s3 = makeS3TranscriptClient({
      send: async (command: unknown) => {
        calls.push(command);
        return calls.length === 1
          ? { Contents: [{ Key: "raw/fireflies/a/transcript.json" }], NextContinuationToken: "next" }
          : { Contents: [{ Key: "raw/fireflies/b/transcript.json" }] };
      },
    });

    await expect(s3.listTranscriptKeys({ bucket: "bucket", prefix: "raw/fireflies/" })).resolves.toEqual([
      "raw/fireflies/a/transcript.json",
      "raw/fireflies/b/transcript.json",
    ]);
  });

  it("invokes Bedrock Converse and returns text content", async () => {
    const bedrock = makeBedrockJsonClient({
      modelId: "us.anthropic.claude-opus-4-8",
      client: {
        send: async () => ({
          output: { message: { content: [{ text: "{\"ok\":true}" }] } },
        }),
      },
    });

    await expect(
      bedrock.invokeJsonPrompt({ prompt: "Return JSON", maxTokens: 128, label: "test" }),
    ).resolves.toBe("{\"ok\":true}");
  });
  ```

- [ ] **Step 2: Run adapter tests to verify failure**

  Run:

  ```bash
  pnpm --filter @puddle/backend test -- --run backend/test/fireflies-interview-flow.test.ts
  ```

  Expected: FAIL because `aws.ts` does not exist.

- [ ] **Step 3: Implement AWS adapters**

  Create `backend/src/weave/fireflies/interview-flow/aws.ts`:

  ```ts
  import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
  import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
  import { BedrockJsonClient, S3TranscriptClient } from "./types.js";

  interface SendClient {
    send(command: unknown): Promise<unknown>;
  }

  export function createS3TranscriptClient(region: string): S3TranscriptClient {
    return makeS3TranscriptClient(new S3Client({ region }));
  }

  export function makeS3TranscriptClient(client: SendClient): S3TranscriptClient {
    return {
      async listTranscriptKeys(input) {
        const keys: string[] = [];
        let token: string | undefined;
        do {
          const response = (await client.send(
            new ListObjectsV2Command({
              Bucket: input.bucket,
              Prefix: input.prefix,
              ContinuationToken: token,
            }),
          )) as { Contents?: Array<{ Key?: string }>; NextContinuationToken?: string };
          for (const object of response.Contents ?? []) {
            if (object.Key) {
              keys.push(object.Key);
            }
          }
          token = response.NextContinuationToken;
        } while (token);
        return keys;
      },
      async getJsonObject(input) {
        const response = (await client.send(
          new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
        )) as { Body?: { transformToString?: () => Promise<string> } };
        const body = await response.Body?.transformToString?.();
        if (!body) {
          throw new Error(`S3 object has empty body: s3://${input.bucket}/${input.key}`);
        }
        return JSON.parse(body);
      },
    };
  }

  export function createBedrockJsonClient(region: string, modelId: string): BedrockJsonClient {
    return makeBedrockJsonClient({
      modelId,
      client: new BedrockRuntimeClient({ region }),
    });
  }

  export function makeBedrockJsonClient(input: {
    readonly modelId: string;
    readonly client: SendClient;
  }): BedrockJsonClient {
    return {
      async invokeJsonPrompt(request) {
        const response = (await input.client.send(
          new ConverseCommand({
            modelId: input.modelId,
            messages: [{ role: "user", content: [{ text: request.prompt }] }],
            inferenceConfig: { maxTokens: request.maxTokens },
          }),
        )) as { output?: { message?: { content?: Array<{ text?: string }> } } };
        const text = response.output?.message?.content?.find((part) => part.text)?.text;
        if (!text) {
          throw new Error(`Bedrock response did not include text for ${request.label}`);
        }
        return text;
      },
    };
  }
  ```

- [ ] **Step 4: Run adapter tests**

  Run:

  ```bash
  pnpm --filter @puddle/backend test -- --run backend/test/fireflies-interview-flow.test.ts
  ```

  Expected: PASS.

- [ ] **Step 5: Commit AWS adapters**

  ```bash
  git add backend/src/weave/fireflies/interview-flow/aws.ts backend/test/fireflies-interview-flow.test.ts
  git commit -m "Add Bedrock and S3 interview flow adapters"
  ```

## Task 4: Add CLI Orchestration And Resume Behavior

**Files:**
- Create: `backend/src/weave/fireflies/interview-flow/cli.ts`
- Create: `backend/src/weave/fireflies/interview-flow.ts`
- Modify: `backend/test/fireflies-interview-flow.test.ts`

- [ ] **Step 1: Add orchestration tests**

  Extend `backend/test/fireflies-interview-flow.test.ts` with a temp-directory run test:

  ```ts
  import { mkdtemp, readFile } from "node:fs/promises";
  import { join } from "node:path";
  import { tmpdir } from "node:os";
  import { runInterviewFlow } from "../src/weave/fireflies/interview-flow/cli.js";

  it("runs extraction and aggregation with fake clients and writes artifacts", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "interview-flow-"));
    const s3 = {
      listTranscriptKeys: async () => ["raw/fireflies/a/transcript.json"],
      getJsonObject: async () => ({
        sentences: [
          { speaker_name: "Prakul Singh", text: "What did you build?", start_time: 1 },
          { speaker_name: "Candidate", text: "A queue.", start_time: 3 },
        ],
      }),
    };
    const bedrock = {
      invokeJsonPrompt: async ({ label }: { label: string }) =>
        label === "aggregate"
          ? JSON.stringify({
              global_interview_flow: {},
              canonical_questions: [],
              follow_up_logic: [],
              flowchart: {},
              mermaid_flowchart: "flowchart TD\nCQ001[Question]",
              summary: {},
            })
          : JSON.stringify({
              interview_metadata: {},
              question_events: [],
              observed_patterns: {},
              flowchart_edges: [],
              quality_notes: {},
            }),
    };

    await runInterviewFlow({
      command: "run",
      bucket: "bucket",
      prefix: "raw/fireflies/",
      limit: 1,
      outputDir: outDir,
      s3,
      bedrock,
      refreshManifest: true,
    });

    await expect(readFile(join(outDir, "manifest.json"), "utf8")).resolves.toContain("interview_001");
    await expect(readFile(join(outDir, "extractions", "interview_001.json"), "utf8")).resolves.toContain(
      "question_events",
    );
    await expect(readFile(join(outDir, "aggregate", "interview-flow.mmd"), "utf8")).resolves.toContain(
      "flowchart TD",
    );
  });
  ```

- [ ] **Step 2: Run orchestration tests to verify failure**

  Run:

  ```bash
  pnpm --filter @puddle/backend test -- --run backend/test/fireflies-interview-flow.test.ts
  ```

  Expected: FAIL because `cli.ts` does not exist.

- [ ] **Step 3: Implement CLI orchestration**

  Create `backend/src/weave/fireflies/interview-flow/cli.ts` with exported `runInterviewFlow(options)` and `runCli(argv)` functions that:

  - Parses commands: `extract`, `aggregate`, `run`.
  - Defaults bucket to `weave-fireflies-prod-851725544921-us-west-2`.
  - Defaults prefix to `raw/fireflies/`.
  - Defaults transcript limit to `50`.
  - Defaults S3 region to `us-west-2`.
  - Defaults Bedrock region to `us-east-1`.
  - Defaults model ID to `us.anthropic.claude-opus-4-8`.
  - Defaults output directory to `artifacts/interview-flow`.
  - Creates output subdirectories.
  - Writes/reuses `manifest.json`.
  - Writes `inputs/<transcript_id>.json`.
  - Skips valid existing `extractions/<transcript_id>.json`.
  - Invokes Bedrock for missing/invalid extractions with `maxTokens` around `12000`.
  - Retries once with a JSON repair prompt if parsing fails.
  - Aggregates successful extractions with `maxTokens` around `16000`.
  - Writes `aggregate/interview-flow.json`, `aggregate/interview-flow.mmd`, and `aggregate/summary.md`.
  - Appends structured JSON lines to `run-log.jsonl`.

  Keep raw transcript text out of log events.

- [ ] **Step 4: Add executable wrapper**

  Create `backend/src/weave/fireflies/interview-flow.ts`:

  ```ts
  import { runCli } from "./interview-flow/cli.js";

  await runCli(process.argv.slice(2));
  ```

- [ ] **Step 5: Run orchestration tests**

  Run:

  ```bash
  pnpm --filter @puddle/backend test -- --run backend/test/fireflies-interview-flow.test.ts
  ```

  Expected: PASS.

- [ ] **Step 6: Commit CLI orchestration**

  ```bash
  git add backend/src/weave/fireflies/interview-flow.ts backend/src/weave/fireflies/interview-flow/cli.ts backend/test/fireflies-interview-flow.test.ts
  git commit -m "Add Fireflies interview flow CLI"
  ```

## Task 5: Verify Build And Run Smoke Tests

**Files:**
- Generated only under `artifacts/interview-flow/`

- [ ] **Step 1: Run backend test suite**

  Run:

  ```bash
  pnpm --filter @puddle/backend test
  ```

  Expected: PASS.

- [ ] **Step 2: Run backend build**

  Run:

  ```bash
  pnpm --filter @puddle/backend build
  ```

  Expected: PASS.

- [ ] **Step 3: Run one-transcript smoke test**

  Run:

  ```bash
  pnpm --filter @puddle/backend interview-flow:run -- --limit 1 --refresh-manifest --output-dir artifacts/interview-flow-smoke-1
  ```

  Expected:

  - `artifacts/interview-flow-smoke-1/extractions/interview_001.json` exists.
  - Extraction validates with `isExtractionOutput`.
  - `artifacts/interview-flow-smoke-1/aggregate/interview-flow.json` exists.

- [ ] **Step 4: Inspect smoke result without exposing transcript text**

  Run:

  ```bash
  jq '{questions:(.question_events | length), stages:(.interview_metadata.overall_interview_structure | length // 0), has_notes:(.quality_notes != null)}' artifacts/interview-flow-smoke-1/extractions/interview_001.json
  ```

  Expected: JSON summary with question count and no raw transcript text.

- [ ] **Step 5: Run three-transcript smoke test**

  Run:

  ```bash
  pnpm --filter @puddle/backend interview-flow:run -- --limit 3 --refresh-manifest --output-dir artifacts/interview-flow-smoke-3
  ```

  Expected:

  - Three validated extraction files exist.
  - Aggregate JSON and Mermaid files exist.
  - `run-log.jsonl` contains no raw transcript text.

- [ ] **Step 6: Run full 50-transcript extraction**

  Run:

  ```bash
  pnpm --filter @puddle/backend interview-flow:run -- --limit 50 --refresh-manifest --output-dir artifacts/interview-flow
  ```

  Expected:

  - Up to 50 validated extraction files exist.
  - Aggregation succeeds over successful extractions.
  - Final files exist under `artifacts/interview-flow/aggregate/`.

- [ ] **Step 7: Report artifact paths and verification summary**

  Summarize:

  - Count of successful extractions.
  - Count of failed extractions, if any.
  - Aggregate JSON path.
  - Mermaid path.
  - Markdown summary path.
  - Tests/build commands run.
