-- 003_interview_artifacts.sql — durable dashboard/review metadata.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS room_name TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

CREATE TABLE transcript_turns (
  session_id  TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  turn_index  INTEGER NOT NULL,
  speaker     TEXT NOT NULL CHECK (speaker IN ('agent', 'candidate')),
  question_id TEXT,
  text        TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  offset_ms   INTEGER,
  source      TEXT NOT NULL DEFAULT 'livekit',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, turn_index)
);

CREATE INDEX transcript_turns_session_order_idx
  ON transcript_turns(session_id, turn_index);

CREATE TABLE recordings (
  session_id    TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
  egress_id     TEXT,
  status        TEXT NOT NULL CHECK (status IN ('pending', 'starting', 'active', 'complete', 'failed')),
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX recordings_status_idx ON recordings(status);

CREATE TABLE recording_artifacts (
  artifact_id      TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (
    kind IN (
      'composite_video',
      'candidate_video',
      'candidate_audio',
      'agent_audio',
      'transcript',
      'agent_events',
      'media_events',
      'integrity_events',
      'scores',
      'integrity_flags'
    )
  ),
  storage_path     TEXT NOT NULL,
  content_type     TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('expected', 'available', 'failed')),
  size_bytes       BIGINT,
  duration_seconds NUMERIC(12,3),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, kind)
);

CREATE INDEX recording_artifacts_session_idx ON recording_artifacts(session_id);
