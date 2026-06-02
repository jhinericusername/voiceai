-- 004_recording_artifact_fractional_duration.sql — LiveKit media durations can include milliseconds.

ALTER TABLE recording_artifacts
  ALTER COLUMN duration_seconds TYPE NUMERIC(12,3)
  USING duration_seconds::numeric;
