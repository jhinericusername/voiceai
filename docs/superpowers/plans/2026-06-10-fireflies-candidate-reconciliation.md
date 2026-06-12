# Fireflies Application Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile historical Fireflies recordings to Ashby applications, not just candidates, and shrink the manual-review set with stage-history evidence.

**Architecture:** Keep one recording row per Fireflies transcript, keep ranked match options in a separate table, and score options inside Postgres using email, evaluation dates, Ashby stage windows, stage transitions, and active-application context. Run dry-run SQL against AWS RDS before applying.

**Tech Stack:** TypeScript, Vitest, Postgres SQL, AWS S3, AWS ECS/Fargate, AWS RDS Postgres.

---

### Task 1: Add Red Tests

**Files:**
- Modify: `backend/test/fireflies-reconciliation.test.ts`
- Modify: `backend/test/migrations.test.ts`

- [x] Add a failing SQL-generation test that expects stage-history scoring terms: `ashby_application_stage_history`, `relevant_stage_on_meeting_date`, `relevant_stage_transition_near_meeting_date`, `application_active_on_meeting_date`, and `email_and_stage_on_meeting_date`.
- [x] Add a failing migration test that expects `002_fireflies_application_reconciliation.sql`, decision metadata, a stable `id` primary key for match options, and a semantic unique option index.
- [x] Run `npm test -- --run test/fireflies-reconciliation.test.ts test/migrations.test.ts` from `backend` and confirm the tests fail for missing implementation.

### Task 2: Implement Application-First Scoring

**Files:**
- Modify: `backend/src/weave/fireflies/import.ts`

- [x] Add `relevant_stage_history`, `stage_signal`, and `active_application_counts` CTEs.
- [x] Score email plus exact evaluation date at `100`.
- [x] Score email plus relevant stage covering the meeting date at `96`.
- [x] Score email plus relevant stage transition within 3 days at `94`.
- [x] Score email plus only active application on meeting date at `92`.
- [x] Keep email plus adjacent evaluation date at `90` and email plus single application at `88`.
- [x] Keep email-only evidence at `75` so it remains manual.
- [x] Preserve future manual decisions when re-running the generated apply SQL.

### Task 3: Add Schema Migration

**Files:**
- Modify: `backend/weave-migrations/001_fireflies_reconciliation.sql`
- Create: `backend/weave-migrations/002_fireflies_application_reconciliation.sql`

- [x] Add decision metadata columns to recording rows.
- [x] Add stage and active-application evidence columns to match options.
- [x] Migrate match options from rank-based primary key to stable synthetic `id`.
- [x] Add semantic uniqueness for `fireflies_transcript_id`, `ashby_application_id`, and `candidate_evaluation_id`.
- [x] Rerun focused tests and confirm they pass.

### Task 4: Verify Locally

**Files:**
- No additional files.

- [x] Run `npm run build` in `backend`.
- [x] Run `npm test` in `backend`.
- [x] Fix any failures without widening scope.

### Task 5: Dry-Run Against AWS RDS

**Files:**
- Generate only in `/tmp`.

- [x] Download Fireflies JSON metadata from `s3://weave-fireflies-prod-851725544921-us-west-2/raw/fireflies/` to `/tmp/weave-fireflies-json-application`.
- [x] Concatenate Weave migrations into `/tmp/weave-fireflies-application-schema.sql`.
- [x] Generate `/tmp/weave-fireflies-application-dry-run.sql` with `backend/dist/weave/fireflies/import.js`.
- [x] Upload dry-run SQL to the app artifacts bucket.
- [x] Run it through a private Fargate task against AWS RDS `weave`.
- [x] Confirm status counts, score distribution, and manual-review counts are plausible.
- [x] Tighten top-option tie counting so score ties use the same tie-breaker evidence as the selected option.

### Task 6: Apply and Export Review Report

**Files:**
- Generate only in `/tmp`.

- [x] Generate apply SQL with schema migrations included.
- [x] Run apply SQL through the same private Fargate path.
- [x] Query final match counts from `weave_fireflies_recordings`.
- [x] Export a fresh full-detail manual-review CSV to `/tmp/weave-fireflies-application-manual-review-full.csv`.
- [x] Delete temporary SQL artifacts from S3 and deregister temporary ECS task definitions.

Final applied counts:

- 322 Fireflies recordings indexed.
- 267 matched.
- 17 ambiguous.
- 38 unmatched.
- Manual-review CSV: `/tmp/weave-fireflies-application-manual-review-full.csv`, 78 rows, 55 unique recordings.
