-- 011_historical_interview_sources.sql - idempotent source tracking for imported interviews.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS external_source TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_external_source_id_idx
  ON sessions(external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sessions_org_external_source_idx
  ON sessions(org_id, external_source, created_at DESC)
  WHERE external_source IS NOT NULL;

CREATE TABLE IF NOT EXISTS historical_interview_import_runs (
  import_run_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  org_id TEXT NOT NULL,
  source_bucket TEXT NOT NULL,
  source_prefix TEXT NOT NULL,
  target_bucket TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('dry-run', 'apply')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  planned_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS historical_interview_import_runs_source_started_idx
  ON historical_interview_import_runs(source, started_at DESC);
