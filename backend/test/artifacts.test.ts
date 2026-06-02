import { describe, expect, it } from "vitest";
import {
  expectedRecordingArtifacts,
  recordingArtifactStatusUpdateStatement,
  recordingArtifactUpsertStatement,
  recordingBySessionStatement,
  recordingUpsertStatement,
} from "../src/recordings/repository.js";
import {
  transcriptTurnUpsertStatement,
  transcriptTurnsBySessionStatement,
  validateTranscriptTurn,
} from "../src/transcripts/repository.js";

describe("transcript persistence", () => {
  it("validates transcript turns before persistence", () => {
    expect(
      validateTranscriptTurn({
        sessionId: "sess1",
        turnIndex: 0,
        speaker: "candidate",
        text: "I rebuilt the queue.",
      }),
    ).toEqual({ ok: true });

    const invalid = validateTranscriptTurn({
      sessionId: "sess1",
      turnIndex: -1,
      speaker: "candidate",
      text: "I rebuilt the queue.",
    });
    expect(invalid.ok).toBe(false);
  });

  it("upserts transcript turns by session and turn index", () => {
    const stmt = transcriptTurnUpsertStatement({
      sessionId: "sess1",
      turnIndex: 1,
      speaker: "candidate",
      questionId: "q1",
      text: "I rebuilt the queue.",
      occurredAt: "2026-05-29T10:00:10Z",
      offsetMs: 10_000,
    });

    expect(stmt.sql).toContain("ON CONFLICT (session_id, turn_index)");
    expect(stmt.params).toEqual([
      "sess1",
      1,
      "candidate",
      "q1",
      "I rebuilt the queue.",
      "2026-05-29T10:00:10Z",
      10_000,
      "livekit",
    ]);
  });

  it("queries transcript turns in display order", () => {
    const stmt = transcriptTurnsBySessionStatement("sess1");
    expect(stmt.sql).toContain("ORDER BY turn_index ASC");
    expect(stmt.params).toEqual(["sess1"]);
  });
});

describe("recording persistence", () => {
  it("upserts recording lifecycle state", () => {
    const stmt = recordingUpsertStatement({
      sessionId: "sess1",
      status: "active",
      egressId: "egress1",
      startedAt: "2026-05-29T10:00:00Z",
    });

    expect(stmt.sql).toContain("ON CONFLICT (session_id)");
    expect(stmt.params).toEqual([
      "sess1",
      "egress1",
      "active",
      "2026-05-29T10:00:00Z",
      null,
      null,
    ]);
  });

  it("queries recording lifecycle state by session", () => {
    const stmt = recordingBySessionStatement("sess1");
    expect(stmt.sql).toContain("FROM recordings WHERE session_id = $1");
    expect(stmt.params).toEqual(["sess1"]);
  });

  it("upserts recording artifact metadata", () => {
    const stmt = recordingArtifactUpsertStatement({
      artifactId: "artifact1",
      sessionId: "sess1",
      kind: "composite_video",
      storagePath: "/org1/interviews/sess1/media/composite.mp4",
      contentType: "video/mp4",
      status: "available",
      sizeBytes: 1234,
      durationSeconds: 300,
    });

    expect(stmt.sql).toContain("ON CONFLICT (session_id, kind)");
    expect(stmt.params).toEqual([
      "artifact1",
      "sess1",
      "composite_video",
      "/org1/interviews/sess1/media/composite.mp4",
      "video/mp4",
      "available",
      1234,
      300,
    ]);
  });

  it("updates recording artifact availability from egress webhooks", () => {
    const stmt = recordingArtifactStatusUpdateStatement({
      sessionId: "sess1",
      kind: "composite_video",
      status: "available",
      sizeBytes: 1234,
      durationSeconds: 300,
    });

    expect(stmt.sql).toContain("WHERE session_id = $1 AND kind = $2");
    expect(stmt.params).toEqual([
      "sess1",
      "composite_video",
      "available",
      1234,
      300,
    ]);
  });

  it("builds expected dashboard artifacts from the storage layout", () => {
    const artifacts = expectedRecordingArtifacts("org1", "sess1");
    expect(artifacts.map((artifact) => artifact.kind)).toEqual([
      "composite_video",
      "candidate_video",
      "candidate_audio",
      "agent_audio",
      "transcript",
      "agent_events",
      "media_events",
      "integrity_events",
      "scores",
      "integrity_flags",
    ]);
    expect(artifacts[0]?.storagePath).toBe("/org1/interviews/sess1/media/composite.mp4");
    expect(artifacts[4]?.storagePath).toBe(
      "/org1/interviews/sess1/transcripts/transcript.v1.json",
    );
  });
});
