WITH integrations_missing_webhook AS (
  SELECT integration_id
  FROM ashby_company_integrations
  WHERE ashby_webhook_secret_ciphertext IS NULL
),
reset_integrations AS (
  UPDATE ashby_company_integrations
  SET
    setup_status = 'job_selection_pending',
    connected_at = NULL,
    last_ping_at = NULL,
    last_sync_at = NULL,
    updated_at = now()
  WHERE integration_id IN (SELECT integration_id FROM integrations_missing_webhook)
  RETURNING integration_id
)
UPDATE ashby_applications
SET status = 'Stale', updated_at = now()
WHERE integration_id IN (SELECT integration_id FROM integrations_missing_webhook)
  AND status = 'Active';
