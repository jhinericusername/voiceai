import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildExtractionPrompt,
  buildManifestEntries,
  extractJsonObject,
  firefliesTranscriptToText,
  isAggregateOutput,
  isExtractionOutput,
} from "../src/weave/fireflies/interview-flow/core.js";
import {
  makeBedrockJsonClient,
  makeS3TranscriptClient,
} from "../src/weave/fireflies/interview-flow/aws.js";
import { runInterviewFlow } from "../src/weave/fireflies/interview-flow/cli.js";

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

    expect(prompt).toContain('"transcript_id": "interview_001"');
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

  it("lists transcript keys across paginated S3 responses", async () => {
    const calls: unknown[] = [];
    const s3 = makeS3TranscriptClient({
      send: async (command: unknown) => {
        calls.push(command);
        return calls.length === 1
          ? {
              Contents: [{ Key: "raw/fireflies/a/transcript.json" }],
              NextContinuationToken: "next",
            }
          : { Contents: [{ Key: "raw/fireflies/b/transcript.json" }] };
      },
    });

    await expect(
      s3.listTranscriptKeys({ bucket: "bucket", prefix: "raw/fireflies/" }),
    ).resolves.toEqual([
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

    await expect(readFile(join(outDir, "manifest.json"), "utf8")).resolves.toContain(
      "interview_001",
    );
    await expect(
      readFile(join(outDir, "extractions", "interview_001.json"), "utf8"),
    ).resolves.toContain("question_events");
    await expect(readFile(join(outDir, "aggregate", "interview-flow.mmd"), "utf8"))
      .resolves.toContain("flowchart TD");
  });
});
