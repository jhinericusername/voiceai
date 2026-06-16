-- 001_fireflies_reconciliation.sql — historical Fireflies-to-candidate index.

CREATE TABLE IF NOT EXISTS weave_fireflies_recordings (
  fireflies_transcript_id TEXT PRIMARY KEY,
  s3_bucket               TEXT NOT NULL,
  s3_prefix               TEXT NOT NULL,
  video_key               TEXT,
  audio_key               TEXT,
  metadata_key            TEXT NOT NULL,
  transcript_key          TEXT NOT NULL,
  ingestion_result_key    TEXT,
  title                   TEXT,
  meeting_started_at      TIMESTAMPTZ,
  meeting_date            DATE,
  duration_seconds        INTEGER,
  target_email            TEXT,
  host_email              TEXT,
  organizer_email         TEXT,
  attendee_emails         TEXT[] NOT NULL DEFAULT '{}',
  attendee_names          TEXT[] NOT NULL DEFAULT '{}',
  match_status            TEXT NOT NULL CHECK (
    match_status IN ('matched', 'ambiguous', 'unmatched')
  ),
  match_confidence        NUMERIC(6,2),
  match_method            TEXT,
  match_reasons           TEXT[] NOT NULL DEFAULT '{}',
  candidate_match_count   INTEGER NOT NULL DEFAULT 0,
  top_candidate_count     INTEGER NOT NULL DEFAULT 0,
  ashby_candidate_id      TEXT,
  ashby_application_id    TEXT,
  ashby_job_id            TEXT,
  candidate_evaluation_id UUID,
  decision_source         TEXT,
  decision_reason         TEXT[],
  decided_at              TIMESTAMPTZ,
  source_metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_summary          JSONB NOT NULL DEFAULT '{}'::jsonb,
  reconciled_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (s3_bucket, s3_prefix)
);

CREATE INDEX IF NOT EXISTS weave_fireflies_recordings_status_idx
  ON weave_fireflies_recordings(match_status, meeting_date);

CREATE INDEX IF NOT EXISTS weave_fireflies_recordings_candidate_idx
  ON weave_fireflies_recordings(ashby_candidate_id)
  WHERE ashby_candidate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS weave_fireflies_recordings_application_idx
  ON weave_fireflies_recordings(ashby_application_id)
  WHERE ashby_application_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS weave_fireflies_recording_match_candidates (
  fireflies_transcript_id TEXT NOT NULL REFERENCES weave_fireflies_recordings(fireflies_transcript_id) ON DELETE CASCADE,
  match_rank              INTEGER NOT NULL,
  ashby_candidate_id      TEXT NOT NULL,
  ashby_application_id    TEXT NOT NULL,
  ashby_job_id            TEXT,
  candidate_evaluation_id UUID,
  score                   NUMERIC(6,2) NOT NULL,
  matched_email           TEXT,
  date_delta_days         INTEGER,
  stage_delta_days        INTEGER,
  stage_titles            TEXT[] NOT NULL DEFAULT '{}',
  application_active_on_meeting_date BOOLEAN NOT NULL DEFAULT false,
  active_application_count INTEGER,
  reasons                 TEXT[] NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (fireflies_transcript_id, match_rank)
);

CREATE INDEX IF NOT EXISTS weave_fireflies_match_candidates_candidate_idx
  ON weave_fireflies_recording_match_candidates(ashby_candidate_id);

CREATE INDEX IF NOT EXISTS weave_fireflies_match_candidates_application_idx
  ON weave_fireflies_recording_match_candidates(ashby_application_id);
