-- 017_role_active_stage_filters_nullable.sql - preserve unset vs explicitly empty active stages.

ALTER TABLE role_grading_profiles
  ALTER COLUMN active_stage_names DROP DEFAULT,
  ALTER COLUMN active_stage_names DROP NOT NULL;
