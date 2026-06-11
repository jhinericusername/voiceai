-- 007_ashby_self_serve_onboarding.sql - customer-facing Ashby onboarding state.

ALTER TABLE ashby_company_integrations
  ADD COLUMN IF NOT EXISTS ashby_webhook_secret_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS setup_status TEXT NOT NULL DEFAULT 'pending_webhook',
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by_email TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_email TEXT;

UPDATE ashby_company_integrations
SET setup_status = CASE
  WHEN connected_at IS NOT NULL THEN 'connected'
  WHEN array_length(selected_job_ids, 1) IS NULL OR array_length(selected_job_ids, 1) = 0 THEN 'job_selection_pending'
  ELSE 'pending_webhook'
END
WHERE setup_status IS NULL OR setup_status = 'pending_webhook';

ALTER TABLE ashby_company_integrations
  DROP CONSTRAINT IF EXISTS ashby_company_integrations_setup_status_check;

ALTER TABLE ashby_company_integrations
  ADD CONSTRAINT ashby_company_integrations_setup_status_check
  CHECK (setup_status IN ('job_selection_pending', 'pending_webhook', 'connected', 'error'));

CREATE INDEX IF NOT EXISTS ashby_company_integrations_setup_status_idx
  ON ashby_company_integrations(setup_status);
