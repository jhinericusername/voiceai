# Pilot-role calibration runbook

The Scorer must be calibrated against the human-scored corpus before it is
trusted to run live interviews. This is the gate the cofounder's
"evaluate before scoring" guidance requires.

## Inputs
- `corpus/` — human-scored interview JSON files (gitignored). Each file:
  `{ interview_id, script_version, transcript[], human_scores{} }`.
- `rubric/pilot-v1.yaml` — the pilot rubric.

## Run
```bash
cd agent && uv run python -m agent.eval.calibrate
```
This replays every corpus interview through the Scorer (standalone mode),
computes agreement (exact-match, within-1, per-category correlation), and
writes `corpus/calibration_report.json`.

## Pass threshold
The default `within_one_rate` pass threshold is 0.85. The Scorer is approved
for live use only when `passes` is true. A failing report blocks the live
voice loop from being relied upon for scoring.

## Oversight
Approving the Scorer for live scoring is a reduction-of-oversight decision:
it requires operator sign-off and, per the compliance requirements,
employment-counsel review before automated scoring influences any decision.
