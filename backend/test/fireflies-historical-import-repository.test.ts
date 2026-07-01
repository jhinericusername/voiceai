import { describe, expect, it } from "vitest";
import {
  historicalFirefliesMetadataBackfillRowsStatement,
  historicalFirefliesRecordingMetadataBackfillStatement,
  historicalFirefliesSessionMetadataBackfillStatement,
  historicalImportRunFinishStatement,
  historicalImportRunInsertStatement,
  historicalRecordingArtifactUpsertStatement,
  historicalRecordingUpsertStatement,
  historicalSessionLegacyIdentityReconcileStatement,
  historicalSessionSourceLookupStatement,
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
      sourceOccurrenceId:
        "0444c421572bcea553229ae76b6bc1a135225a566f3fdf9d721b53874bd99095",
      ownerEmail: "owner@example.com",
      meetingDate: "2026-04-09",
      meetingStartedAt: "2026-04-09T15:30:00.000Z",
      meetingStartedAtSource: "metadata",
      dateOnlyStartedAt: null,
      dateOnlyStartedAtSource: null,
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
    expect(parsed.fireflies.sourceOccurrenceId).toBe(
      "0444c421572bcea553229ae76b6bc1a135225a566f3fdf9d721b53874bd99095",
    );
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

  it("guards session conflict updates to the same org without updating org_id", () => {
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
    const updateClause = sql.slice(
      sql.indexOf("DO UPDATE SET"),
      sql.indexOf(" WHERE sessions.org_id"),
    );

    expect(updateClause).not.toContain("org_id = EXCLUDED.org_id");
    expect(sql).toContain("DO UPDATE SET");
    expect(sql).toContain("WHERE sessions.org_id = EXCLUDED.org_id RETURNING session_id");
  });

  it("looks up current and legacy Fireflies source identities before apply copies", () => {
    const stmt = historicalSessionSourceLookupStatement({
      externalSource: "fireflies",
      occurrenceExternalId:
        "0444c421572bcea553229ae76b6bc1a135225a566f3fdf9d721b53874bd99095",
      legacyExternalId: "01ABC",
    });

    const sql = compactSql(stmt.sql);

    expect(sql).toContain("SELECT session_id, org_id, external_id, source_metadata");
    expect(sql).toContain("FROM sessions");
    expect(sql).toContain("WHERE external_source = $1");
    expect(sql).toContain("external_id = ANY($2::text[])");
    expect(sql).toContain("ORDER BY CASE external_id WHEN $3 THEN 0 WHEN $4 THEN 1 ELSE 2 END");
    expect(stmt.params).toEqual([
      "fireflies",
      ["0444c421572bcea553229ae76b6bc1a135225a566f3fdf9d721b53874bd99095", "01ABC"],
      "0444c421572bcea553229ae76b6bc1a135225a566f3fdf9d721b53874bd99095",
      "01ABC",
    ]);
  });

  it("reconciles same-org legacy transcript identity to the occurrence external id", () => {
    const metadata = sourceMetadata();
    const stmt = historicalSessionLegacyIdentityReconcileStatement({
      externalSource: "fireflies",
      legacyExternalId: "01ABC",
      occurrenceExternalId:
        "0444c421572bcea553229ae76b6bc1a135225a566f3fdf9d721b53874bd99095",
      orgId: "org_123",
      sourceMetadata: metadata,
    });

    const sql = compactSql(stmt.sql);

    expect(sql).toContain("UPDATE sessions SET external_id = $3");
    expect(sql).toContain("source_metadata = $4::jsonb");
    expect(sql).toContain("WHERE external_source = $1 AND external_id = $2 AND org_id = $5");
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("existing.external_source = $1");
    expect(sql).toContain("existing.external_id = $3");
    expect(sql).toContain("RETURNING session_id, org_id, external_id");
    expect(stmt.params).toEqual([
      "fireflies",
      "01ABC",
      "0444c421572bcea553229ae76b6bc1a135225a566f3fdf9d721b53874bd99095",
      JSON.stringify(metadata),
      "org_123",
    ]);
  });

  it("selects historical Fireflies sessions eligible for metadata backfill", () => {
    const stmt = historicalFirefliesMetadataBackfillRowsStatement({
      orgId: "org_123",
      sourceBucket: "weave-fireflies-raw",
      sourcePrefix: "raw/fireflies/",
      limit: 50,
    });

    const sql = compactSql(stmt.sql);

    expect(sql).toContain("SELECT s.session_id, s.org_id, s.room_name");
    expect(sql).toContain("s.source_metadata, r.started_at AS recording_started_at");
    expect(sql).toContain("FROM sessions s LEFT JOIN recordings r ON r.session_id = s.session_id");
    expect(sql).toContain("WHERE s.org_id = $1 AND s.external_source = 'fireflies'");
    expect(sql).toContain("s.source_metadata #>> '{fireflies,sourcePrefix}' IS NOT NULL");
    expect(sql).toContain("s.source_metadata #>> '{fireflies,sourceBucket}' = $2");
    expect(sql).toContain("s.source_metadata #>> '{fireflies,sourcePrefix}' LIKE $3 || '%'");
    expect(sql).toContain("LIMIT $4");
    expect(stmt.params).toEqual(["org_123", "weave-fireflies-raw", "raw/fireflies/", 50]);
  });

  it("updates historical Fireflies session display metadata only when values changed", () => {
    const metadata = sourceMetadata();
    const stmt = historicalFirefliesSessionMetadataBackfillStatement({
      sessionId: "hist_fireflies_01ABC",
      orgId: "org_123",
      roomName: "Candidate technical screen",
      scheduledAt: "2026-04-09T15:30:00.000Z",
      startedAt: "2026-04-09T15:30:00.000Z",
      endedAt: "2026-04-09T16:00:00.000Z",
      sourceMetadata: metadata,
    });

    const sql = compactSql(stmt.sql);

    expect(sql).toContain("UPDATE sessions SET room_name = $3");
    expect(sql).toContain("scheduled_at = $4::timestamptz");
    expect(sql).toContain("started_at = $5::timestamptz");
    expect(sql).toContain("ended_at = $6::timestamptz");
    expect(sql).toContain("source_metadata = $7::jsonb");
    expect(sql).toContain("WHERE session_id = $1 AND org_id = $2 AND external_source = 'fireflies'");
    expect(sql).toContain("source_metadata IS DISTINCT FROM $7::jsonb");
    expect(sql).toContain("RETURNING session_id");
    expect(stmt.params).toEqual([
      "hist_fireflies_01ABC",
      "org_123",
      "Candidate technical screen",
      "2026-04-09T15:30:00.000Z",
      "2026-04-09T15:30:00.000Z",
      "2026-04-09T16:00:00.000Z",
      JSON.stringify(metadata),
    ]);
  });

  it("updates historical Fireflies recording timestamps only when values changed", () => {
    const stmt = historicalFirefliesRecordingMetadataBackfillStatement({
      sessionId: "hist_fireflies_01ABC",
      startedAt: "2026-04-09T15:30:00.000Z",
      endedAt: "2026-04-09T16:00:00.000Z",
    });

    const sql = compactSql(stmt.sql);

    expect(sql).toContain("UPDATE recordings SET started_at = $2::timestamptz");
    expect(sql).toContain("ended_at = $3::timestamptz");
    expect(sql).toContain("WHERE session_id = $1");
    expect(sql).toContain("started_at IS DISTINCT FROM $2::timestamptz");
    expect(sql).toContain("ended_at IS DISTINCT FROM $3::timestamptz");
    expect(sql).toContain("RETURNING session_id");
    expect(stmt.params).toEqual([
      "hist_fireflies_01ABC",
      "2026-04-09T15:30:00.000Z",
      "2026-04-09T16:00:00.000Z",
    ]);
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
      occurredAt: "2026-04-09T15:30:08.250Z",
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
      "2026-04-09T15:30:08.250Z",
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
