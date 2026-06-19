-- 015_interviewer_ai_control_state.sql - latest requested AI interviewer state.

CREATE TABLE IF NOT EXISTS interview_ai_control_state (
  session_id             TEXT PRIMARY KEY REFERENCES sessions(session_id) ON DELETE CASCADE,
  requested_state        TEXT NOT NULL CHECK (requested_state IN ('running', 'stopped')),
  requested_by_user_id   TEXT NOT NULL,
  requested_by_email     TEXT NOT NULL,
  requested_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interview_ai_control_state_requested_at_idx
  ON interview_ai_control_state(requested_at);
