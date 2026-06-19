-- 014_interview_recommendations_scorecard_json.sql - persist rich generated scorecard packets.

ALTER TABLE interview_recommendations
  ADD COLUMN IF NOT EXISTS scorecard_json JSONB NOT NULL DEFAULT '{}'::jsonb;
