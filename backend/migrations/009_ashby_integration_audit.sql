-- 009_ashby_integration_audit.sql - append-only audit trail for Ashby integration admin actions.

CREATE TABLE IF NOT EXISTS ashby_integration_audit_events (
  id BIGSERIAL PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES ashby_company_integrations(integration_id) ON DELETE RESTRICT,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ashby_integration_audit_events_action_check
    CHECK (action IN ('api_key_replaced', 'jobs_selected', 'active_applications_synced'))
);

CREATE INDEX IF NOT EXISTS ashby_integration_audit_events_integration_created_idx
  ON ashby_integration_audit_events(integration_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ashby_integration_audit_events_actor_created_idx
  ON ashby_integration_audit_events(actor_email, created_at DESC);
