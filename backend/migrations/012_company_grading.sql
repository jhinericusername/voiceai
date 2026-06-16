-- 012_company_grading.sql - role grading profiles, rubric versions, recommendations, and reviewer feedback.

CREATE UNIQUE INDEX IF NOT EXISTS ashby_company_integrations_integration_org_idx
  ON ashby_company_integrations(integration_id, organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS sessions_session_org_idx
  ON sessions(session_id, org_id);

CREATE TABLE IF NOT EXISTS role_grading_profiles (
  profile_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  ashby_integration_id TEXT NOT NULL,
  ashby_job_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('draft_needed', 'draft_ready', 'approval_required', 'recommendations_active', 'paused')
  ),
  active_rubric_version_id TEXT,
  draft_rubric_version_id TEXT,
  created_by_email TEXT NOT NULL,
  updated_by_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, ashby_job_id),
  UNIQUE (profile_id, organization_id, ashby_job_id),
  FOREIGN KEY (ashby_integration_id, organization_id)
    REFERENCES ashby_company_integrations(integration_id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS role_grading_profiles_org_integration_idx
  ON role_grading_profiles(organization_id, ashby_integration_id, created_at);

CREATE TABLE IF NOT EXISTS role_rubric_versions (
  rubric_version_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  ashby_job_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'archived')),
  rubric JSONB NOT NULL,
  generation_inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by_email TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, version),
  UNIQUE (rubric_version_id, profile_id),
  UNIQUE (rubric_version_id, organization_id, ashby_job_id),
  FOREIGN KEY (profile_id, organization_id, ashby_job_id)
    REFERENCES role_grading_profiles(profile_id, organization_id, ashby_job_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS role_rubric_versions_profile_status_idx
  ON role_rubric_versions(profile_id, status, version DESC);

ALTER TABLE role_grading_profiles
  DROP CONSTRAINT IF EXISTS role_grading_profiles_active_rubric_fk,
  ADD CONSTRAINT role_grading_profiles_active_rubric_fk
    FOREIGN KEY (active_rubric_version_id, profile_id)
    REFERENCES role_rubric_versions(rubric_version_id, profile_id)
    ON DELETE SET NULL (active_rubric_version_id);

ALTER TABLE role_grading_profiles
  DROP CONSTRAINT IF EXISTS role_grading_profiles_draft_rubric_fk,
  ADD CONSTRAINT role_grading_profiles_draft_rubric_fk
    FOREIGN KEY (draft_rubric_version_id, profile_id)
    REFERENCES role_rubric_versions(rubric_version_id, profile_id)
    ON DELETE SET NULL (draft_rubric_version_id);

CREATE TABLE IF NOT EXISTS interview_recommendations (
  recommendation_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  ashby_job_id TEXT NOT NULL,
  rubric_version_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('historical_fireflies', 'puddle_live', 'manual_retry')),
  recommendation TEXT NOT NULL CHECK (recommendation IN ('advance', 'hold', 'pass')),
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  category_scores JSONB NOT NULL,
  evidence JSONB NOT NULL,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, rubric_version_id),
  UNIQUE (recommendation_id, session_id, organization_id),
  FOREIGN KEY (session_id, organization_id)
    REFERENCES sessions(session_id, org_id)
    ON DELETE CASCADE,
  FOREIGN KEY (rubric_version_id, organization_id, ashby_job_id)
    REFERENCES role_rubric_versions(rubric_version_id, organization_id, ashby_job_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS interview_recommendations_org_job_idx
  ON interview_recommendations(organization_id, ashby_job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reviewer_feedback (
  feedback_id TEXT PRIMARY KEY,
  recommendation_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  reviewer_email TEXT NOT NULL,
  reviewer_decision TEXT NOT NULL CHECK (
    reviewer_decision IN ('advance', 'hold', 'pass', 'needs_more_review')
  ),
  override_reason TEXT,
  dimension_feedback JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (recommendation_id, session_id, organization_id)
    REFERENCES interview_recommendations(recommendation_id, session_id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS reviewer_feedback_recommendation_idx
  ON reviewer_feedback(recommendation_id, created_at DESC);
