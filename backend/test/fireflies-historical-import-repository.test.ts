import { describe, expect, it } from "vitest";
import {
  historicalImportRunFinishStatement,
  historicalImportRunInsertStatement,
  historicalRecordingArtifactUpsertStatement,
  historicalRecordingUpsertStatement,
  historicalSessionUpsertStatement,
  historicalTranscriptTurnUpsertStatement,
} from "../src/weave/fireflies/historicalImportRepository.js";

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function sourceMetadata() {
  return {
    fireflies: {
      transcriptId: "01ABC",
      ownerEmail: "owner@example.com",
      meetingDate: "2026-04-09",
      sourceBucket: "weave-fireflies-raw",
      sourcePrefix: "raw/fireflies/transcript_id=01ABC/",
      targetBucket: "puddle-artifacts",
      matchStatus: "matched",
      audioKey: "raw/fireflies/transcript_id=01ABC/audio.mp3",
      videoKey: "raw/fireflies/transcript_id=01ABC/video.mp4",
      transcriptKey: "raw/fireflies/transcript_id=01ABC/transcript.json",
      metadataKey: "raw/fireflies/transcript_id=01ABC/metadata.json",
      summaryKey: "raw/fireflies/transcript_id=01ABC/summary.json",
      ingestionResultKey: "raw/fireflies/transcript_id=01ABC/ingestion-result.json",
    },
    ashby: {
      selected: {
        candidateId: "cand_123",
        applicationId: "app_123",
        jobId: "job_123",
        candidateEvaluationId: "eval_123",
        decisionSource: "manual",
        decisionReason: ["selected in reconciliation table"],
        decidedAt: "2026-04-10T12:00:00.000Z",
      },
      matchCandidates: [
        {
          rank: 1,
          score: 96,
          candidateId: "cand_123",
          applicationId: "app_123",
          jobId: "job_123",
          candidateEvaluationId: "eval_123",
          matchedEmail: "candidate@example.com",
          dateDeltaDays: 0,
          stageDeltaDays: 0,
          stageTitles: ["Technical Interview"],
          applicationActiveOnMeetingDate: true,
          activeApplicationCount: 1,
          reasons: ["email match"],
        },
      ],
    },
    summary: { overview: "Useful interview." },
    ingestion: { status: "ok" },
  };
}

describe("Fireflies historical import repository", () => {
  it("upserts sessions without overwriting manually advanced statuses", () => {
    const metadata = sourceMetadata();
    const stmt = historicalSessionUpsertStatement({
      sessionId: "hist_fireflies_01ABC",
      orgId: "org_123",
      candidateEmail: "candidate@example.com",
      scriptVersion: "fireflies-historical-v1",
      status: "review_ready",
      scheduledAt: "2026-04-09T15:30:00.000Z",
      roomName: "fireflies-01ABC",
      startedAt: "2026-04-09T15:30:00.000Z",
      endedAt: "2026-04-09T16:00:00.000Z",
      externalSource: "fireflies",
      externalId: "01ABC",
      sourceMetadata: metadata,
    });

    const sql = compactSql(stmt.sql);

    expect(sql).toContain(
      "INSERT INTO sessions (session_id, org_id, candidate_email, script_version, status, scheduled_at, room_name, started_at, ended_at, external_source, external_id, source_metadata)",
    );
    expect(sql).toContain("VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)");
    expect(sql).toContain(
      "status = CASE WHEN sessions.status IN ('scheduled', 'in_progress', 'recording_finalizing', 'review_ready') THEN EXCLUDED.status ELSE sessions.status END",
    );
    expect(sql).toContain("source_metadata = EXCLUDED.source_metadata");
    expect(sql).toContain("RETURNING session_id");
    expect(stmt.params).toEqual([
      "hist_fireflies_01ABC",
      "org_123",
      "candidate@example.com",
      "fireflies-historical-v1",
      "review_ready",
      "2026-04-09T15:30:00.000Z",
      "fireflies-01ABC",
      "2026-04-09T15:30:00.000Z",
      "2026-04-09T16:00:00.000Z",
      "fireflies",
      "01ABC",
      JSON.stringify(metadata),
    ]);
  });

  it("serializes full planner source metadata once for jsonb persistence", () => {
    const metadata = sourceMetadata();
    const stmt = historicalSessionUpsertStatement({
      sessionId: "hist_fireflies_01ABC",
      orgId: "org_123",
      candidateEmail: "candidate@example.com",
      scriptVersion: "fireflies-historical-v1",
      status: "review_ready",
      scheduledAt: null,
      roomName: "fireflies-01ABC",
      startedAt: null,
      endedAt: null,
      externalSource: "fireflies",
      externalId: "01ABC",
      sourceMetadata: metadata,
    });

    expect(compactSql(stmt.sql)).toContain("$12::jsonb");
    expect(typeof stmt.params[11]).toBe("string");

    const parsed = JSON.parse(stmt.params[11] as string);

    expect(typeof parsed).toBe("object");
    expect(typeof parsed.ashby).toBe("object");
    expect(typeof parsed.ashby.selected).toBe("object");
    expect(parsed.ashby.selected.applicationId).toBe("app_123");
    expect(parsed.ashby.matchCandidates[0].applicationId).toBe("app_123");
    expect(parsed.fireflies.sourceBucket).toBe("weave-fireflies-raw");
    expect(parsed.fireflies.sourcePrefix).toBe("raw/fireflies/transcript_id=01ABC/");
  });

  it("upserts sessions by external source and id instead of email", () => {
    const stmt = historicalSessionUpsertStatement({
      sessionId: "hist_fireflies_01ABC",
      orgId: "org_123",
      candidateEmail: "candidate@example.com",
      scriptVersion: "fireflies-historical-v1",
      status: "review_ready",
      scheduledAt: null,
      roomName: "fireflies-01ABC",
      startedAt: null,
      endedAt: null,
      externalSource: "fireflies",
      externalId: "01ABC",
      sourceMetadata: sourceMetadata(),
    });

    const sql = compactSql(stmt.sql);

    expect(sql).toContain("ON CONFLICT (external_source, external_id)");
    expect(sql).toContain("WHERE external_source IS NOT NULL AND external_id IS NOT NULL");
    expect(sql).not.toContain("ON CONFLICT (candidate_email)");
    expect(sql).not.toContain("ON CONFLICT (org_id, candidate_email)");
  });

  it("refuses to update an existing imported session owned by a different org", () => {
    const stmt = historicalSessionUpsertStatement({
      sessionId: "hist_fireflies_01ABC",
      orgId: "org_123",
      candidateEmail: "candidate@example.com",
      scriptVersion: "fireflies-historical-v1",
      status: "review_ready",
      scheduledAt: null,
      roomName: "fireflies-01ABC",
      startedAt: null,
      endedAt: null,
      externalSource: "fireflies",
      externalId: "01ABC",
      sourceMetadata: sourceMetadata(),
    });

    const sql = compactSql(stmt.sql);

    expect(sql).toContain("ON CONFLICT (external_source, external_id)");
    expect(sql).toContain("WHERE sessions.org_id = EXCLUDED.org_id RETURNING session_id");
    expect(sql).not.toContain("org_id = EXCLUDED.org_id, candidate_email");
  });

  it("upserts historical recordings by session", () => {
    const stmt = historicalRecordingUpsertStatement({
      sessionId: "hist_fireflies_01ABC",
      egressId: "fireflies:01ABC",
      status: "complete",
      startedAt: "2026-04-09T15:30:00.000Z",
      endedAt: "2026-04-09T16:00:00.000Z",
      errorMessage: null,
    });

    const sql = compactSql(stmt.sql);

    expect(sql).toContain(
      "INSERT INTO recordings (session_id, egress_id, status, started_at, ended_at, error_message)",
    );
    expect(sql).toContain("ON CONFLICT (session_id) DO UPDATE SET");
    expect(sql).toContain("egress_id = EXCLUDED.egress_id");
    expect(sql).toContain("updated_at = now()");
    expect(stmt.params).toEqual([
      "hist_fireflies_01ABC",
      "fireflies:01ABC",
      "complete",
      "2026-04-09T15:30:00.000Z",
      "2026-04-09T16:00:00.000Z",
      null,
    ]);
  });

  it("upserts historical recording artifacts by session and kind with deterministic ids", () => {
    const stmt = historicalRecordingArtifactUpsertStatement({
      artifactId: "hist_fireflies_01ABC_composite_video",
      sessionId: "hist_fireflies_01ABC",
      kind: "composite_video",
      storagePath: "/org_123/interviews/hist_fireflies_01ABC/media/composite.mp4",
      contentType: "video/mp4",
      status: "available",
      sizeBytes: 1234,
      durationSeconds: 1800.5,
    });

    const sql = compactSql(stmt.sql);

    expect(sql).toContain(
      "INSERT INTO recording_artifacts (artifact_id, session_id, kind, storage_path, content_type, status, size_bytes, duration_seconds)",
    );
    expect(sql).toContain("ON CONFLICT (session_id, kind) DO UPDATE SET");
    expect(sql).toContain("artifact_id = EXCLUDED.artifact_id");
    expect(stmt.params).toEqual([
      "hist_fireflies_01ABC_composite_video",
      "hist_fireflies_01ABC",
      "composite_video",
      "/org_123/interviews/hist_fireflies_01ABC/media/composite.mp4",
      "video/mp4",
      "available",
      1234,
      1800.5,
    ]);
  });

  it("upserts historical transcript turns by session and turn index", () => {
    const stmt = historicalTranscriptTurnUpsertStatement({
      sessionId: "hist_fireflies_01ABC",
      turnIndex: 1,
      speaker: "candidate",
      questionId: null,
      text: "I build developer tools.",
      offsetMs: 8250,
      source: "fireflies",
    });

    const sql = compactSql(stmt.sql);

    expect(sql).toContain(
      "INSERT INTO transcript_turns (session_id, turn_index, speaker, question_id, text, occurred_at, offset_ms, source)",
    );
    expect(sql).toContain("VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7, $8)");
    expect(sql).toContain("ON CONFLICT (session_id, turn_index) DO UPDATE SET");
    expect(sql).toContain("source = EXCLUDED.source");
    expect(stmt.params).toEqual([
      "hist_fireflies_01ABC",
      1,
      "candidate",
      null,
      "I build developer tools.",
      null,
      8250,
      "fireflies",
    ]);
  });

  it("inserts or updates historical import run metadata", () => {
    const summary = { planned: 3, mode: "apply" };
    const stmt = historicalImportRunInsertStatement({
      importRunId: "run_123",
      source: "fireflies",
      orgId: "org_123",
      sourceBucket: "weave-fireflies-raw",
      sourcePrefix: "raw/fireflies/",
      targetBucket: "puddle-artifacts",
      mode: "apply",
      plannedCount: 3,
      summary,
    });

    const sql = compactSql(stmt.sql);

    expect(sql).toContain(
      "INSERT INTO historical_interview_import_runs (import_run_id, source, org_id, source_bucket, source_prefix, target_bucket, mode, planned_count, summary)",
    );
    expect(sql).toContain("VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)");
    expect(sql).toContain("ON CONFLICT (import_run_id) DO UPDATE SET");
    expect(sql).toContain("planned_count = EXCLUDED.planned_count");
    expect(sql).toContain("summary = EXCLUDED.summary");
    expect(stmt.params).toEqual([
      "run_123",
      "fireflies",
      "org_123",
      "weave-fireflies-raw",
      "raw/fireflies/",
      "puddle-artifacts",
      "apply",
      3,
      JSON.stringify(summary),
    ]);
  });

  it("finishes historical import runs with final counts and summary", () => {
    const summary = { imported: 2, failed: 1 };
    const stmt = historicalImportRunFinishStatement({
      importRunId: "run_123",
      importedCount: 2,
      skippedCount: 0,
      failedCount: 1,
      summary,
    });

    const sql = compactSql(stmt.sql);

    expect(sql).toContain("UPDATE historical_interview_import_runs SET");
    expect(sql).toContain("finished_at = now()");
    expect(sql).toContain("imported_count = $1");
    expect(sql).toContain("WHERE import_run_id = $5");
    expect(stmt.params).toEqual([
      2,
      0,
      1,
      JSON.stringify(summary),
      "run_123",
    ]);
  });
});
