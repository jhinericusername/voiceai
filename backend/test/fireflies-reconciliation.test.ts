import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  generateReconciliationSql,
  normalizeEmail,
  readFirefliesRecordingFolder,
} from "../src/weave/fireflies/import.js";

describe("Fireflies reconciliation import", () => {
  it("normalizes email evidence consistently", () => {
    expect(normalizeEmail("  Candidate@Example.COM ")).toBe("candidate@example.com");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail("not an email")).toBeNull();
  });

  it("reads one Fireflies recording folder without copying transcript text", async () => {
    const root = await mkdtemp(join(tmpdir(), "fireflies-recording-"));
    const folder = join(root, "org", "session");
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "metadata.json"),
      JSON.stringify({
        transcriptId: "tx_123",
        title: "Candidate Screen",
        targetEmail: "Candidate@Example.COM",
        hostEmail: "host@example.com",
        organizerEmail: "organizer@example.com",
      }),
    );
    await writeFile(
      join(folder, "transcript.json"),
      JSON.stringify({
        id: "tx_123",
        title: "Candidate Screen",
        date: "2026-06-10T17:00:00.000Z",
        duration: 912,
        meeting_attendees: [
          { displayName: "Candidate Person", email: "candidate@example.com" },
          { displayName: "Interviewer", email: "host@example.com" },
        ],
        sentences: [{ text: "do not copy me into sql" }],
        summary: { short_summary: "short" },
      }),
    );
    await writeFile(
      join(folder, "ingestion-result.json"),
      JSON.stringify({
        media: [
          {
            kind: "video",
            key: "raw/fireflies/org/session/video.mp4",
            contentType: "video/mp4",
            bytes: 100,
          },
          {
            kind: "audio",
            key: "raw/fireflies/org/session/audio.mp3",
            contentType: "audio/mpeg",
            bytes: 50,
          },
        ],
      }),
    );

    const recording = await readFirefliesRecordingFolder(folder, {
      bucket: "weave-fireflies",
      rootDir: root,
      s3RootPrefix: "raw/fireflies/",
    });

    expect(recording).toMatchObject({
      firefliesTranscriptId: "tx_123",
      s3Bucket: "weave-fireflies",
      s3Prefix: "raw/fireflies/org/session/",
      videoKey: "raw/fireflies/org/session/video.mp4",
      audioKey: "raw/fireflies/org/session/audio.mp3",
      metadataKey: "raw/fireflies/org/session/metadata.json",
      transcriptKey: "raw/fireflies/org/session/transcript.json",
      title: "Candidate Screen",
      meetingStartedAt: "2026-06-10T17:00:00.000Z",
      meetingDate: "2026-06-10",
      durationSeconds: 912,
      targetEmail: "candidate@example.com",
      hostEmail: "host@example.com",
      organizerEmail: "organizer@example.com",
      attendeeEmails: ["candidate@example.com", "host@example.com"],
      attendeeNames: ["Candidate Person", "Interviewer"],
    });
    expect(JSON.stringify(recording.sourceSummary)).not.toContain("do not copy me");
  });

  it("prefers a nested Fireflies event title over transcript title", async () => {
    const root = await mkdtemp(join(tmpdir(), "fireflies-event-title-"));
    const folder = join(root, "org", "session");
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "metadata.json"),
      JSON.stringify({
        transcriptId: "tx_event_title",
        event: {
          title: "Fireflies calendar event title",
        },
      }),
    );
    await writeFile(
      join(folder, "transcript.json"),
      JSON.stringify({
        id: "tx_event_title",
        title: "Transcript fallback title",
      }),
    );

    const recording = await readFirefliesRecordingFolder(folder, {
      bucket: "weave-fireflies",
      rootDir: root,
      s3RootPrefix: "raw/fireflies/",
    });

    expect(recording.title).toBe("Fireflies calendar event title");
  });

  it("does not convert date-only transcript metadata into an exact meeting timestamp", async () => {
    const root = await mkdtemp(join(tmpdir(), "fireflies-date-only-"));
    const folder = join(root, "org", "session");
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "metadata.json"),
      JSON.stringify({
        transcriptId: "tx_date_only",
        eventTitle: "Date-only Fireflies recording",
      }),
    );
    await writeFile(
      join(folder, "transcript.json"),
      JSON.stringify({
        id: "tx_date_only",
        date: "2026-06-10",
        duration: 912,
      }),
    );

    const recording = await readFirefliesRecordingFolder(folder, {
      bucket: "weave-fireflies",
      rootDir: root,
      s3RootPrefix: "raw/fireflies/",
    });

    expect(recording.meetingStartedAt).toBeNull();
    expect(recording.meetingDate).toBe("2026-06-10");
    expect(recording.sourceMetadata).toMatchObject({
      title: "Date-only Fireflies recording",
      dateOnlyStartedAt: "2026-06-10T00:00:00.000Z",
      dateOnlyStartedAtSource: "transcript",
    });
    expect(recording.sourceMetadata).not.toHaveProperty("meetingStartedAt");
  });

  it("ignores scalar Fireflies event labels when reading recording titles", async () => {
    const root = await mkdtemp(join(tmpdir(), "fireflies-scalar-event-title-"));
    const folder = join(root, "org", "session");
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "metadata.json"),
      JSON.stringify({
        transcriptId: "tx_scalar_event",
        event: "backfill",
        title: "Metadata event title",
      }),
    );
    await writeFile(
      join(folder, "transcript.json"),
      JSON.stringify({
        id: "tx_scalar_event",
        title: "Transcript fallback title",
      }),
    );

    const recording = await readFirefliesRecordingFolder(folder, {
      bucket: "weave-fireflies",
      rootDir: root,
      s3RootPrefix: "raw/fireflies/",
    });

    expect(recording.title).toBe("Metadata event title");
  });

  it("generates idempotent reconciliation SQL with escaped values", () => {
    const sql = generateReconciliationSql(
      [
        {
          firefliesTranscriptId: "tx_'_123",
          s3Bucket: "weave-fireflies",
          s3Prefix: "raw/fireflies/org/session/",
          videoKey: "raw/fireflies/org/session/video.mp4",
          audioKey: null,
          metadataKey: "raw/fireflies/org/session/metadata.json",
          transcriptKey: "raw/fireflies/org/session/transcript.json",
          ingestionResultKey: null,
          title: "Candidate's Screen",
          meetingStartedAt: "2026-06-10T17:00:00.000Z",
          meetingDate: "2026-06-10",
          durationSeconds: 912,
          targetEmail: "candidate@example.com",
          hostEmail: null,
          organizerEmail: null,
          attendeeEmails: ["candidate@example.com"],
          attendeeNames: ["Candidate Person"],
          sourceMetadata: { transcriptId: "tx_'_123" },
          sourceSummary: { short_summary: "Candidate's summary" },
        },
      ],
      { mode: "dry-run" },
    );

    expect(sql).toContain("CREATE TEMP TABLE fireflies_import");
    expect(sql).toContain("tx_''_123");
    expect(sql).toContain("Candidate''s Screen");
    expect(sql).toContain("weave_fireflies_recordings");
    expect(sql).toContain("SELECT match_status, count(*)");
    expect(sql).not.toContain("INSERT INTO weave_fireflies_recordings");
  });

  it("uses Ashby application stage history to resolve multi-application candidates", () => {
    const sql = generateReconciliationSql(
      [
        {
          firefliesTranscriptId: "tx_stage_123",
          s3Bucket: "weave-fireflies",
          s3Prefix: "raw/fireflies/org/session/",
          videoKey: null,
          audioKey: null,
          metadataKey: "raw/fireflies/org/session/metadata.json",
          transcriptKey: "raw/fireflies/org/session/transcript.json",
          ingestionResultKey: null,
          title: "Candidate Initial Screen",
          meetingStartedAt: "2026-06-10T17:00:00.000Z",
          meetingDate: "2026-06-10",
          durationSeconds: 912,
          targetEmail: "candidate@example.com",
          hostEmail: null,
          organizerEmail: null,
          attendeeEmails: ["candidate@example.com"],
          attendeeNames: ["Candidate Person"],
          sourceMetadata: { transcriptId: "tx_stage_123" },
          sourceSummary: {},
        },
      ],
      { mode: "dry-run" },
    );

    expect(sql).toContain("ashby_application_stage_history");
    expect(sql).toContain("relevant_stage_on_meeting_date");
    expect(sql).toContain("relevant_stage_transition_near_meeting_date");
    expect(sql).toContain("application_active_on_meeting_date");
    expect(sql).toContain("email_and_stage_on_meeting_date");
    expect(sql).toContain("WHEN matched.matched_email IS NOT NULL AND stage_signal.relevant_stage_on_meeting_date THEN 96");
  });

  it("counts top application candidates using score plus tie-breaker evidence", () => {
    const sql = generateReconciliationSql(
      [
        {
          firefliesTranscriptId: "tx_tie_123",
          s3Bucket: "weave-fireflies",
          s3Prefix: "raw/fireflies/org/tie/",
          videoKey: null,
          audioKey: null,
          metadataKey: "raw/fireflies/org/tie/metadata.json",
          transcriptKey: "raw/fireflies/org/tie/transcript.json",
          ingestionResultKey: null,
          title: "Candidate Chat",
          meetingStartedAt: "2026-06-10T17:00:00.000Z",
          meetingDate: "2026-06-10",
          durationSeconds: 912,
          targetEmail: "candidate@example.com",
          hostEmail: null,
          organizerEmail: null,
          attendeeEmails: ["candidate@example.com"],
          attendeeNames: ["Candidate Person"],
          sourceMetadata: { transcriptId: "tx_tie_123" },
          sourceSummary: {},
        },
      ],
      { mode: "dry-run" },
    );

    expect(sql).toContain("selected.score");
    expect(sql).toContain("candidate.stage_delta_days IS NOT DISTINCT FROM selected.stage_delta_days");
    expect(sql).toContain(
      "candidate.application_active_on_meeting_date IS NOT DISTINCT FROM selected.application_active_on_meeting_date",
    );
    expect(sql).not.toContain("count(*) FILTER (WHERE score_rank = 1)::integer AS top_candidate_count");
  });
});
