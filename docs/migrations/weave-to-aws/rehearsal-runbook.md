# Weave to AWS Rehearsal Runbook

Date: 2026-06-10

## Objective

Rehearse moving Weave's Supabase `public` schema into AWS Postgres without touching the live application cutover path.

This runbook intentionally separates:

- Source export from Supabase.
- Target placement in AWS RDS.
- Verification.
- Production cutover approval.

## Known Inputs

Source:

- Supabase project ref: `wzxrxgsvpfoteizjxuwz`
- Supabase DB host: `db.wzxrxgsvpfoteizjxuwz.supabase.co`
- Source schema: `public`

AWS target:

- Region: `us-west-1`
- RDS endpoint: `puddle-videoagent-postgres.c5g48seq8j1c.us-west-1.rds.amazonaws.com`
- RDS port: `5432`
- Current stack DB: `puddle`
- Credentials secret: `/puddle-videoagent/database/credentials`
- RDS is private and reachable from the stack VPC, not directly from the public internet.

## Prerequisites

Install local Postgres client tools if running from a laptop:

```bash
brew install libpq
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
pg_dump --version
psql --version
```

Authenticate Supabase CLI if using CLI-managed dumps:

```bash
supabase login
read -r -s WEAVE_SUPABASE_DB_PASSWORD
supabase link \
  --project-ref wzxrxgsvpfoteizjxuwz \
  --password "$WEAVE_SUPABASE_DB_PASSWORD"
```

If not using `supabase login`, use a direct, percent-encoded source database URL with `supabase db dump --db-url`.

Do not print database passwords or OAuth refresh tokens in terminal output.

## Phase 1: Create Source Dumps

Use a local output directory outside the repo because dumps may contain PII and secrets.

```bash
mkdir -p /tmp/weave-migration-20260610
chmod 700 /tmp/weave-migration-20260610
```

Create a schema-only dump:

```bash
supabase db dump \
  --schema public \
  --file /tmp/weave-migration-20260610/weave-public-schema.sql
```

Create a data-only dump with COPY statements:

```bash
supabase db dump \
  --schema public \
  --data-only \
  --use-copy \
  --file /tmp/weave-migration-20260610/weave-public-data.sql
```

Direct database URL alternative:

```bash
supabase db dump \
  --db-url "$WEAVE_SUPABASE_DATABASE_URL" \
  --schema public \
  --file /tmp/weave-migration-20260610/weave-public-schema.sql

supabase db dump \
  --db-url "$WEAVE_SUPABASE_DATABASE_URL" \
  --schema public \
  --data-only \
  --use-copy \
  --file /tmp/weave-migration-20260610/weave-public-data.sql
```

Use the Weave Supabase database password or direct database URL from the Supabase dashboard or password manager.

## Phase 2: Choose Rehearsal Target

Preferred target:

```text
database: weave_rehearsal_20260610
schema: public
```

Fallback target:

```text
database: puddle
schema: weave_rehearsal_20260610
```

Do not restore Weave's `public` schema into `puddle.public`.

Because the RDS instance is private, run restore commands from one of:

- An ECS one-off migration task in the Puddle VPC.
- An EC2 or CloudShell environment with VPC access.
- A local machine with an approved SSM or VPN tunnel into the VPC.

## Phase 3: Restore Into Rehearsal Target

Fetch the target DB secret in the execution environment without printing it:

```bash
export AWS_REGION=us-west-1
export DB_SECRET_JSON="$(aws secretsmanager get-secret-value \
  --region us-west-1 \
  --secret-id /puddle-videoagent/database/credentials \
  --query SecretString \
  --output text)"
export TARGET_DB_USER="$(printf '%s' "$DB_SECRET_JSON" | jq -r '.username')"
export TARGET_DB_PASSWORD="$(printf '%s' "$DB_SECRET_JSON" | jq -r '.password')"
export TARGET_DB_HOST="puddle-videoagent-postgres.c5g48seq8j1c.us-west-1.rds.amazonaws.com"
export TARGET_DB_PORT="5432"
export TARGET_ADMIN_DB="puddle"
export TARGET_REHEARSAL_DB="weave_rehearsal_20260610"
```

Create the rehearsal database:

```bash
PGPASSWORD="$TARGET_DB_PASSWORD" psql \
  --host "$TARGET_DB_HOST" \
  --port "$TARGET_DB_PORT" \
  --username "$TARGET_DB_USER" \
  --dbname "$TARGET_ADMIN_DB" \
  --set ON_ERROR_STOP=1 \
  --command "create database weave_rehearsal_20260610;"
```

Restore schema:

```bash
PGPASSWORD="$TARGET_DB_PASSWORD" psql \
  --host "$TARGET_DB_HOST" \
  --port "$TARGET_DB_PORT" \
  --username "$TARGET_DB_USER" \
  --dbname "$TARGET_REHEARSAL_DB" \
  --set ON_ERROR_STOP=1 \
  --file /tmp/weave-migration-20260610/weave-public-schema.sql
```

Restore data:

```bash
PGPASSWORD="$TARGET_DB_PASSWORD" psql \
  --host "$TARGET_DB_HOST" \
  --port "$TARGET_DB_PORT" \
  --username "$TARGET_DB_USER" \
  --dbname "$TARGET_REHEARSAL_DB" \
  --set ON_ERROR_STOP=1 \
  --file /tmp/weave-migration-20260610/weave-public-data.sql
```

Run verification:

```bash
PGPASSWORD="$TARGET_DB_PASSWORD" psql \
  --host "$TARGET_DB_HOST" \
  --port "$TARGET_DB_PORT" \
  --username "$TARGET_DB_USER" \
  --dbname "$TARGET_REHEARSAL_DB" \
  --set ON_ERROR_STOP=1 \
  --file docs/migrations/weave-to-aws/verification.sql
```

## Phase 4: Source Verification Snapshot

Run the same verification SQL against Supabase before or immediately after dump creation.

With a direct source database URL:

```bash
psql "$WEAVE_SUPABASE_DATABASE_URL" \
  --set ON_ERROR_STOP=1 \
  --file docs/migrations/weave-to-aws/verification.sql \
  --csv \
  --output /tmp/weave-migration-20260610/source-verification.csv
```

Against AWS target:

```bash
PGPASSWORD="$TARGET_DB_PASSWORD" psql \
  --host "$TARGET_DB_HOST" \
  --port "$TARGET_DB_PORT" \
  --username "$TARGET_DB_USER" \
  --dbname "$TARGET_REHEARSAL_DB" \
  --set ON_ERROR_STOP=1 \
  --file docs/migrations/weave-to-aws/verification.sql \
  --csv \
  --output /tmp/weave-migration-20260610/target-verification.csv
```

Compare:

```bash
diff -u \
  /tmp/weave-migration-20260610/source-verification.csv \
  /tmp/weave-migration-20260610/target-verification.csv
```

Expected result for a full rehearsal is no diff in table counts, FK violation counts, and timestamp maxima.

Storage verification is separate because AWS RDS will not have Supabase's internal `storage` schema. The current source storage inventory is one private `imports` bucket with zero objects, so no object copy is required for the first rehearsal.

## Phase 5: Secret Handling Gate

Before production cutover, decide how to handle `public.gmail_inbox_connections.refresh_token`.

Approved options:

1. Copy into AWS production only, with the target DB treated as production-sensitive.
2. Rotate/reconnect Gmail accounts after cutover and do not copy refresh tokens.
3. Move refresh tokens out of table storage into AWS Secrets Manager, then replace table values with secret references.

Do not copy refresh tokens into a shared/dev target.

## Phase 6: Final Cutover Shape

For a short maintenance window:

1. Pause Weave writers and background sync jobs.
2. Take final schema and data dumps.
3. Restore to production target database `weave`.
4. Run `verification.sql` on source and target.
5. Reset any sequences if schema dump created sequence-backed columns.
6. Point the application to the AWS `weave` database.
7. Run app smoke tests.
8. Resume writers and sync jobs.

For near-zero downtime:

1. Pre-create AWS target schema.
2. Configure logical replication or AWS DMS full-load plus CDC.
3. Let target catch up.
4. Pause writers.
5. Confirm replication lag is zero.
6. Run `verification.sql`.
7. Point the application to AWS.
8. Resume writers.

Given current table size, use the short maintenance window unless product constraints require CDC.
