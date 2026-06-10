import { describe, it, expect } from "vitest";
import { assembleTranscript } from "../src/finalization/transcript.js";
import { buildArtifactManifest } from "../src/finalization/finalize.js";
import {
  REQUIRED_REVIEW_ARTIFACTS,
  markSessionReviewReadyIfComplete,
  reviewReadyArtifactStatusesStatement,
  sessionReviewReadyStatement,
  shouldMarkReviewReady,
  type ArtifactStatusRow,
} from "../src/finalization/reviewReady.js";

describe("assembleTranscript", () => {
  it("builds a question-aligned diarized transcript", () => {
    const transcript = assembleTranscript([
      { turnIndex: 0, speaker: "agent", text: "Tell me about a hard problem.", questionId: "q1" },
      { turnIndex: 1, speaker: "candidate", text: "I rewrote the scheduler.", questionId: "q1" },
      { turnIndex: 2, speaker: "agent", text: "What was the impact?", questionId: "q1" },
      { turnIndex: 3, speaker: "candidate", text: "Cut latency in half.", questionId: "q1" },
    ]);
    expect(transcript.version).toBe("v1");
    expect(transcript.byQuestion.q1).toHaveLength(4);
    expect(transcript.byQuestion.q1[0].speaker).toBe("agent");
  });

  it("groups turns under their question id", () => {
    const transcript = assembleTranscript([
      { turnIndex: 0, speaker: "agent", text: "q1 text", questionId: "q1" },
      { turnIndex: 1, speaker: "candidate", text: "a1", questionId: "q1" },
      { turnIndex: 2, speaker: "agent", text: "q2 text", questionId: "q2" },
      { turnIndex: 3, speaker: "candidate", text: "a2", questionId: "q2" },
    ]);
    expect(Object.keys(transcript.byQuestion)).toEqual(["q1", "q2"]);
    expect(transcript.byQuestion.q2[1].text).toBe("a2");
  });
});

describe("buildArtifactManifest", () => {
  it("lists every expected artifact path for the session", () => {
    const manifest = buildArtifactManifest("org1", "sess1");
    expect(manifest.transcript).toBe(
      "/org1/interviews/sess1/transcripts/transcript.v1.json",
    );
    expect(manifest.scores).toBe("/org1/interviews/sess1/assessment/scores.json");
    expect(manifest.composite).toBe("/org1/interviews/sess1/media/composite.mp4");
    expect(manifest.agentEvents).toBe(
      "/org1/interviews/sess1/events/agent_events.jsonl",
    );
    expect(manifest.integrityEvents).toBe(
      "/org1/interviews/sess1/events/integrity_events.jsonl",
    );
  });
});

describe("review-ready gate", () => {
  it("requires composite, transcript, scores, integrity flags, and agent events", () => {
    expect(REQUIRED_REVIEW_ARTIFACTS).toEqual([
      "composite_video",
      "transcript",
      "scores",
      "integrity_flags",
      "agent_events",
    ]);
  });

  it("does not require separate raw participant media for MVP review readiness", () => {
    expect(
      shouldMarkReviewReady([
        { kind: "composite_video", status: "available" },
        { kind: "transcript", status: "available" },
        { kind: "scores", status: "available" },
        { kind: "integrity_flags", status: "available" },
        { kind: "agent_events", status: "available" },
        { kind: "candidate_audio", status: "expected" },
        { kind: "agent_audio", status: "expected" },
        { kind: "candidate_video", status: "expected" },
      ]),
    ).toBe(true);
  });

  it("keeps the session out of review when a required artifact is missing", () => {
    expect(
      shouldMarkReviewReady([
        { kind: "composite_video", status: "available" },
        { kind: "transcript", status: "available" },
        { kind: "scores", status: "available" },
        { kind: "integrity_flags", status: "available" },
      ]),
    ).toBe(false);
  });

  it("builds the artifact status query", () => {
    const stmt = reviewReadyArtifactStatusesStatement("sess1");
    expect(stmt.sql).toContain("FROM recording_artifacts");
    expect(stmt.params).toEqual(["sess1", REQUIRED_REVIEW_ARTIFACTS]);
  });

  it("builds the review-ready session update", () => {
    const stmt = sessionReviewReadyStatement("sess1");
    expect(stmt.sql).toContain("UPDATE sessions SET status = $2");
    expect(stmt.params).toEqual(["sess1", "review_ready"]);
  });

  it("does not update the session when required artifacts are incomplete", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return {
          rows: [
            { kind: "composite_video", status: "available" },
            { kind: "transcript", status: "available" },
          ] satisfies ArtifactStatusRow[],
        };
      },
    };

    await expect(markSessionReviewReadyIfComplete(pool, "sess1")).resolves.toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("FROM recording_artifacts");
    expect(calls[0].params).toEqual(["sess1", REQUIRED_REVIEW_ARTIFACTS]);
  });

  it("updates the session when all required artifacts are available", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        if (calls.length === 1) {
          return {
            rows: REQUIRED_REVIEW_ARTIFACTS.map((kind) => ({
              kind,
              status: "available",
            })) satisfies ArtifactStatusRow[],
          };
        }
        return { rows: [] };
      },
    };

    await expect(markSessionReviewReadyIfComplete(pool, "sess1")).resolves.toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].params).toEqual(["sess1", REQUIRED_REVIEW_ARTIFACTS]);
    expect(calls[1].sql).toContain("UPDATE sessions SET status = $2");
    expect(calls[1].params).toEqual(["sess1", "review_ready"]);
  });
});
