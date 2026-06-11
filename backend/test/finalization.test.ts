import { describe, it, expect, vi } from "vitest";
import { assembleTranscript } from "../src/finalization/transcript.js";
import { buildArtifactManifest } from "../src/finalization/finalize.js";
import {
  buildFinalizationArtifacts,
  persistFinalizedInterview,
  type FinalizedInterviewInput,
} from "../src/finalization/persist.js";
import { finalizationSessionStatement } from "../src/finalization/routes.js";
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

  it("groups missing, blank, and prototype-like question ids safely", () => {
    const transcript = assembleTranscript([
      { turnIndex: 0, speaker: "agent", text: "intro", questionId: null },
      { turnIndex: 1, speaker: "candidate", text: "blank", questionId: "   " },
      { turnIndex: 2, speaker: "candidate", text: "special", questionId: "__proto__" },
    ]);

    expect(transcript.byQuestion.unassigned).toHaveLength(2);
    expect(transcript.byQuestion.__proto__[0].text).toBe("special");
  });
});

describe("finalized interview artifact payload", () => {
  const finalized: FinalizedInterviewInput = {
    sessionId: "sess1",
    orgId: "org1",
    scriptVersion: "pilot-v1",
    transcriptTurns: [
      {
        turnIndex: 0,
        speaker: "agent",
        questionId: null,
        text: "Thanks for joining.",
      },
      {
        turnIndex: 1,
        speaker: "candidate",
        questionId: "q1",
        text: "I owned the rollout.",
      },
    ],
    assessment: {
      categoryScores: [
        {
          category: "agency",
          score: 4,
          confidence: 0.9,
          evidenceQuotes: ["I owned the rollout."],
          rationale: "Clear ownership.",
          lowConfidence: false,
        },
      ],
      meetsBareMinimum: true,
      integrityFlags: [],
    },
    agentEvents: [
      {
        session_id: "sess1",
        utterance: "Thanks for joining.",
        reason_code: "INTRO",
        question_id: null,
        category: null,
        missing_element: null,
      },
    ],
  };

  it("builds transcript, scores, integrity flags, and agent event artifacts", () => {
    const artifacts = buildFinalizationArtifacts(finalized);

    expect(artifacts.transcript.storagePath).toBe(
      "/org1/interviews/sess1/transcripts/transcript.v1.json",
    );
    expect(artifacts.transcript.body).toEqual({
      version: "v1",
      turns: finalized.transcriptTurns,
      byQuestion: {
        unassigned: [finalized.transcriptTurns[0]],
        q1: [finalized.transcriptTurns[1]],
      },
    });
    expect(artifacts.scores.storagePath).toBe(
      "/org1/interviews/sess1/assessment/scores.json",
    );
    expect(artifacts.integrityFlags.body).toEqual([]);
    expect(artifacts.agentEvents.rows).toEqual(finalized.agentEvents);
  });

  it("persists the packet and marks finalized artifacts available", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes("SELECT kind, status FROM recording_artifacts")) {
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
    const s3 = { send: vi.fn(async () => ({})) };

    await persistFinalizedInterview(pool, s3, "puddle-artifacts", finalized);

    expect(queries.some((query) => query.sql.includes("INSERT INTO transcript_turns"))).toBe(
      true,
    );
    expect(queries.some((query) => query.sql.includes("INSERT INTO assessments"))).toBe(
      true,
    );
    expect(s3.send).toHaveBeenCalledTimes(4);

    const artifactUpserts = queries.filter((query) =>
      query.sql.includes("INSERT INTO recording_artifacts"),
    );
    expect(artifactUpserts).toHaveLength(4);
    expect(artifactUpserts.map((query) => query.params[5])).toEqual([
      "available",
      "available",
      "available",
      "available",
    ]);
    expect(
      queries.some((query) => query.sql.includes("UPDATE recording_artifacts")),
    ).toBe(false);
    expect(queries.at(-1)?.sql).toContain("UPDATE sessions SET status = $2");
    expect(queries.at(-1)?.params).toEqual(["sess1", "review_ready"]);
  });
});

describe("finalization route helpers", () => {
  it("builds the authoritative session lookup", () => {
    const stmt = finalizationSessionStatement("sess1");

    expect(stmt.sql).toContain("SELECT session_id, org_id, script_version FROM sessions");
    expect(stmt.sql).toContain("WHERE session_id = $1");
    expect(stmt.params).toEqual(["sess1"]);
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
