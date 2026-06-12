-- 002_fireflies_application_reconciliation.sql — make Fireflies matches application-first.

ALTER TABLE weave_fireflies_recordings
  ADD COLUMN IF NOT EXISTS decision_source TEXT,
  ADD COLUMN IF NOT EXISTS decision_reason TEXT[],
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

ALTER TABLE weave_fireflies_recording_match_candidates
  ADD COLUMN IF NOT EXISTS id BIGINT,
  ADD COLUMN IF NOT EXISTS stage_delta_days INTEGER,
  ADD COLUMN IF NOT EXISTS stage_titles TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS application_active_on_meeting_date BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS active_application_count INTEGER;

CREATE SEQUENCE IF NOT EXISTS weave_fireflies_recording_match_candidates_id_seq;

ALTER SEQUENCE weave_fireflies_recording_match_candidates_id_seq
  OWNED BY weave_fireflies_recording_match_candidates.id;

UPDATE weave_fireflies_recording_match_candidates
SET id = nextval('weave_fireflies_recording_match_candidates_id_seq')
WHERE id IS NULL;

ALTER TABLE weave_fireflies_recording_match_candidates
  ALTER COLUMN id SET DEFAULT nextval('weave_fireflies_recording_match_candidates_id_seq'),
  ALTER COLUMN id SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'weave_fireflies_recording_match_candidates_pkey'
      AND conrelid = 'weave_fireflies_recording_match_candidates'::regclass
      AND pg_get_constraintdef(oid) <> 'PRIMARY KEY (id)'
  ) THEN
    ALTER TABLE weave_fireflies_recording_match_candidates
      DROP CONSTRAINT weave_fireflies_recording_match_candidates_pkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'weave_fireflies_recording_match_candidates_pkey'
      AND conrelid = 'weave_fireflies_recording_match_candidates'::regclass
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
  ) THEN
    ALTER TABLE weave_fireflies_recording_match_candidates
      ADD CONSTRAINT weave_fireflies_recording_match_candidates_pkey PRIMARY KEY (id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS weave_fireflies_match_candidates_unique_option_idx
  ON weave_fireflies_recording_match_candidates (
    fireflies_transcript_id,
    ashby_application_id,
    coalesce(candidate_evaluation_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX IF NOT EXISTS weave_fireflies_match_candidates_score_idx
  ON weave_fireflies_recording_match_candidates(fireflies_transcript_id, score DESC, match_rank);
