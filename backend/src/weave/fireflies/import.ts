import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface FirefliesImportOptions {
  readonly bucket: string;
  readonly rootDir: string;
  readonly s3RootPrefix: string;
}

export interface FirefliesRecording {
  readonly firefliesTranscriptId: string;
  readonly s3Bucket: string;
  readonly s3Prefix: string;
  readonly videoKey: string | null;
  readonly audioKey: string | null;
  readonly metadataKey: string;
  readonly transcriptKey: string;
  readonly ingestionResultKey: string | null;
  readonly title: string | null;
  readonly meetingStartedAt: string | null;
  readonly meetingDate: string | null;
  readonly durationSeconds: number | null;
  readonly targetEmail: string | null;
  readonly hostEmail: string | null;
  readonly organizerEmail: string | null;
  readonly attendeeEmails: string[];
  readonly attendeeNames: string[];
  readonly sourceMetadata: Record<string, unknown>;
  readonly sourceSummary: Record<string, unknown>;
}

export interface ReconciliationSqlOptions {
  readonly mode: "dry-run" | "apply";
  readonly schemaSql?: string;
}

type JsonRecord = Record<string, unknown>;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export async function discoverFirefliesRecordingFolders(rootDir: string): Promise<string[]> {
  const folders: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    const names = new Set(entries.map((entry) => entry.name));
    if (names.has("metadata.json") && names.has("transcript.json")) {
      folders.push(dir);
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name));
      }
    }
  }

  await walk(rootDir);
  return folders.sort();
}

export async function readFirefliesRecordings(
  options: FirefliesImportOptions,
): Promise<FirefliesRecording[]> {
  const folders = await discoverFirefliesRecordingFolders(options.rootDir);
  const recordings = await Promise.all(
    folders.map((folder) => readFirefliesRecordingFolder(folder, options)),
  );
  return recordings.sort((left, right) =>
    left.firefliesTranscriptId.localeCompare(right.firefliesTranscriptId),
  );
}

export async function readFirefliesRecordingFolder(
  folder: string,
  options: FirefliesImportOptions,
): Promise<FirefliesRecording> {
  const metadata = await readJson(join(folder, "metadata.json"));
  const transcript = await readJson(join(folder, "transcript.json"));
  const ingestion = await readOptionalJson(join(folder, "ingestion-result.json"));
  const transcriptId = stringValue(metadata.transcriptId) ?? stringValue(transcript.id);
  if (!transcriptId) {
    throw new Error(`Fireflies folder is missing transcriptId: ${folder}`);
  }

  const s3Prefix = folderPrefix(folder, options);
  const media = Array.isArray(ingestion?.media) ? ingestion.media : [];
  const videoKey = mediaKey(media, "video");
  const audioKey = mediaKey(media, "audio");
  const startedAt = timestampValue(transcript.date) ?? timestampValue(metadata.archivedAt);
  const attendeeEmails = uniqueStrings([
    ...extractMeetingAttendeeEmails(transcript.meeting_attendees),
    ...extractParticipantEmails(transcript.participants),
    normalizeEmail(metadata.targetEmail),
  ]);
  const attendeeNames = uniqueStrings([
    ...extractMeetingAttendeeNames(transcript.meeting_attendees),
    ...extractParticipantNames(transcript.participants),
  ]);

  return {
    firefliesTranscriptId: transcriptId,
    s3Bucket: options.bucket,
    s3Prefix,
    videoKey,
    audioKey,
    metadataKey: `${s3Prefix}metadata.json`,
    transcriptKey: `${s3Prefix}transcript.json`,
    ingestionResultKey: ingestion ? `${s3Prefix}ingestion-result.json` : null,
    title: stringValue(transcript.title) ?? stringValue(metadata.title),
    meetingStartedAt: startedAt,
    meetingDate: startedAt ? startedAt.slice(0, 10) : null,
    durationSeconds: integerValue(transcript.duration),
    targetEmail: normalizeEmail(metadata.targetEmail),
    hostEmail: normalizeEmail(metadata.hostEmail ?? transcript.host_email),
    organizerEmail: normalizeEmail(metadata.organizerEmail ?? transcript.organizer_email),
    attendeeEmails,
    attendeeNames,
    sourceMetadata: compactObject({
      transcriptId,
      source: stringValue(metadata.source),
      event: stringValue(metadata.event),
      targetEmail: normalizeEmail(metadata.targetEmail),
      matchedBy: Array.isArray(metadata.matchedBy) ? metadata.matchedBy : undefined,
    }),
    sourceSummary: summaryObject(transcript.summary),
  };
}

export function generateReconciliationSql(
  recordings: readonly FirefliesRecording[],
  options: ReconciliationSqlOptions,
): string {
  if (recordings.length === 0) {
    throw new Error("At least one Fireflies recording is required");
  }

  const columns = [
    "fireflies_transcript_id",
    "s3_bucket",
    "s3_prefix",
    "video_key",
    "audio_key",
    "metadata_key",
    "transcript_key",
    "ingestion_result_key",
    "title",
    "meeting_started_at",
    "meeting_date",
    "duration_seconds",
    "target_email",
    "host_email",
    "organizer_email",
    "attendee_emails",
    "attendee_names",
    "source_metadata",
    "source_summary",
  ];
  const valueRows = recordings.map((recording) => `  (${[
    sqlString(recording.firefliesTranscriptId),
    sqlString(recording.s3Bucket),
    sqlString(recording.s3Prefix),
    sqlNullableString(recording.videoKey),
    sqlNullableString(recording.audioKey),
    sqlString(recording.metadataKey),
    sqlString(recording.transcriptKey),
    sqlNullableString(recording.ingestionResultKey),
    sqlNullableString(recording.title),
    sqlNullableTimestamp(recording.meetingStartedAt),
    sqlNullableDate(recording.meetingDate),
    sqlNullableInteger(recording.durationSeconds),
    sqlNullableString(recording.targetEmail),
    sqlNullableString(recording.hostEmail),
    sqlNullableString(recording.organizerEmail),
    sqlTextArray(recording.attendeeEmails),
    sqlTextArray(recording.attendeeNames),
    sqlJsonb(recording.sourceMetadata),
    sqlJsonb(recording.sourceSummary),
  ].join(", ")})`);

  return [
    "-- Generated Fireflies reconciliation SQL. Do not edit by hand.",
    "-- Target table: weave_fireflies_recordings.",
    "-- Target table: weave_fireflies_recording_match_candidates.",
    options.mode === "apply" ? "BEGIN;" : "",
    options.schemaSql?.trim() ?? "",
    tempImportSql(columns, valueRows),
    previewSql(),
    options.mode === "apply" ? applySql() : dryRunSql(),
    options.mode === "apply" ? "COMMIT;" : "",
    "",
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

function tempImportSql(columns: readonly string[], valueRows: readonly string[]): string {
  return [
    "CREATE TEMP TABLE fireflies_import (",
    "  fireflies_transcript_id TEXT PRIMARY KEY,",
    "  s3_bucket TEXT NOT NULL,",
    "  s3_prefix TEXT NOT NULL,",
    "  video_key TEXT,",
    "  audio_key TEXT,",
    "  metadata_key TEXT NOT NULL,",
    "  transcript_key TEXT NOT NULL,",
    "  ingestion_result_key TEXT,",
    "  title TEXT,",
    "  meeting_started_at TIMESTAMPTZ,",
    "  meeting_date DATE,",
    "  duration_seconds INTEGER,",
    "  target_email TEXT,",
    "  host_email TEXT,",
    "  organizer_email TEXT,",
    "  attendee_emails TEXT[] NOT NULL,",
    "  attendee_names TEXT[] NOT NULL,",
    "  source_metadata JSONB NOT NULL,",
    "  source_summary JSONB NOT NULL",
    ");",
    "",
    `INSERT INTO fireflies_import (${columns.join(", ")}) VALUES`,
    `${valueRows.join(",\n")};`,
  ].join("\n");
}

function previewSql(): string {
  return `
CREATE TEMP TABLE fireflies_candidate_preview AS
WITH candidate_email_values AS (
  SELECT c.ashby_candidate_id, lower(trim(c.primary_email)) AS email
  FROM ashby_candidates c
  WHERE c.primary_email IS NOT NULL AND trim(c.primary_email) <> ''
  UNION
  SELECT c.ashby_candidate_id,
         lower(trim(coalesce(
           CASE WHEN jsonb_typeof(email_item.value) = 'string' THEN email_item.value #>> '{}' END,
           email_item.value ->> 'email',
           email_item.value ->> 'value',
           email_item.value ->> 'address'
         ))) AS email
  FROM ashby_candidates c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c.email_addresses) = 'array' THEN c.email_addresses ELSE '[]'::jsonb END
  ) AS email_item(value)
),
relevant_stage_history AS (
  SELECT
    h.ashby_application_id,
    h.entered_stage_at::date AS entered_stage_date,
    h.left_stage_at::date AS left_stage_date,
    h.title AS stage_title
  FROM ashby_application_stage_history h
  WHERE lower(coalesce(h.title, '')) ~ '(screen|interview|chat|top grade|take home)'
),
candidate_context AS (
  SELECT
    app.ashby_candidate_id,
    app.ashby_application_id,
    app.ashby_job_id,
    ev.id AS candidate_evaluation_id,
    ev.interview_date,
    lower(trim(coalesce(ev.candidate_name, c.name, ''))) AS candidate_name,
    app.ashby_created_at::date AS application_created_date,
    app.archived_at::date AS application_archived_date,
    app_counts.application_count,
    array_remove(array_agg(DISTINCT cev.email), NULL) AS candidate_emails
  FROM ashby_applications app
  JOIN ashby_candidates c
    ON c.ashby_candidate_id = app.ashby_candidate_id
  JOIN (
    SELECT ashby_candidate_id, count(*)::integer AS application_count
    FROM ashby_applications
    GROUP BY ashby_candidate_id
  ) app_counts
    ON app_counts.ashby_candidate_id = app.ashby_candidate_id
  LEFT JOIN candidate_evaluations ev
    ON ev.ashby_application_id = app.ashby_application_id
   AND ev.ashby_candidate_id = app.ashby_candidate_id
  LEFT JOIN candidate_email_values cev
    ON cev.ashby_candidate_id = app.ashby_candidate_id
   AND cev.email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
  GROUP BY app.ashby_candidate_id, app.ashby_application_id, app.ashby_job_id,
           ev.id, ev.interview_date, ev.candidate_name, c.name,
           app.ashby_created_at, app.archived_at, app_counts.application_count
),
active_application_counts AS (
  SELECT
    f.fireflies_transcript_id,
    cc.ashby_candidate_id,
    count(*) FILTER (
      WHERE cc.application_created_date <= f.meeting_date
        AND (cc.application_archived_date IS NULL OR cc.application_archived_date >= f.meeting_date)
    )::integer AS active_application_count
  FROM fireflies_import f
  CROSS JOIN candidate_context cc
  WHERE f.meeting_date IS NOT NULL
  GROUP BY f.fireflies_transcript_id, cc.ashby_candidate_id
),
stage_signal AS (
  SELECT
    f.fireflies_transcript_id,
    h.ashby_application_id,
    bool_or(
      f.meeting_date BETWEEN h.entered_stage_date - 1
        AND coalesce(h.left_stage_date, h.entered_stage_date + 14) + 1
    ) AS relevant_stage_on_meeting_date,
    coalesce(min(abs(f.meeting_date - h.entered_stage_date)) <= 3, false) AS relevant_stage_transition_near_meeting_date,
    min(abs(f.meeting_date - h.entered_stage_date)) AS stage_delta_days,
    array_remove(array_agg(DISTINCT h.stage_title), NULL) AS stage_titles
  FROM fireflies_import f
  JOIN relevant_stage_history h
    ON f.meeting_date IS NOT NULL
  GROUP BY f.fireflies_transcript_id, h.ashby_application_id
),
scored AS (
  SELECT
    f.fireflies_transcript_id,
    cc.ashby_candidate_id,
    cc.ashby_application_id,
    cc.ashby_job_id,
    cc.candidate_evaluation_id,
    matched.matched_email,
    abs(f.meeting_date - cc.interview_date) AS date_delta_days,
    stage_signal.stage_delta_days,
    coalesce(stage_signal.stage_titles, '{}'::text[]) AS stage_titles,
    (
      cc.application_created_date <= f.meeting_date
      AND (cc.application_archived_date IS NULL OR cc.application_archived_date >= f.meeting_date)
    ) AS application_active_on_meeting_date,
    coalesce(active_application_counts.active_application_count, 0)::integer AS active_application_count,
    (
      CASE
        WHEN matched.matched_email IS NOT NULL AND f.meeting_date = cc.interview_date THEN 100
        WHEN matched.matched_email IS NOT NULL AND stage_signal.relevant_stage_on_meeting_date THEN 96
        WHEN matched.matched_email IS NOT NULL AND stage_signal.relevant_stage_transition_near_meeting_date THEN 94
        WHEN matched.matched_email IS NOT NULL
          AND cc.application_created_date <= f.meeting_date
          AND (cc.application_archived_date IS NULL OR cc.application_archived_date >= f.meeting_date)
          AND coalesce(active_application_counts.active_application_count, 0) = 1 THEN 92
        WHEN matched.matched_email IS NOT NULL AND abs(f.meeting_date - cc.interview_date) = 1 THEN 90
        WHEN matched.matched_email IS NOT NULL AND cc.application_count = 1 THEN 88
        WHEN f.meeting_date IS NOT NULL
          AND position(cc.candidate_name in lower(coalesce(f.title, ''))) > 0
          AND stage_signal.relevant_stage_on_meeting_date THEN 84
        WHEN f.meeting_date IS NOT NULL
          AND position(cc.candidate_name in lower(coalesce(f.title, ''))) > 0
          AND stage_signal.relevant_stage_transition_near_meeting_date THEN 82
        WHEN matched.matched_email IS NOT NULL THEN 75
        WHEN f.meeting_date = cc.interview_date AND position(cc.candidate_name in lower(coalesce(f.title, ''))) > 0 THEN 70
        WHEN f.meeting_date = cc.interview_date THEN 25
        ELSE 0
      END
    )::numeric(6,2) AS score,
    array_remove(ARRAY[
      CASE WHEN matched.matched_email IS NOT NULL THEN 'email_overlap' END,
      CASE WHEN f.meeting_date = cc.interview_date THEN 'same_interview_date' END,
      CASE WHEN abs(f.meeting_date - cc.interview_date) = 1 THEN 'adjacent_interview_date' END,
      CASE WHEN stage_signal.relevant_stage_on_meeting_date THEN 'relevant_stage_on_meeting_date' END,
      CASE WHEN stage_signal.relevant_stage_transition_near_meeting_date THEN 'relevant_stage_transition_near_meeting_date' END,
      CASE WHEN cc.application_created_date <= f.meeting_date
        AND (cc.application_archived_date IS NULL OR cc.application_archived_date >= f.meeting_date)
        THEN 'application_active_on_meeting_date' END,
      CASE WHEN coalesce(active_application_counts.active_application_count, 0) = 1 THEN 'only_active_candidate_application' END,
      CASE WHEN cc.application_count = 1 THEN 'single_candidate_application' END,
      CASE WHEN cc.candidate_evaluation_id IS NOT NULL THEN 'has_candidate_evaluation' END,
      CASE WHEN position(cc.candidate_name in lower(coalesce(f.title, ''))) > 0 THEN 'name_in_title' END
    ], NULL) AS reasons
  FROM fireflies_import f
  CROSS JOIN candidate_context cc
  LEFT JOIN active_application_counts
    ON active_application_counts.fireflies_transcript_id = f.fireflies_transcript_id
   AND active_application_counts.ashby_candidate_id = cc.ashby_candidate_id
  LEFT JOIN stage_signal
    ON stage_signal.fireflies_transcript_id = f.fireflies_transcript_id
   AND stage_signal.ashby_application_id = cc.ashby_application_id
  LEFT JOIN LATERAL (
    SELECT fireflies_email AS matched_email
    FROM unnest(array_remove(ARRAY[f.target_email], NULL) || f.attendee_emails) AS fireflies_email
    WHERE fireflies_email = ANY(cc.candidate_emails)
    LIMIT 1
  ) matched ON true
  WHERE f.meeting_date IS NOT NULL
),
eligible AS (
  SELECT *
  FROM scored
  WHERE score >= 70
),
ranked AS (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY fireflies_transcript_id
      ORDER BY score DESC, date_delta_days ASC NULLS LAST, stage_delta_days ASC NULLS LAST, ashby_application_id ASC
    ) AS match_rank,
    dense_rank() OVER (
      PARTITION BY fireflies_transcript_id
      ORDER BY score DESC
    ) AS score_rank
  FROM eligible
)
SELECT
  fireflies_transcript_id,
  match_rank,
  ashby_candidate_id,
  ashby_application_id,
  ashby_job_id,
  candidate_evaluation_id,
  score,
  matched_email,
  date_delta_days,
  stage_delta_days,
  stage_titles,
  application_active_on_meeting_date,
  active_application_count,
  reasons,
  score_rank
FROM ranked
WHERE match_rank <= 10;

CREATE TEMP TABLE fireflies_recording_preview AS
WITH selected AS (
  SELECT *
  FROM fireflies_candidate_preview
  WHERE match_rank = 1
),
candidate_stats AS (
  SELECT
    candidate.fireflies_transcript_id,
    count(*)::integer AS candidate_match_count,
    count(*) FILTER (
      WHERE candidate.score IS NOT DISTINCT FROM selected.score
        AND candidate.date_delta_days IS NOT DISTINCT FROM selected.date_delta_days
        AND candidate.stage_delta_days IS NOT DISTINCT FROM selected.stage_delta_days
        AND candidate.application_active_on_meeting_date IS NOT DISTINCT FROM selected.application_active_on_meeting_date
        AND candidate.active_application_count IS NOT DISTINCT FROM selected.active_application_count
    )::integer AS top_candidate_count
  FROM fireflies_candidate_preview candidate
  LEFT JOIN selected
    ON selected.fireflies_transcript_id = candidate.fireflies_transcript_id
  GROUP BY candidate.fireflies_transcript_id
)
SELECT
  f.*,
  CASE
    WHEN selected.score >= 88 AND coalesce(candidate_stats.top_candidate_count, 0) = 1 THEN 'matched'
    WHEN coalesce(candidate_stats.candidate_match_count, 0) > 0 THEN 'ambiguous'
    ELSE 'unmatched'
  END AS match_status,
  selected.score AS match_confidence,
  CASE
    WHEN selected.score >= 100 AND coalesce(candidate_stats.top_candidate_count, 0) = 1 THEN 'email_and_exact_interview_date'
    WHEN selected.score >= 96 AND coalesce(candidate_stats.top_candidate_count, 0) = 1 THEN 'email_and_stage_on_meeting_date'
    WHEN selected.score >= 94 AND coalesce(candidate_stats.top_candidate_count, 0) = 1 THEN 'email_and_stage_transition_near_meeting_date'
    WHEN selected.score >= 92 AND coalesce(candidate_stats.top_candidate_count, 0) = 1 THEN 'email_and_only_active_application_on_meeting_date'
    WHEN selected.score >= 90 AND coalesce(candidate_stats.top_candidate_count, 0) = 1 THEN 'email_and_adjacent_interview_date'
    WHEN selected.score >= 88 AND coalesce(candidate_stats.top_candidate_count, 0) = 1 THEN 'email_and_single_application'
    WHEN selected.score IS NOT NULL THEN 'manual_review_required'
    ELSE NULL
  END AS match_method,
  coalesce(selected.reasons, '{}'::text[]) AS match_reasons,
  coalesce(candidate_stats.candidate_match_count, 0)::integer AS candidate_match_count,
  coalesce(candidate_stats.top_candidate_count, 0)::integer AS top_candidate_count,
  CASE WHEN selected.score >= 88 AND coalesce(candidate_stats.top_candidate_count, 0) = 1 THEN selected.ashby_candidate_id END AS ashby_candidate_id,
  CASE WHEN selected.score >= 88 AND coalesce(candidate_stats.top_candidate_count, 0) = 1 THEN selected.ashby_application_id END AS ashby_application_id,
  CASE WHEN selected.score >= 88 AND coalesce(candidate_stats.top_candidate_count, 0) = 1 THEN selected.ashby_job_id END AS ashby_job_id,
  CASE WHEN selected.score >= 88 AND coalesce(candidate_stats.top_candidate_count, 0) = 1 THEN selected.candidate_evaluation_id END AS candidate_evaluation_id,
  CASE WHEN selected.score >= 88 AND coalesce(candidate_stats.top_candidate_count, 0) = 1 THEN 'algorithm' END AS decision_source,
  CASE WHEN selected.score >= 88 AND coalesce(candidate_stats.top_candidate_count, 0) = 1 THEN selected.reasons END AS decision_reason,
  CASE WHEN selected.score >= 88 AND coalesce(candidate_stats.top_candidate_count, 0) = 1 THEN now() END AS decided_at
FROM fireflies_import f
LEFT JOIN candidate_stats USING (fireflies_transcript_id)
LEFT JOIN selected USING (fireflies_transcript_id);`.trim();
}

function applySql(): string {
  return `
INSERT INTO weave_fireflies_recordings (
  fireflies_transcript_id,
  s3_bucket,
  s3_prefix,
  video_key,
  audio_key,
  metadata_key,
  transcript_key,
  ingestion_result_key,
  title,
  meeting_started_at,
  meeting_date,
  duration_seconds,
  target_email,
  host_email,
  organizer_email,
  attendee_emails,
  attendee_names,
  match_status,
  match_confidence,
  match_method,
  match_reasons,
  candidate_match_count,
  top_candidate_count,
  ashby_candidate_id,
  ashby_application_id,
  ashby_job_id,
  candidate_evaluation_id,
  decision_source,
  decision_reason,
  decided_at,
  source_metadata,
  source_summary,
  reconciled_at,
  updated_at
)
SELECT
  fireflies_transcript_id,
  s3_bucket,
  s3_prefix,
  video_key,
  audio_key,
  metadata_key,
  transcript_key,
  ingestion_result_key,
  title,
  meeting_started_at,
  meeting_date,
  duration_seconds,
  target_email,
  host_email,
  organizer_email,
  attendee_emails,
  attendee_names,
  match_status,
  match_confidence,
  match_method,
  match_reasons,
  candidate_match_count,
  top_candidate_count,
  ashby_candidate_id,
  ashby_application_id,
  ashby_job_id,
  candidate_evaluation_id,
  decision_source,
  decision_reason,
  decided_at,
  source_metadata,
  source_summary,
  now(),
  now()
FROM fireflies_recording_preview
ON CONFLICT (fireflies_transcript_id) DO UPDATE SET
  s3_bucket = EXCLUDED.s3_bucket,
  s3_prefix = EXCLUDED.s3_prefix,
  video_key = EXCLUDED.video_key,
  audio_key = EXCLUDED.audio_key,
  metadata_key = EXCLUDED.metadata_key,
  transcript_key = EXCLUDED.transcript_key,
  ingestion_result_key = EXCLUDED.ingestion_result_key,
  title = EXCLUDED.title,
  meeting_started_at = EXCLUDED.meeting_started_at,
  meeting_date = EXCLUDED.meeting_date,
  duration_seconds = EXCLUDED.duration_seconds,
  target_email = EXCLUDED.target_email,
  host_email = EXCLUDED.host_email,
  organizer_email = EXCLUDED.organizer_email,
  attendee_emails = EXCLUDED.attendee_emails,
  attendee_names = EXCLUDED.attendee_names,
  match_status = EXCLUDED.match_status,
  match_confidence = EXCLUDED.match_confidence,
  match_method = EXCLUDED.match_method,
  match_reasons = EXCLUDED.match_reasons,
  candidate_match_count = EXCLUDED.candidate_match_count,
  top_candidate_count = EXCLUDED.top_candidate_count,
  ashby_candidate_id = CASE
    WHEN weave_fireflies_recordings.decision_source = 'manual' THEN weave_fireflies_recordings.ashby_candidate_id
    ELSE EXCLUDED.ashby_candidate_id
  END,
  ashby_application_id = CASE
    WHEN weave_fireflies_recordings.decision_source = 'manual' THEN weave_fireflies_recordings.ashby_application_id
    ELSE EXCLUDED.ashby_application_id
  END,
  ashby_job_id = CASE
    WHEN weave_fireflies_recordings.decision_source = 'manual' THEN weave_fireflies_recordings.ashby_job_id
    ELSE EXCLUDED.ashby_job_id
  END,
  candidate_evaluation_id = CASE
    WHEN weave_fireflies_recordings.decision_source = 'manual' THEN weave_fireflies_recordings.candidate_evaluation_id
    ELSE EXCLUDED.candidate_evaluation_id
  END,
  decision_source = CASE
    WHEN weave_fireflies_recordings.decision_source = 'manual' THEN weave_fireflies_recordings.decision_source
    ELSE EXCLUDED.decision_source
  END,
  decision_reason = CASE
    WHEN weave_fireflies_recordings.decision_source = 'manual' THEN weave_fireflies_recordings.decision_reason
    ELSE EXCLUDED.decision_reason
  END,
  decided_at = CASE
    WHEN weave_fireflies_recordings.decision_source = 'manual' THEN weave_fireflies_recordings.decided_at
    ELSE EXCLUDED.decided_at
  END,
  source_metadata = EXCLUDED.source_metadata,
  source_summary = EXCLUDED.source_summary,
  reconciled_at = now(),
  updated_at = now();

DELETE FROM weave_fireflies_recording_match_candidates
WHERE fireflies_transcript_id IN (SELECT fireflies_transcript_id FROM fireflies_import);

INSERT INTO weave_fireflies_recording_match_candidates (
  fireflies_transcript_id,
  match_rank,
  ashby_candidate_id,
  ashby_application_id,
  ashby_job_id,
  candidate_evaluation_id,
  score,
  matched_email,
  date_delta_days,
  stage_delta_days,
  stage_titles,
  application_active_on_meeting_date,
  active_application_count,
  reasons
)
SELECT
  fireflies_transcript_id,
  match_rank,
  ashby_candidate_id,
  ashby_application_id,
  ashby_job_id,
  candidate_evaluation_id,
  score,
  matched_email,
  date_delta_days,
  stage_delta_days,
  stage_titles,
  application_active_on_meeting_date,
  active_application_count,
  reasons
FROM fireflies_candidate_preview;

SELECT match_status, count(*)::integer AS recordings
FROM weave_fireflies_recordings
WHERE fireflies_transcript_id IN (SELECT fireflies_transcript_id FROM fireflies_import)
GROUP BY match_status
ORDER BY match_status;

SELECT count(*)::integer AS candidate_rows
FROM weave_fireflies_recording_match_candidates
WHERE fireflies_transcript_id IN (SELECT fireflies_transcript_id FROM fireflies_import);`.trim();
}

function dryRunSql(): string {
  return `
SELECT match_status, count(*)::integer AS recordings
FROM fireflies_recording_preview
GROUP BY match_status
ORDER BY match_status;

SELECT count(*)::integer AS candidate_rows
FROM fireflies_candidate_preview;

SELECT score, count(*)::integer AS candidate_rows
FROM fireflies_candidate_preview
GROUP BY score
ORDER BY score DESC;

SELECT match_confidence, count(*)::integer AS recordings
FROM fireflies_recording_preview
GROUP BY match_confidence
ORDER BY match_confidence DESC NULLS LAST;`.trim();
}

async function readJson(path: string): Promise<JsonRecord> {
  return JSON.parse(await readFile(path, "utf8")) as JsonRecord;
}

async function readOptionalJson(path: string): Promise<JsonRecord | null> {
  try {
    return await readJson(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function folderPrefix(folder: string, options: FirefliesImportOptions): string {
  const rel = relative(options.rootDir, folder).split(sep).filter(Boolean).join("/");
  return `${trimSlashes(options.s3RootPrefix)}/${rel}/`;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function mediaKey(media: unknown[], kind: "video" | "audio"): string | null {
  for (const item of media) {
    if (!isRecord(item)) {
      continue;
    }
    const itemKind = stringValue(item.kind);
    const contentType = stringValue(item.contentType);
    const key = stringValue(item.key);
    if (!key) {
      continue;
    }
    if (itemKind === kind || contentType?.startsWith(`${kind}/`)) {
      return key;
    }
  }
  return null;
}

function extractMeetingAttendeeEmails(value: unknown): Array<string | null> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => (isRecord(item) ? normalizeEmail(item.email) : null));
}

function extractMeetingAttendeeNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const name = stringValue(item.displayName) ?? stringValue(item.name);
    return name ? [name] : [];
  });
}

function extractParticipantEmails(value: unknown): Array<string | null> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (typeof item === "string") {
      return [normalizeEmail(item)];
    }
    if (!isRecord(item)) {
      return [];
    }
    return [normalizeEmail(item.email)];
  });
}

function extractParticipantNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (typeof item === "string" && !normalizeEmail(item)) {
      return [item];
    }
    if (!isRecord(item)) {
      return [];
    }
    const name = stringValue(item.name) ?? stringValue(item.displayName);
    return name ? [name] : [];
  });
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function summaryObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  const { transcript_chapters: _chapters, ...summary } = value;
  return summary;
}

function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null),
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integerValue(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
}

function timestampValue(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNullableString(value: string | null): string {
  return value === null ? "NULL" : sqlString(value);
}

function sqlNullableTimestamp(value: string | null): string {
  return value === null ? "NULL" : `${sqlString(value)}::timestamptz`;
}

function sqlNullableDate(value: string | null): string {
  return value === null ? "NULL" : `${sqlString(value)}::date`;
}

function sqlNullableInteger(value: number | null): string {
  return value === null ? "NULL" : String(value);
}

function sqlTextArray(values: readonly string[]): string {
  return `ARRAY[${values.map(sqlString).join(", ")}]::text[]`;
}

function sqlJsonb(value: Record<string, unknown>): string {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

async function runCli(): Promise<void> {
  const args = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(
        "Usage: import.ts --root <dir> --bucket <bucket> --s3-prefix <prefix> --mode <dry-run|apply> [--schema <path>]",
      );
    }
    args.set(key, value);
  }

  const rootDir = args.get("--root");
  const bucket = args.get("--bucket");
  const s3RootPrefix = args.get("--s3-prefix");
  const mode = args.get("--mode");
  if (!rootDir || !bucket || !s3RootPrefix || (mode !== "dry-run" && mode !== "apply")) {
    throw new Error(
      "Usage: import.ts --root <dir> --bucket <bucket> --s3-prefix <prefix> --mode <dry-run|apply> [--schema <path>]",
    );
  }

  const schemaPath = args.get("--schema");
  const schemaSql = schemaPath ? await readFile(schemaPath, "utf8") : undefined;
  const recordings = await readFirefliesRecordings({ rootDir, bucket, s3RootPrefix });
  process.stdout.write(generateReconciliationSql(recordings, { mode, schemaSql }));
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
