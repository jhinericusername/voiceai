-- 006_repair_ashby_composite_keys.sql — repair early Ashby key constraints.

DO $$
DECLARE
  app_pkey_columns text[];
BEGIN
  SELECT array_agg(att.attname ORDER BY key_position.ordinality)
    INTO app_pkey_columns
  FROM pg_constraint con
  JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS key_position(attnum, ordinality) ON true
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid
   AND att.attnum = key_position.attnum
  WHERE con.conrelid = 'ashby_applications'::regclass
    AND con.contype = 'p';

  IF app_pkey_columns = ARRAY['application_id'] THEN
    ALTER TABLE ashby_applications
      DROP CONSTRAINT ashby_applications_pkey;

    ALTER TABLE ashby_applications
      ADD CONSTRAINT ashby_applications_pkey
      PRIMARY KEY (integration_id, application_id);
  END IF;
END $$;

ALTER TABLE ashby_candidate_scores
  DROP CONSTRAINT IF EXISTS ashby_candidate_scores_application_id_reviewer_email_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'ashby_candidate_scores'::regclass
      AND conname = 'ashby_candidate_scores_integration_id_application_id_reviewer_email_key'
  ) THEN
    ALTER TABLE ashby_candidate_scores
      ADD CONSTRAINT ashby_candidate_scores_integration_id_application_id_reviewer_email_key
      UNIQUE (integration_id, application_id, reviewer_email);
  END IF;
END $$;
