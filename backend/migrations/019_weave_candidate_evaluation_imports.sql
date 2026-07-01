-- 019_weave_candidate_evaluation_imports.sql - source lineage for imported Weave candidate evaluations.

CREATE TABLE IF NOT EXISTS weave_candidate_evaluation_imports (
  source_evaluation_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  ashby_candidate_id TEXT,
  ashby_job_id TEXT NOT NULL,
  role_profile_id TEXT,
  score_id TEXT,
  source_created_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  source_payload_hash TEXT NOT NULL,
  last_event_id TEXT,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status TEXT NOT NULL CHECK (sync_status IN ('synced', 'failed')),
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (integration_id, application_id)
    REFERENCES ashby_applications(integration_id, application_id)
    ON DELETE CASCADE,
  FOREIGN KEY (score_id)
    REFERENCES ashby_candidate_scores(score_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS weave_candidate_evaluation_imports_org_job_idx
  ON weave_candidate_evaluation_imports(organization_id, ashby_job_id, source_updated_at DESC);

CREATE INDEX IF NOT EXISTS weave_candidate_evaluation_imports_application_idx
  ON weave_candidate_evaluation_imports(integration_id, application_id, source_updated_at DESC);

CREATE INDEX IF NOT EXISTS weave_candidate_evaluation_imports_score_idx
  ON weave_candidate_evaluation_imports(score_id)
  WHERE score_id IS NOT NULL;
