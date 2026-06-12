# Unmatched Fireflies Candidate Association Design

## Goal

Create a repeatable report-only script that proposes candidate/application associations for unmatched historical Fireflies recordings.

## Inputs

- Manual review CSV from the Fireflies reconciliation export.
- Candidate/application pool from the AWS RDS Weave mirror.
- Cutoff date defaults to `2026-04-01`.
- External attendee email exclusions:
  - `app@mintybridge.com`
  - `fire+cal.com@incendiary.media`

## Candidate Pool

The script considers Ashby applications/candidates with interview-like activity after the cutoff date. It excludes candidates and applications already connected to a matched Fireflies recording, because the goal is to find people who still lack a recording association.

## Matching

The first pass is deterministic:

- exact email overlap if present
- name tokens inferred from the attendee email local part
- candidate name tokens
- Fireflies meeting title tokens
- interview/evaluation date proximity
- interview-like stage context

The script can optionally call an external LLM command for borderline rows. The command receives compact JSON on stdin and must return JSON with an optional selected candidate/application and rationale. This keeps the implementation provider-neutral and lets us use GPT, Claude, or another lightweight model without hard-coding one vendor.

## Output

The script writes CSV and JSON reports. Each row contains the Fireflies transcript ID, meeting context, external email, suggested candidate/application, confidence, score, rationale, and top ranked alternatives. It does not mutate the database.
