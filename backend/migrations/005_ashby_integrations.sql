-- 005_ashby_integrations.sql — internal Ashby integration state.

CREATE TABLE ashby_company_integrations (
  integration_id          TEXT PRIMARY KEY,
  organization_id         TEXT,
  email_domain            TEXT NOT NULL,
  ashby_api_key_ciphertext TEXT NOT NULL,
  selected_job_ids        TEXT[] NOT NULL DEFAULT '{}',
  connected_at            TIMESTAMPTZ,
  last_ping_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ashby_company_integrations_email_domain_idx
  ON ashby_company_integrations(email_domain);

CREATE UNIQUE INDEX ashby_company_integrations_organization_id_idx
  ON ashby_company_integrations(organization_id)
  WHERE organization_id IS NOT NULL;

CREATE TABLE ashby_webhook_events (
  webhook_action_id TEXT PRIMARY KEY,
  integration_id    TEXT REFERENCES ashby_company_integrations(integration_id) ON DELETE SET NULL,
  action            TEXT NOT NULL,
  payload           JSONB NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ
);

CREATE INDEX ashby_webhook_events_integration_idx
  ON ashby_webhook_events(integration_id, received_at DESC);

CREATE TABLE ashby_applications (
  application_id   TEXT PRIMARY KEY,
  integration_id   TEXT NOT NULL REFERENCES ashby_company_integrations(integration_id) ON DELETE CASCADE,
  candidate_id     TEXT NOT NULL,
  candidate_name   TEXT NOT NULL,
  candidate_email  TEXT,
  job_id           TEXT NOT NULL,
  current_stage    TEXT,
  source           TEXT,
  status           TEXT NOT NULL,
  ashby_updated_at TIMESTAMPTZ,
  raw_payload      JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (integration_id, application_id)
);

CREATE INDEX ashby_applications_integration_job_status_idx
  ON ashby_applications(integration_id, job_id, status);

CREATE INDEX ashby_applications_candidate_search_idx
  ON ashby_applications(integration_id, lower(candidate_name), lower(candidate_email));

CREATE TABLE ashby_candidate_scores (
  score_id            TEXT PRIMARY KEY,
  integration_id      TEXT NOT NULL REFERENCES ashby_company_integrations(integration_id) ON DELETE CASCADE,
  application_id      TEXT NOT NULL,
  role_id             TEXT NOT NULL,
  reviewer_email      TEXT NOT NULL,
  problem_solving     NUMERIC(2,1) NOT NULL CHECK (problem_solving >= 0 AND problem_solving <= 4 AND problem_solving * 2 = floor(problem_solving * 2)),
  agency              NUMERIC(2,1) NOT NULL CHECK (agency >= 0 AND agency <= 4 AND agency * 2 = floor(agency * 2)),
  competitiveness     NUMERIC(2,1) NOT NULL CHECK (competitiveness >= 0 AND competitiveness <= 4 AND competitiveness * 2 = floor(competitiveness * 2)),
  curiosity           NUMERIC(2,1) NOT NULL CHECK (curiosity >= 0 AND curiosity <= 4 AND curiosity * 2 = floor(curiosity * 2)),
  total_score         NUMERIC(3,1) NOT NULL CHECK (total_score >= 0 AND total_score <= 16 AND total_score * 2 = floor(total_score * 2)),
  comments            TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (total_score = problem_solving + agency + competitiveness + curiosity),
  FOREIGN KEY (integration_id, application_id) REFERENCES ashby_applications(integration_id, application_id) ON DELETE CASCADE,
  UNIQUE (application_id, reviewer_email)
);

CREATE INDEX ashby_candidate_scores_recent_idx
  ON ashby_candidate_scores(integration_id, updated_at DESC);
