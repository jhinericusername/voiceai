ALTER TABLE interview_ai_control_state
  DROP CONSTRAINT IF EXISTS interview_ai_control_state_requested_state_check;

ALTER TABLE interview_ai_control_state
  ADD CONSTRAINT interview_ai_control_state_requested_state_check
  CHECK (requested_state IN ('running', 'stopped', 'ended'));
