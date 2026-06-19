-- 016_role_active_stage_filters.sql - per-role Ashby stages that count as active in Puddle.

ALTER TABLE role_grading_profiles
  ADD COLUMN IF NOT EXISTS active_stage_names TEXT[];

CREATE INDEX IF NOT EXISTS role_grading_profiles_active_stage_names_idx
  ON role_grading_profiles USING GIN (active_stage_names);
