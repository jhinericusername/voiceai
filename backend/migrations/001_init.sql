-- 001_init.sql — initial Puddle interviewer schema.

CREATE TABLE sessions (
  session_id      TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  candidate_email TEXT NOT NULL,
  script_version  TEXT NOT NULL,
  status          TEXT NOT NULL,
  scheduled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consent_records (
  session_id                 TEXT PRIMARY KEY REFERENCES sessions(session_id),
  candidate_email            TEXT NOT NULL,
  ai_disclosure_acknowledged BOOLEAN NOT NULL,
  recording_consented        BOOLEAN NOT NULL,
  consented_at               TIMESTAMPTZ NOT NULL
);

CREATE TABLE assessments (
  session_id          TEXT PRIMARY KEY REFERENCES sessions(session_id),
  script_version      TEXT NOT NULL,
  category_scores     JSONB NOT NULL,
  meets_bare_minimum  BOOLEAN NOT NULL,
  integrity_flags     JSONB NOT NULL DEFAULT '[]'::jsonb,
  reviewer_email      TEXT,
  signed_off_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(session_id),
  kind        TEXT NOT NULL,            -- agent | media | integrity
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX events_session_idx ON events(session_id);

CREATE TABLE audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  TEXT REFERENCES sessions(session_id),
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  prev_hash   TEXT,
  entry_hash  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_session_idx ON audit_log(session_id);

CREATE TABLE schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
