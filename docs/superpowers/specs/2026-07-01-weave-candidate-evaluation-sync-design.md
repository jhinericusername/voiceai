# Weave Candidate Evaluation Sync Design

## Summary

Puddle should migrate Weave candidate evaluation ratings, comments, and related
Ashby identifiers from the Weave Supabase project into the Puddle RDS database.
After migration, Puddle dashboards must read only from Puddle-owned AWS
infrastructure. Supabase remains an upstream event source for future changes; it
must not be queried by normal Puddle application request paths.

The work has two parts:

- a one-time backfill for all existing Weave candidate evaluations, and
- an ongoing inbound sync path for future inserts and updates from Weave
  Supabase.

AWS infrastructure should be reusable for future external integrations. The
Weave-specific behavior belongs in a source adapter, SQL hook, and backfill job,
not in a Weave-only CDK stack.

## Goals

1. Copy every Weave `candidate_evaluations` row into Puddle RDS, including
   ratings, total score, comments, Ashby application ID, Ashby candidate ID,
   Ashby job ID, candidate name, interview date, and source timestamps.
2. Ensure imported data is credited to the Weave WorkOS organization and remains
   separable from future companies.
3. Upsert missing Puddle-side Ashby application and role rows needed to store and
   display every evaluation.
4. Store ratings in the Puddle data model that candidate and interview
   dashboards read.
5. Keep normal Puddle app runtime paths independent of Supabase.
6. Add a durable, observable hook path for future Supabase inserts and updates.
7. Make the AWS-side ingestion infrastructure generic enough to support other
   integrations later.

## Non-Goals

- No Puddle frontend Supabase client.
- No Puddle backend dashboard query that calls Supabase.
- No Weave-specific long-lived CDK stack.
- No automatic hiring action, candidate communication, or workflow decision from
  imported scores.
- No reliance on email domain as a tenant boundary. WorkOS organization ID is
  the tenant boundary.

## Current Context

The Puddle app already has org-scoped Ashby and grading tables:

- `ashby_company_integrations` maps an Ashby integration to a WorkOS
  `organization_id`.
- `role_grading_profiles` maps `organization_id`, `ashby_integration_id`, and
  `ashby_job_id` to a Puddle role profile. It has a uniqueness constraint on
  `(organization_id, ashby_job_id)`.
- `ashby_applications` stores application-level Ashby records scoped by
  `integration_id`.
- `ashby_candidate_scores` stores human-style candidate dimensions and comments
  scoped by `integration_id` and `application_id`.
- `interview_recommendations` and `reviewer_feedback` are already
  org-scoped and are used by the interview dashboard.

The Weave Supabase project currently has `candidate_evaluations` with:

- `id`
- `candidate_name`
- `interview_date`
- `problem_solving`
- `agency`
- `competitiveness`
- `curious`
- generated `sum`
- `comments`
- `ashby_application_id`
- `ashby_candidate_id`
- `ashby_job_id`
- `created_at`
- `updated_at`

The existing RDS `weave` database mirror is stale relative to Supabase. The
Puddle dashboards therefore need a direct Puddle RDS import/sync, not a runtime
read from the stale mirror.

## Architecture

```text
Weave Supabase candidate_evaluations
  -> Supabase trigger / pg_net webhook
  -> AWS generic external integration ingress
  -> durable event handling
  -> Weave candidate evaluation adapter
  -> Puddle RDS tables
  -> candidate and interview dashboards
```

The one-time backfill follows the same transformation code as the ongoing hook
path, but it runs as an explicit migration job rather than through the webhook.

## AWS Infrastructure

CDK should own reusable AWS plumbing only:

- webhook secret in AWS Secrets Manager or SSM Parameter Store,
- inbound integration endpoint configuration on the existing ECS/API path,
- SQS queue and dead-letter queue for durable async processing,
- ECS task or worker permissions,
- CloudWatch logs and alarms,
- environment variables for enabled external sources.

The production path is:

```text
HTTP ingress -> validate source and secret -> enqueue event -> worker upsert
```

The HTTP ingress should acknowledge valid events only after enqueueing them. A
worker should own Puddle RDS writes. This keeps Supabase delivery independent of
transient database latency or worker failures.

## Supabase Hook

The Weave Supabase setup should be represented as committed SQL, not a manual
dashboard-only configuration.

The SQL should:

- create a trigger on `candidate_evaluations` for insert and update,
- use Supabase `pg_net` / database webhook behavior to POST JSON to the AWS
  ingress endpoint,
- include a source identifier such as
  `weave_supabase_candidate_evaluation`,
- include a shared secret or signature header,
- send the new row payload and enough operation metadata to process the event
  idempotently,
- avoid exposing Puddle database credentials to Supabase.

Supabase should only push events out. Puddle should not query Supabase in
normal app request paths.

## Puddle Data Model

The existing org and role separation model is sufficient for V1:

- `ashby_company_integrations.organization_id` credits the data to the Weave
  WorkOS org.
- `role_grading_profiles` maps the Weave org and Ashby job to a Puddle role.
- `ashby_applications.integration_id` scopes candidate applications to the
  org's Ashby integration.
- `ashby_candidate_scores.integration_id` and `application_id` scope imported
  ratings to the correct org/application.

The sync should not add a redundant org-to-role table.

Add a small provenance table in the Puddle database to make the migration
idempotent and auditable:

```text
weave_candidate_evaluation_imports
  source_evaluation_id text primary key
  organization_id text not null
  integration_id text not null
  application_id text not null
  ashby_candidate_id text null
  ashby_job_id text not null
  role_profile_id text null
  score_id text null
  source_created_at timestamptz null
  source_updated_at timestamptz null
  source_payload_hash text not null
  last_event_id text null
  last_synced_at timestamptz not null
  sync_status text not null
  sync_error text null
```

This table gives each Puddle score an explicit source lineage without changing
the dashboard tenant model.

## Transformation Rules

For each Weave candidate evaluation:

1. Resolve the Weave organization to the configured WorkOS `organization_id`.
2. Resolve the org's Ashby integration from `ashby_company_integrations`.
3. Upsert the Puddle `ashby_applications` row if it is missing.
4. Upsert the `role_grading_profiles` row for
   `(organization_id, ashby_job_id)` if it is missing.
5. Upsert `ashby_candidate_scores` for the application using:
   - `problem_solving` -> `problem_solving`
   - `agency` -> `agency`
   - `competitiveness` -> `competitiveness`
   - `curious` -> `curiosity`
   - `sum` -> `total_score`
   - `comments` -> `comments`
6. Upsert the provenance row with source IDs, source timestamps, payload hash,
   target row IDs, and sync status.

The score reviewer identity should be a stable system reviewer value such as
`weave-import@puddle.system`, unless the source row later exposes a real
reviewer identity.

## Dashboard Behavior

Candidate dashboard changes should read imported scores from Puddle RDS only.
The dashboard can show the latest imported score/comment for each candidate
application and should preserve org scoping through the existing integration
lookup.

Interview dashboard changes should also read only from Puddle RDS. When a
historical interview session is linked to a Weave `candidate_evaluations.id` or
matching Ashby application, the UI should surface the imported score/comment in
a small imported evaluation section.

The sync should not create synthetic `interview_recommendations` rows in V1.
Those rows represent Puddle-generated recommendations, while the Weave import is
human/historical evaluation data.

## Backfill Job

The backfill should run as a controlled job with:

- dry-run mode,
- row counts by status,
- missing integration/application/role counts,
- idempotent upserts,
- batch processing,
- transaction boundaries per batch or per row group,
- clear error reporting without logging secrets,
- final verification queries against Puddle RDS.

For local development, the job may run through the existing RDS tunnel. For
production, it should run as an ECS one-off task inside AWS.

The backfill must create missing Puddle-side application and role rows for
Weave-evaluated candidates so every evaluation can be stored.

## Ongoing Sync Behavior

The hook path should be idempotent:

- duplicate events should not duplicate scores,
- older source payloads should not overwrite newer imported data,
- update events should refresh score values and comments,
- invalid events should be rejected before database writes,
- processing failures should be observable and retryable.

Failed messages should land in a DLQ with enough metadata to replay after a
fix.

## Security

- Supabase must not receive Puddle database credentials.
- The AWS endpoint must authenticate webhook events with a shared secret or
  equivalent signature.
- Secrets must live in AWS-managed secret storage.
- Logs must not print webhook secrets, database credentials, or candidate
  payloads unnecessarily.
- Tenant ownership must be derived from configured WorkOS organization IDs and
  Ashby integration rows, not from email domains.
- Existing dashboard access checks must continue to enforce org membership.

## Testing And Verification

Implementation should include:

- unit tests for Weave evaluation payload validation,
- unit tests for transformation and idempotency behavior,
- repository tests for generated SQL/upsert behavior where practical,
- route or worker tests for webhook validation and enqueue/process behavior,
- dry-run backfill verification before writes,
- post-backfill counts comparing source evaluation count to imported
  provenance rows and visible dashboard score rows,
- a dashboard data-path test proving imported scores are returned from Puddle
  RDS without Supabase access.

Manual production gates remain required before:

- creating or changing Puddle RDS schema,
- running a bulk production backfill,
- enabling the Supabase outbound hook,
- deploying new AWS ingress infrastructure.

## Final Design Decisions

1. V1 uses SQS plus a dead-letter queue for ongoing hooks.
2. Imported Weave scores are stored as imported evaluation data and candidate
   scores, not as synthetic Puddle-generated interview recommendations.
3. Production backfill runs as an ECS one-off task inside AWS. Local dry runs may
   use the existing RDS tunnel.
