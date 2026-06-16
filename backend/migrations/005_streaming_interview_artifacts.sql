-- 005_streaming_interview_artifacts.sql - idempotent live interview artifacts.

CREATE TABLE IF NOT EXISTS agent_events (
  session_id      TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  sequence        INTEGER NOT NULL,
  turn_index      INTEGER,
  utterance       TEXT NOT NULL,
  reason_code     TEXT NOT NULL,
  question_id     TEXT,
  category        TEXT,
  missing_element TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, sequence)
);

CREATE INDEX IF NOT EXISTS agent_events_session_order_idx
  ON agent_events(session_id, sequence);

CREATE TABLE IF NOT EXISTS score_checkpoints (
  session_id  TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  sequence    INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  model       TEXT NOT NULL,
  assessments JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, sequence)
);

CREATE INDEX IF NOT EXISTS score_checkpoints_session_order_idx
  ON score_checkpoints(session_id, sequence);
