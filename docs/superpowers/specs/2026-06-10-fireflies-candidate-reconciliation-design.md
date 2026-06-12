# Fireflies Application Reconciliation Design

## Goal

Create an explicit, auditable relation between historical Fireflies recording folders in S3 and the Weave Ashby application rows for the people who were actually interviewed.

## Current Context

- Historical Fireflies artifacts live in `s3://weave-fireflies-prod-851725544921-us-west-2/raw/fireflies/`.
- The bucket has 322 logical Fireflies folders. Media and transcripts stay in S3; Postgres stores object keys and match evidence.
- The AWS RDS Weave mirror currently has 2,278 candidates, 2,568 applications, 239 candidate evaluations, and historical Ashby application stage-history rows.
- A candidate can have multiple Ashby applications. Candidate identity is therefore not sufficient for dashboard or interview-pipeline linking.
- The applied application-first reconciliation indexes all recordings and currently produces 267 automatic matches, 17 ambiguous recordings, and 38 unmatched recordings.

## Identity Model

`ashby_candidates`

- Primary key: `ashby_candidate_id`.
- Meaning: the person.
- Used as context and email evidence, not as the primary interview-pipeline identity.

`ashby_applications`

- Primary key: `ashby_application_id`.
- Meaning: the person in a specific job/pipeline.
- This is the target identity for screening dashboard rows and Fireflies interview association.

`weave_fireflies_recordings`

- Primary key: `fireflies_transcript_id`.
- Meaning: the external Fireflies artifact folder.
- Stores selected `ashby_application_id`, `ashby_candidate_id`, `ashby_job_id`, and optional `candidate_evaluation_id` only when a match is high-confidence or manually decided.
- Stores `decision_source`, `decision_reason`, and `decided_at` for auditability.

`weave_fireflies_recording_match_candidates`

- Primary key: synthetic `id`.
- Semantic uniqueness: one option per `fireflies_transcript_id`, `ashby_application_id`, and `candidate_evaluation_id`.
- Keeps mutable rank, score, evidence reasons, stage evidence, active-application evidence, and matched email for manual review.

## Match Rules

Automatic match requires one unique top application option after score and tie-breaker evidence, with score >= 88.

Scores:

- `100`: email match plus exact `candidate_evaluations.interview_date`.
- `96`: email match plus relevant Ashby stage covering the Fireflies meeting date.
- `94`: email match plus relevant Ashby stage transition within 3 days of the meeting date.
- `92`: email match plus exactly one active application for the candidate on the meeting date.
- `90`: email match plus adjacent evaluation date.
- `88`: email match plus candidate has exactly one application.
- `84`: candidate name appears in Fireflies title plus relevant stage covering the meeting date.
- `82`: candidate name appears in Fireflies title plus relevant stage transition within 3 days.
- `75`: email match only; manual review.
- `70`: exact evaluation date plus candidate name in title; manual review.

Relevant Ashby stages are titles matching screen, interview, chat, top grade, or take home.

## Manual Review

The manual-review report should group by Fireflies recording and show ranked application options, not just candidate options. Reviewers should choose the application row, with candidate/job/evaluation shown as context.

Residual manual rows are expected when there is only weak email evidence, multiple equal application options, no stage-history signal, or no candidate email overlap.

## Safety

- The backfill is idempotent: it upserts Fireflies rows by transcript ID and replaces ranked options for the imported transcript set.
- Existing manual decisions are preserved on re-run.
- No S3 objects are modified.
- No raw transcript text is copied into Postgres.
- Candidate-identifying review files stay local and are not pasted into chat.

## Verification

- Unit tests cover Fireflies JSON extraction, object-key construction, email normalization, SQL generation, stage-history scoring, and schema migration expectations.
- Dry-run SQL reports status counts, candidate rows, score distribution, and match-confidence distribution before mutation.
- Live apply is allowed only after dry-run counts show plausible application-level improvements.
