-- 012_company_grading.sql - role grading profiles, rubric versions, recommendations, and reviewer feedback.

CREATE TABLE IF NOT EXISTS role_grading_profiles (
  profile_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  ashby_integration_id TEXT NOT NULL REFERENCES ashby_company_integrations(integration_id) ON DELETE CASCADE,
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
  UNIQUE (organization_id, ashby_job_id)
);

CREATE TABLE IF NOT EXISTS role_rubric_versions (
  rubric_version_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES role_grading_profiles(profile_id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  ashby_job_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'archived')),
  rubric JSONB NOT NULL,
  generation_inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by_email TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, version)
);

CREATE INDEX IF NOT EXISTS role_rubric_versions_profile_status_idx
  ON role_rubric_versions(profile_id, status, version DESC);

ALTER TABLE role_grading_profiles
  DROP CONSTRAINT IF EXISTS role_grading_profiles_active_rubric_fk,
  ADD CONSTRAINT role_grading_profiles_active_rubric_fk
    FOREIGN KEY (active_rubric_version_id) REFERENCES role_rubric_versions(rubric_version_id) ON DELETE SET NULL;

ALTER TABLE role_grading_profiles
  DROP CONSTRAINT IF EXISTS role_grading_profiles_draft_rubric_fk,
  ADD CONSTRAINT role_grading_profiles_draft_rubric_fk
    FOREIGN KEY (draft_rubric_version_id) REFERENCES role_rubric_versions(rubric_version_id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS interview_recommendations (
  recommendation_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  ashby_job_id TEXT NOT NULL,
  rubric_version_id TEXT NOT NULL REFERENCES role_rubric_versions(rubric_version_id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('historical_fireflies', 'puddle_live', 'manual_retry')),
  recommendation TEXT NOT NULL CHECK (recommendation IN ('advance', 'hold', 'pass')),
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  category_scores JSONB NOT NULL,
  evidence JSONB NOT NULL,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, rubric_version_id)
);

CREATE INDEX IF NOT EXISTS interview_recommendations_org_job_idx
  ON interview_recommendations(organization_id, ashby_job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reviewer_feedback (
  feedback_id TEXT PRIMARY KEY,
  recommendation_id TEXT NOT NULL REFERENCES interview_recommendations(recommendation_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  reviewer_email TEXT NOT NULL,
  reviewer_decision TEXT NOT NULL CHECK (
    reviewer_decision IN ('advance', 'hold', 'pass', 'needs_more_review')
  ),
  override_reason TEXT,
  dimension_feedback JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reviewer_feedback_recommendation_idx
  ON reviewer_feedback(recommendation_id, created_at DESC);
