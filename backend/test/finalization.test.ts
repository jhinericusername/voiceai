import { describe, it, expect, vi } from "vitest";
import { assembleTranscript } from "../src/finalization/transcript.js";
import { buildArtifactManifest } from "../src/finalization/finalize.js";
import {
  buildFinalArtifacts,
  persistFinalArtifacts,
} from "../src/finalization/persist.js";
import { assessmentUpsertStatement } from "../src/assessments/repository.js";
import {
  artifactReadinessBySessionStatement,
  markReviewReadyIfArtifactsAvailable,
  REQUIRED_REVIEW_ARTIFACTS,
  reviewReadyStatusStatement,
  shouldMarkReviewReady,
} from "../src/finalization/reviewReady.js";
import {
  artifactS3Key,
  putJsonArtifact,
  putJsonLinesArtifact,
} from "../src/storage/artifactStore.js";

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

describe("artifactStore", () => {
  it("normalizes leading slashes from storage paths", () => {
    expect(artifactS3Key("/org/interviews/sess/transcripts/transcript.v1.json")).toBe(
      "org/interviews/sess/transcripts/transcript.v1.json",
    );
    expect(artifactS3Key("///org/interviews/sess/assessment/scores.json")).toBe(
      "org/interviews/sess/assessment/scores.json",
    );
    expect(artifactS3Key("org/interviews/sess/events/agent_events.jsonl")).toBe(
      "org/interviews/sess/events/agent_events.jsonl",
    );
  });

  it("writes pretty JSON artifacts with the expected S3 command input", async () => {
    const send = vi.fn(async () => ({}));
    const client = { send };

    await putJsonArtifact(client, {
      bucket: "bucket",
      storagePath: "/org/interviews/sess/assessment/scores.json",
      body: { ok: true },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].input).toEqual({
      Bucket: "bucket",
      Key: "org/interviews/sess/assessment/scores.json",
      Body: '{\n  "ok": true\n}\n',
      ContentType: "application/json",
    });
  });

  it("writes JSON Lines artifacts with newline-delimited rows", async () => {
    const send = vi.fn(async () => ({}));
    const client = { send };

    await putJsonLinesArtifact(client, {
      bucket: "bucket",
      storagePath: "/org/interviews/sess/events/agent_events.jsonl",
      rows: [{ sequence: 0 }, { sequence: 1 }],
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].input).toEqual({
      Bucket: "bucket",
      Key: "org/interviews/sess/events/agent_events.jsonl",
      Body: '{"sequence":0}\n{"sequence":1}\n',
      ContentType: "application/x-ndjson",
    });
  });

  it("writes an empty string for JSON Lines artifacts without rows", async () => {
    const send = vi.fn(async () => ({}));
    const client = { send };

    await putJsonLinesArtifact(client, {
      bucket: "bucket",
      storagePath: "/org/interviews/sess/events/agent_events.jsonl",
      rows: [],
    });

    expect(send.mock.calls[0]?.[0].input.Body).toBe("");
    expect(send.mock.calls[0]?.[0].input.ContentType).toBe("application/x-ndjson");
  });
});

describe("buildFinalArtifacts", () => {
  it("builds final review artifacts from durable rows", () => {
    const artifacts = buildFinalArtifacts({
      session: {
        session_id: "sess1",
        org_id: "org1",
        script_version: "pilot-v1",
      },
      transcriptTurns: [
        {
          session_id: "sess1",
          turn_index: 0,
          speaker: "agent",
          question_id: null,
          text: "Welcome.",
          occurred_at: "2026-06-11T04:16:00.000Z",
          offset_ms: null,
          source: "agent-controller",
        },
      ],
      agentEvents: [
        {
          session_id: "sess1",
          sequence: 0,
          turn_index: 0,
          utterance: "Welcome.",
          reason_code: "INTRO",
          question_id: null,
          category: null,
          missing_element: null,
          occurred_at: new Date("2026-06-11T04:16:01.000Z"),
        },
      ],
      scoreCheckpoints: [
        {
          session_id: "sess1",
          sequence: 0,
          question_id: "q1",
          model: "claude-opus-4-7",
          assessments: [
            {
              category: "technical_depth",
              provisionalScore: 2,
              confidence: 0.6,
              evidenceQuotes: ["Early answer."],
              missingOrAmbiguous: ["specific impact"],
            },
          ],
        },
        {
          session_id: "sess1",
          sequence: 1,
          question_id: "q1",
          model: "claude-opus-4-7",
          assessments: [
            {
              category: "technical_depth",
              provisionalScore: 3,
              confidence: 0.8,
              evidenceQuotes: ["Welcome."],
              missingOrAmbiguous: [],
            },
          ],
        },
      ],
      finalization: {
        completionReason: "completed",
        scriptVersion: "pilot-v1",
        finalTurnCount: 1,
        integrityFlags: ["low_audio_quality"],
        agentEventCount: 1,
        scoreCheckpointCount: 2,
      },
    });

    expect(artifacts.transcript.storagePath).toBe(
      "/org1/interviews/sess1/transcripts/transcript.v1.json",
    );
    expect(artifacts.transcript.body).toEqual({
      version: "v1",
      sessionId: "sess1",
      scriptVersion: "pilot-v1",
      turns: [
        {
          turnIndex: 0,
          speaker: "agent",
          questionId: null,
          text: "Welcome.",
          occurredAt: "2026-06-11T04:16:00.000Z",
          offsetMs: null,
          source: "agent-controller",
        },
      ],
    });
    expect(artifacts.agentEvents.storagePath).toBe(
      "/org1/interviews/sess1/events/agent_events.jsonl",
    );
    expect(artifacts.agentEvents.rows).toEqual([
      {
        sequence: 0,
        turnIndex: 0,
        utterance: "Welcome.",
        reasonCode: "INTRO",
        questionId: null,
        category: null,
        missingElement: null,
        occurredAt: "2026-06-11T04:16:01.000Z",
      },
    ]);
    expect(artifacts.scores.storagePath).toBe(
      "/org1/interviews/sess1/assessment/scores.json",
    );
    expect(artifacts.scores.body).toEqual({
      sessionId: "sess1",
      scriptVersion: "pilot-v1",
      completionReason: "completed",
      categoryScores: [
        {
          category: "technical_depth",
          score: 3,
          confidence: 0.8,
          evidenceQuotes: ["Welcome."],
          missingOrAmbiguous: [],
          questionId: "q1",
          model: "claude-opus-4-7",
        },
      ],
    });
    expect(artifacts.integrityFlags.storagePath).toBe(
      "/org1/interviews/sess1/assessment/integrity_flags.json",
    );
    expect(artifacts.integrityFlags.body).toEqual({
      sessionId: "sess1",
      integrityFlags: ["low_audio_quality"],
    });
  });
});

describe("assessment repository", () => {
  it("upserts assessment rows by session id", () => {
    const categoryScores = [
      {
        category: "technical_depth",
        score: 3,
        confidence: 0.8,
        evidenceQuotes: ["I scaled the ingestion pipeline."],
        rationale: "Clear technical depth.",
        lowConfidence: false,
      },
    ];
    const integrityFlags = ["low_audio_quality"];

    const statement = assessmentUpsertStatement({
      sessionId: "sess1",
      scriptVersion: "pilot-v1",
      categoryScores,
      meetsBareMinimum: true,
      integrityFlags,
    });

    expect(statement.sql).toContain(
      "INSERT INTO assessments (session_id, script_version, category_scores, meets_bare_minimum, integrity_flags)",
    );
    expect(statement.sql).toContain("ON CONFLICT (session_id) DO UPDATE SET");
    expect(statement.params).toEqual([
      "sess1",
      "pilot-v1",
      JSON.stringify([
        {
          category: "technical_depth",
          score: 3,
          confidence: 0.8,
          evidence_quotes: ["I scaled the ingestion pipeline."],
          rationale: "Clear technical depth.",
          low_confidence: false,
        },
      ]),
      true,
      JSON.stringify(integrityFlags),
    ]);
  });
});

describe("persistFinalArtifacts", () => {
  it("loads durable rows, writes final artifacts, upserts assessment, marks artifacts available, and checks readiness", async () => {
    const calls: { sql: string; params: readonly unknown[] }[] = [];
    const pool = {
      query: async (sql: string, params: readonly unknown[]) => {
        calls.push({ sql, params });
        if (sql.includes("FROM sessions")) {
          return {
            rows: [
              {
                session_id: "sess1",
                org_id: "org1",
                script_version: "pilot-v1",
              },
            ],
          };
        }
        if (sql.includes("FROM transcript_turns")) {
          return {
            rows: [
              {
                session_id: "sess1",
                turn_index: 1,
                speaker: "candidate",
                question_id: "q1",
                text: "I scaled the ingestion pipeline.",
                occurred_at: "2026-06-11T04:16:00.000Z",
                offset_ms: 12000,
                source: "deepgram:nova-3",
              },
            ],
          };
        }
        if (sql.includes("FROM agent_events")) {
          return {
            rows: [
              {
                session_id: "sess1",
                sequence: 0,
                turn_index: 0,
                utterance: "Can you explain the tradeoff?",
                reason_code: "PROBE_LOW_CONFIDENCE",
                question_id: "q1",
                category: "technical_depth",
                missing_element: "tradeoff",
                occurred_at: "2026-06-11T04:16:01.000Z",
              },
            ],
          };
        }
        if (sql.includes("FROM score_checkpoints")) {
          return {
            rows: [
              {
                session_id: "sess1",
                sequence: 0,
                question_id: "q1",
                model: "gpt-5",
                assessments: JSON.stringify([
                  {
                    category: "technical_depth",
                    provisionalScore: 3,
                    confidence: 0.8,
                    evidenceQuotes: ["I scaled the ingestion pipeline."],
                    missingOrAmbiguous: [],
                  },
                ]),
              },
            ],
          };
        }
        if (sql.includes("FROM recording_artifacts")) {
          return {
            rows: [
              { kind: "composite_video", status: "available" },
              { kind: "transcript", status: "available" },
              { kind: "scores", status: "available" },
              { kind: "integrity_flags", status: "available" },
              { kind: "agent_events", status: "available" },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const send = vi.fn(async () => ({}));
    const s3Client = { send };

    await persistFinalArtifacts({
      pool,
      sessionId: "sess1",
      bucket: "artifact-bucket",
      s3Client,
      finalization: {
        completionReason: "completed",
        scriptVersion: "pilot-v1",
        finalTurnCount: 1,
        integrityFlags: ["low_audio_quality"],
        agentEventCount: 1,
        scoreCheckpointCount: 1,
      },
    });

    expect(calls.map((call) => call.sql)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("FROM sessions WHERE session_id = $1"),
        expect.stringContaining("FROM transcript_turns WHERE session_id = $1 ORDER BY turn_index ASC"),
        expect.stringContaining("FROM agent_events WHERE session_id = $1 ORDER BY sequence ASC"),
        expect.stringContaining("FROM score_checkpoints WHERE session_id = $1 ORDER BY sequence ASC"),
      ]),
    );
    const orderedFragments = [
      "FROM sessions",
      "FROM transcript_turns",
      "FROM agent_events",
      "FROM score_checkpoints",
      "INSERT INTO assessments",
      "UPDATE recording_artifacts SET status = $3",
      "SELECT kind, status FROM recording_artifacts",
      "UPDATE sessions SET status = $2",
    ];
    const sqls = calls.map((call) => call.sql);
    const indexes = orderedFragments.map((fragment) =>
      sqls.findIndex((sql) => sql.includes(fragment)),
    );
    for (const index of indexes) {
      expect(index).toBeGreaterThanOrEqual(0);
    }
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));

    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls.map(([command]) => command.input)).toEqual([
      expect.objectContaining({
        Bucket: "artifact-bucket",
        Key: "org1/interviews/sess1/transcripts/transcript.v1.json",
        ContentType: "application/json",
      }),
      expect.objectContaining({
        Bucket: "artifact-bucket",
        Key: "org1/interviews/sess1/events/agent_events.jsonl",
        ContentType: "application/x-ndjson",
      }),
      expect.objectContaining({
        Bucket: "artifact-bucket",
        Key: "org1/interviews/sess1/assessment/scores.json",
        ContentType: "application/json",
      }),
      expect.objectContaining({
        Bucket: "artifact-bucket",
        Key: "org1/interviews/sess1/assessment/integrity_flags.json",
        ContentType: "application/json",
      }),
    ]);
    expect(send.mock.calls[2]?.[0].input.Body).toContain(
      '"categoryScores": [',
    );
    expect(send.mock.calls[3]?.[0].input.Body).toContain(
      '"integrityFlags": [',
    );

    const assessmentCall = calls.find((call) =>
      call.sql.includes("INSERT INTO assessments"),
    );
    expect(assessmentCall?.params).toEqual([
      "sess1",
      "pilot-v1",
      JSON.stringify([
        {
          category: "technical_depth",
          score: 3,
          confidence: 0.8,
          evidence_quotes: ["I scaled the ingestion pipeline."],
          rationale: "Generated from final streaming score checkpoint.",
          low_confidence: false,
        },
      ]),
      true,
      JSON.stringify(["low_audio_quality"]),
    ]);

    const artifactUpdateCalls = calls.filter((call) =>
      call.sql.includes("UPDATE recording_artifacts SET status = $3"),
    );
    expect(artifactUpdateCalls.map((call) => call.params.slice(0, 3))).toEqual([
      ["sess1", "transcript", "available"],
      ["sess1", "agent_events", "available"],
      ["sess1", "scores", "available"],
      ["sess1", "integrity_flags", "available"],
    ]);
  });

  it("requires completed finalization scoreCheckpointCount before S3 sends or artifact SQL writes", async () => {
    const calls: { sql: string; params: readonly unknown[] }[] = [];
    const pool = {
      query: async (sql: string, params: readonly unknown[]) => {
        calls.push({ sql, params });
        if (sql.includes("FROM sessions")) {
          return {
            rows: [
              {
                session_id: "sess1",
                org_id: "org1",
                script_version: "pilot-v1",
              },
            ],
          };
        }
        if (sql.includes("FROM transcript_turns")) {
          return {
            rows: [
              {
                session_id: "sess1",
                turn_index: 1,
                speaker: "candidate",
                question_id: "q1",
                text: "I scaled the ingestion pipeline.",
                occurred_at: "2026-06-11T04:16:00.000Z",
                offset_ms: 12000,
                source: "deepgram:nova-3",
              },
            ],
          };
        }
        if (sql.includes("FROM agent_events")) {
          return {
            rows: [
              {
                session_id: "sess1",
                sequence: 0,
                turn_index: 0,
                utterance: "Can you explain the tradeoff?",
                reason_code: "PROBE_LOW_CONFIDENCE",
                question_id: "q1",
                category: "technical_depth",
                missing_element: "tradeoff",
                occurred_at: "2026-06-11T04:16:01.000Z",
              },
            ],
          };
        }
        if (sql.includes("FROM score_checkpoints")) {
          return {
            rows: [
              {
                session_id: "sess1",
                sequence: 0,
                question_id: "q1",
                model: "gpt-5",
                assessments: [],
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    const send = vi.fn(async () => ({}));
    const s3Client = { send };

    await expect(
      persistFinalArtifacts({
        pool,
        sessionId: "sess1",
        bucket: "artifact-bucket",
        s3Client,
        finalization: {
          completionReason: "completed",
          scriptVersion: "pilot-v1",
          finalTurnCount: 1,
          integrityFlags: [],
          agentEventCount: 1,
        },
      }),
    ).rejects.toThrow(/scoreCheckpointCount/);

    expect(send).not.toHaveBeenCalled();
    expect(calls.map((call) => call.sql)).toEqual([
      expect.stringContaining("FROM sessions WHERE session_id = $1"),
      expect.stringContaining("FROM transcript_turns WHERE session_id = $1 ORDER BY turn_index ASC"),
      expect.stringContaining("FROM agent_events WHERE session_id = $1 ORDER BY sequence ASC"),
      expect.stringContaining("FROM score_checkpoints WHERE session_id = $1 ORDER BY sequence ASC"),
    ]);
    expect(calls.some((call) => /INSERT|UPDATE/i.test(call.sql))).toBe(false);
    expect(calls.some((call) => call.sql.includes("FROM recording_artifacts"))).toBe(
      false,
    );
  });

  it.each([
    {
      name: "finalTurnCount",
      finalization: {
        completionReason: "completed",
        scriptVersion: "pilot-v1",
        finalTurnCount: 2,
        integrityFlags: [],
        agentEventCount: 1,
        scoreCheckpointCount: 1,
      },
      expectedError: /finalTurnCount/,
    },
    {
      name: "agentEventCount",
      finalization: {
        completionReason: "completed",
        scriptVersion: "pilot-v1",
        finalTurnCount: 1,
        integrityFlags: [],
        agentEventCount: 2,
        scoreCheckpointCount: 1,
      },
      expectedError: /agentEventCount/,
    },
    {
      name: "scoreCheckpointCount",
      finalization: {
        completionReason: "completed",
        scriptVersion: "pilot-v1",
        finalTurnCount: 1,
        integrityFlags: [],
        agentEventCount: 1,
        scoreCheckpointCount: 2,
      },
      expectedError: /scoreCheckpointCount/,
    },
  ])(
    "rejects a $name mismatch before S3 sends or artifact SQL writes",
    async ({ finalization, expectedError }) => {
      const calls: { sql: string; params: readonly unknown[] }[] = [];
      const pool = {
        query: async (sql: string, params: readonly unknown[]) => {
          calls.push({ sql, params });
          if (sql.includes("FROM sessions")) {
            return {
              rows: [
                {
                  session_id: "sess1",
                  org_id: "org1",
                  script_version: "pilot-v1",
                },
              ],
            };
          }
          if (sql.includes("FROM transcript_turns")) {
            return {
              rows: [
                {
                  session_id: "sess1",
                  turn_index: 1,
                  speaker: "candidate",
                  question_id: "q1",
                  text: "I scaled the ingestion pipeline.",
                  occurred_at: "2026-06-11T04:16:00.000Z",
                  offset_ms: 12000,
                  source: "deepgram:nova-3",
                },
              ],
            };
          }
          if (sql.includes("FROM agent_events")) {
            return {
              rows: [
                {
                  session_id: "sess1",
                  sequence: 0,
                  turn_index: 0,
                  utterance: "Can you explain the tradeoff?",
                  reason_code: "PROBE_LOW_CONFIDENCE",
                  question_id: "q1",
                  category: "technical_depth",
                  missing_element: "tradeoff",
                  occurred_at: "2026-06-11T04:16:01.000Z",
                },
              ],
            };
          }
          if (sql.includes("FROM score_checkpoints")) {
            return {
              rows: [
                {
                  session_id: "sess1",
                  sequence: 0,
                  question_id: "q1",
                  model: "gpt-5",
                  assessments: [],
                },
              ],
            };
          }
          return { rows: [] };
        },
      };
      const send = vi.fn(async () => ({}));
      const s3Client = { send };

      await expect(
        persistFinalArtifacts({
          pool,
          sessionId: "sess1",
          bucket: "artifact-bucket",
          s3Client,
          finalization,
        }),
      ).rejects.toThrow(expectedError);

      expect(send).not.toHaveBeenCalled();
      expect(calls.map((call) => call.sql)).toEqual([
        expect.stringContaining("FROM sessions WHERE session_id = $1"),
        expect.stringContaining("FROM transcript_turns WHERE session_id = $1 ORDER BY turn_index ASC"),
        expect.stringContaining("FROM agent_events WHERE session_id = $1 ORDER BY sequence ASC"),
        expect.stringContaining("FROM score_checkpoints WHERE session_id = $1 ORDER BY sequence ASC"),
      ]);
      expect(calls.some((call) => /INSERT|UPDATE/i.test(call.sql))).toBe(false);
      expect(
        calls.some((call) => call.sql.includes("FROM recording_artifacts")),
      ).toBe(false);
    },
  );
});

describe("review readiness", () => {
  it("requires the composite, transcript, scores, integrity flags, and agent events artifacts", () => {
    expect(REQUIRED_REVIEW_ARTIFACTS).toEqual([
      "composite_video",
      "transcript",
      "scores",
      "integrity_flags",
      "agent_events",
    ]);
  });

  it("marks review ready only when every required artifact is available", () => {
    expect(
      shouldMarkReviewReady([
        { kind: "composite_video", status: "available" },
        { kind: "transcript", status: "available" },
        { kind: "scores", status: "available" },
        { kind: "integrity_flags", status: "available" },
        { kind: "agent_events", status: "available" },
      ]),
    ).toBe(true);
  });

  it("does not mark review ready when a required artifact is missing or failed", () => {
    expect(
      shouldMarkReviewReady([
        { kind: "composite_video", status: "available" },
        { kind: "transcript", status: "available" },
        { kind: "scores", status: "available" },
        { kind: "integrity_flags", status: "available" },
      ]),
    ).toBe(false);

    expect(
      shouldMarkReviewReady([
        { kind: "composite_video", status: "failed" },
        { kind: "transcript", status: "available" },
        { kind: "scores", status: "available" },
        { kind: "integrity_flags", status: "available" },
        { kind: "agent_events", status: "available" },
      ]),
    ).toBe(false);
  });

  it("builds an artifact readiness select for a session", () => {
    expect(artifactReadinessBySessionStatement("sess1")).toEqual({
      sql:
        "SELECT kind, status FROM recording_artifacts " +
        "WHERE session_id = $1 AND kind = ANY($2::text[])",
      params: ["sess1", REQUIRED_REVIEW_ARTIFACTS],
    });
  });

  it("builds a review-ready session status update", () => {
    expect(reviewReadyStatusStatement("sess1")).toEqual({
      sql:
        "UPDATE sessions SET status = $2, " +
        "started_at = COALESCE($3::timestamptz, started_at), " +
        "ended_at = COALESCE($4::timestamptz, ended_at), updated_at = now() " +
        "WHERE session_id = $1 AND status = 'recording_finalizing'",
      params: ["sess1", "review_ready", null, null],
    });
  });

  it("queries artifact readiness and updates review_ready when all required artifacts are available", async () => {
    const calls: { sql: string; params: readonly unknown[] }[] = [];
    const pool = {
      query: async (sql: string, params: readonly unknown[]) => {
        calls.push({ sql, params });
        return {
          rows: [
            { kind: "composite_video", status: "available" },
            { kind: "transcript", status: "available" },
            { kind: "scores", status: "available" },
            { kind: "integrity_flags", status: "available" },
            { kind: "agent_events", status: "available" },
          ],
        };
      },
    };

    await expect(markReviewReadyIfArtifactsAvailable("sess1", pool)).resolves.toBe(
      true,
    );

    expect(calls).toEqual([
      {
        sql:
          "SELECT kind, status FROM recording_artifacts " +
          "WHERE session_id = $1 AND kind = ANY($2::text[])",
        params: ["sess1", REQUIRED_REVIEW_ARTIFACTS],
      },
      {
        sql:
          "UPDATE sessions SET status = $2, " +
          "started_at = COALESCE($3::timestamptz, started_at), " +
          "ended_at = COALESCE($4::timestamptz, ended_at), updated_at = now() " +
          "WHERE session_id = $1 AND status = 'recording_finalizing'",
        params: ["sess1", "review_ready", null, null],
      },
    ]);
  });

  it("queries artifact readiness without updating review_ready when composite failed", async () => {
    const calls: { sql: string; params: readonly unknown[] }[] = [];
    const pool = {
      query: async (sql: string, params: readonly unknown[]) => {
        calls.push({ sql, params });
        return {
          rows: [
            { kind: "composite_video", status: "failed" },
            { kind: "transcript", status: "available" },
            { kind: "scores", status: "available" },
            { kind: "integrity_flags", status: "available" },
            { kind: "agent_events", status: "available" },
          ],
        };
      },
    };

    await expect(markReviewReadyIfArtifactsAvailable("sess1", pool)).resolves.toBe(
      false,
    );

    expect(calls).toEqual([
      {
        sql:
          "SELECT kind, status FROM recording_artifacts " +
          "WHERE session_id = $1 AND kind = ANY($2::text[])",
        params: ["sess1", REQUIRED_REVIEW_ARTIFACTS],
      },
    ]);
  });
});
