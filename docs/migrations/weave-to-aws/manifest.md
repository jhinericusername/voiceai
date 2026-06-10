# Weave Supabase to AWS Migration Manifest

Date: 2026-06-10

## Scope

This manifest covers the current Supabase project named `Weave`.

Source:

- Supabase project ref: `wzxrxgsvpfoteizjxuwz`
- Supabase region: `us-west-2`
- Source Postgres: `17.6`
- Source schemas in scope: `public`, selected `storage` metadata

AWS targets discovered:

- AWS account: `851725544921`
- Puddle dev stack: `Puddle-VideoAgent-Infra`
- RDS instance: `puddle-videoagent-postgres`
- RDS engine: Postgres `16.13`
- RDS endpoint: `puddle-videoagent-postgres.c5g48seq8j1c.us-west-1.rds.amazonaws.com:5432`
- RDS database created by stack: `puddle`
- RDS public access: `false`
- RDS security group: `sg-0a2b2f5f22fe852fb`
- RDS subnets: `subnet-08fd2c011982210f9`, `subnet-024061abe6d77cda9`
- Database credentials secret: `/puddle-videoagent/database/credentials`
- Artifact bucket: `puddle-videoagent-artifacts-851725544921-us-west-1`
- Artifact bucket region: `us-west-1`
- Artifact bucket versioning: `Enabled`

## Target Placement Decision

Do not restore Weave's `public` schema into the existing `puddle` database `public` schema.

The safe rehearsal target is one of:

- Preferred: a separate database on the same RDS instance named `weave_rehearsal_20260610`.
- Fallback: a separate schema inside the existing `puddle` database named `weave_rehearsal_20260610`.

The production target should be a separate database named `weave`, unless the app is deliberately being folded into the Puddle schema.

## Current Source Inventory

All current source `public` tables have RLS enabled.

| Table | Rows | Size bytes | Primary key | Classification | Contains PII or secrets | Migration mode | Verification |
|---|---:|---:|---|---|---|---|---|
| `application_review_decisions` | 1 | 81920 | `id` | Decision workflow | PII-adjacent, hiring decision | Full copy | Row count, FK to `ashby_applications`, sample checksum |
| `ashby_application_stage_history` | 4439 | 4014080 | `ashby_history_id` | Ashby mirror, event history | Candidate/application PII in linked raw data | Full copy | Row count, FK to `ashby_applications`, max timestamp |
| `ashby_applications` | 2560 | 21159936 | `ashby_application_id` | Ashby mirror, core | Candidate/application PII, raw JSON | Full copy | Row count, FK to candidates/jobs, max `ashby_updated_at` |
| `ashby_candidates` | 2271 | 6545408 | `ashby_candidate_id` | Ashby mirror, core | Candidate PII, raw JSON | Full copy | Row count, primary key count, max `ashby_updated_at` |
| `ashby_hiring_metadata` | 46 | 106496 | `metadata_type, ashby_id` | Ashby reference metadata | Low, may include user/team names | Full copy | Row count, primary key count |
| `ashby_interview_stages` | 70 | 147456 | `ashby_stage_id` | Ashby reference metadata | Low | Full copy | Row count, primary key count |
| `ashby_jobs` | 9 | 122880 | `ashby_job_id` | Ashby reference metadata | Low to moderate | Full copy | Row count, primary key count |
| `ashby_sync_runs` | 1110 | 1908736 | `id` | Sync operational history | Error payloads may contain PII | Copy for prod, optional for rehearsal | Row count, status distribution |
| `ashby_sync_state` | 10 | 81920 | `endpoint` | Sync cursor state | Cursor values | Cutover-only copy | Row count, endpoint list |
| `ashby_webhook_events` | 2810 | 11960320 | `id` | Webhook audit/event log | Raw webhook payload may contain PII | Full copy or archive | Row count, max `created_at` |
| `candidate_communications` | 655 | 1736704 | `id` | Gmail-derived communication index | Email addresses, subject/snippet, raw JSON | Full copy for prod, sanitize for rehearsal | Row count, FK checks, max internal date |
| `candidate_evaluations` | 237 | 344064 | `id` | Scoring/evaluation | Candidate PII and sensitive assessment data | Full copy | Row count, FK checks, score aggregate |
| `email_stage_rules` | 1 | 65536 | `id` | Email workflow config | Low | Full copy | Row count |
| `email_templates` | 1 | 49152 | `id` | Email workflow config | May contain outbound email body | Full copy | Row count |
| `email_workflow_test_candidates` | 0 | 24576 | `id` | Test workflow | Test PII if populated later | Copy schema, no data required now | Row count equals 0 |
| `email_workflow_test_events` | 0 | 32768 | `id` | Test workflow | Test email content if populated later | Copy schema, no data required now | Row count equals 0 |
| `gmail_inbox_connections` | 2 | 155648 | `id` | Gmail integration credentials/state | Contains Google email and `refresh_token` secret | Prod copy only after secret decision; exclude or scrub in rehearsal | Row count, active connection count, token handling signoff |
| `gmail_sync_runs` | 20363 | 28262400 | `id` | Gmail sync operational history | Errors/stats may contain PII | Copy recent history or archive full history | Row count, status distribution |
| `ingestion_presented_information` | 8 | 262144 | `id` | Target ingestion output | Candidate profile PII | Full copy | Row count, FK checks |
| `rubric_dimensions` | 4 | 65536 | `key` | Rubric config | No | Full copy | Row count, key set |
| `rubric_score_levels` | 16 | 32768 | `dimension_key, score` | Rubric config | No | Full copy | Row count, FK to `rubric_dimensions` |
| `rubric_settings` | 1 | 32768 | `key` | Rubric config | No | Full copy | Row count |
| `target_ingestions` | 8 | 245760 | `id` | Target ingestion input/workflow | LinkedIn URLs, pasted profile data, raw JSON | Full copy for prod, sanitize for rehearsal | Row count, status distribution |
| `target_page_publish_notification_settings` | 1 | 32768 | `id` | Slack notification config | User id/email fields may appear | Full copy | Row count |
| `target_page_publish_notifications` | 8 | 81920 | `id` | Slack notification events | Slack channel/message metadata | Full copy | Row count, FK checks |

## Storage Inventory

| Bucket | Public | Type | Limit | Allowed MIME types | Objects | Bytes | Migration mode |
|---|---|---|---:|---|---:|---:|---|
| `imports` | false | `STANDARD` | 10485760 | `text/csv`, `application/vnd.ms-excel` | 0 | 0 | Create matching bucket or prefix only; no object copy currently needed |

## Dependency Edges

Foreign key parents must exist before children when using plain inserts.

| Child | Column | Parent | Parent column | Delete rule |
|---|---|---|---|---|
| `application_review_decisions` | `ashby_application_id` | `ashby_applications` | `ashby_application_id` | `CASCADE` |
| `ashby_application_stage_history` | `ashby_application_id` | `ashby_applications` | `ashby_application_id` | `CASCADE` |
| `ashby_applications` | `ashby_candidate_id` | `ashby_candidates` | `ashby_candidate_id` | `SET NULL` |
| `ashby_applications` | `ashby_job_id` | `ashby_jobs` | `ashby_job_id` | `SET NULL` |
| `candidate_communications` | `gmail_connection_id` | `gmail_inbox_connections` | `id` | `CASCADE` |
| `candidate_communications` | `linked_ashby_application_id` | `ashby_applications` | `ashby_application_id` | `SET NULL` |
| `candidate_communications` | `linked_ashby_candidate_id` | `ashby_candidates` | `ashby_candidate_id` | `SET NULL` |
| `candidate_communications` | `linked_ashby_job_id` | `ashby_jobs` | `ashby_job_id` | `SET NULL` |
| `candidate_evaluations` | `ashby_application_id` | `ashby_applications` | `ashby_application_id` | `SET NULL` |
| `candidate_evaluations` | `ashby_candidate_id` | `ashby_candidates` | `ashby_candidate_id` | `SET NULL` |
| `candidate_evaluations` | `ashby_job_id` | `ashby_jobs` | `ashby_job_id` | `SET NULL` |
| `email_stage_rules` | `template_id` | `email_templates` | `id` | `RESTRICT` |
| `email_workflow_test_events` | `template_id` | `email_templates` | `id` | `SET NULL` |
| `email_workflow_test_events` | `test_candidate_id` | `email_workflow_test_candidates` | `id` | `CASCADE` |
| `gmail_sync_runs` | `gmail_connection_id` | `gmail_inbox_connections` | `id` | `CASCADE` |
| `ingestion_presented_information` | `target_ingestion_id` | `target_ingestions` | `id` | `CASCADE` |
| `rubric_score_levels` | `dimension_key` | `rubric_dimensions` | `key` | `CASCADE` |
| `target_page_publish_notifications` | `presented_information_id` | `ingestion_presented_information` | `id` | `CASCADE` |
| `target_page_publish_notifications` | `target_ingestion_id` | `target_ingestions` | `id` | `SET NULL` |

## Database Objects Beyond Tables

View:

- `active_pipeline_applications_v1`

Functions:

- `claim_target_ingestions_v1(p_limit integer)` - `SECURITY DEFINER`
- `set_updated_at()` - normal invoker
- `target_ingestion_dispatch_presentation_backfill_v1(p_limit integer DEFAULT 50)` - `SECURITY DEFINER`
- `target_ingestion_dispatch_worker_v1(p_target_ingestion_id uuid, p_phase text DEFAULT 'normalize'::text)` - `SECURITY DEFINER`
- `target_ingestion_set_updated_at_v1()` - normal invoker
- `target_ingestions_dispatch_on_insert_v1()` - `SECURITY DEFINER`
- `target_ingestions_dispatch_presented_on_ready_v1()` - `SECURITY DEFINER`

Important security note: the `SECURITY DEFINER` functions live in `public`. In Supabase this is a known risk pattern for exposed schemas. The AWS target should either keep these functions private behind app-only DB credentials or move them into a private schema before exposing any API surface.

## Rehearsal Policy

The first rehearsal should not move live secrets.

Use one of these two rehearsal data modes:

1. Full operational rehearsal, production-like:
   - Includes all tables.
   - Requires explicit approval to copy `gmail_inbox_connections.refresh_token`.
   - Target must be access-restricted and treated as production-sensitive.

2. Sanitized rehearsal, safer default:
   - Excludes `gmail_inbox_connections` data or sets `refresh_token = null` in a transformed restore.
   - Includes all non-secret tables.
   - Validates schema, FK shape, and app read paths without copying OAuth secrets.

## Cutover Recommendation

For the current database size, prefer native Postgres dump/restore for rehearsal and final cutover.

Use DMS or logical replication only if the final downtime window is not acceptable or if Weave keeps writing heavily during cutover. If DMS is used, pre-create the schema and constraints, use table mapping from this manifest, and reset sequences after CDC stops.
