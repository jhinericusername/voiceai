# Weave Supabase to AWS Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Weave Supabase `public` schema to AWS Postgres with a verified rehearsal before any production cutover.

**Architecture:** Use native Postgres dump/restore for the first rehearsal because the source database is small and mostly relational. Restore into a separate AWS rehearsal database or schema, run deterministic row-count and FK checks, then choose short-window cutover or CDC based on downtime requirements.

**Tech Stack:** Supabase MCP and Supabase CLI, PostgreSQL `pg_dump`/`psql`, AWS CLI, AWS RDS Postgres, AWS Secrets Manager, S3 for future storage movement.

---

### Task 1: Confirm Inventory And Target Isolation

**Files:**
- Read: `docs/migrations/weave-to-aws/manifest.md`
- Read: `docs/migrations/weave-to-aws/rehearsal-runbook.md`

- [ ] **Step 1: Confirm source project**

Run:

```bash
supabase projects list
```

Expected: output includes project `Weave` with ref `wzxrxgsvpfoteizjxuwz`.

- [ ] **Step 2: Confirm AWS account**

Run:

```bash
aws sts get-caller-identity --output json
```

Expected: account is `851725544921`.

- [ ] **Step 3: Confirm target RDS**

Run:

```bash
aws rds describe-db-instances \
  --region us-west-1 \
  --db-instance-identifier puddle-videoagent-postgres \
  --query 'DBInstances[0].{id:DBInstanceIdentifier,engine:Engine,version:EngineVersion,status:DBInstanceStatus,db:DBName,endpoint:Endpoint.Address,public:PubliclyAccessible}' \
  --output json
```

Expected: `status` is `available`, `db` is `puddle`, and `public` is `false`.

- [ ] **Step 4: Confirm target isolation decision**

Record one of these choices in the migration ticket before any restore:

```text
preferred: create database weave_rehearsal_20260610
fallback: create schema weave_rehearsal_20260610 inside database puddle
```

Expected: Weave is not restored into `puddle.public`.

### Task 2: Prepare Local Migration Tooling

**Files:**
- Read: `docs/migrations/weave-to-aws/rehearsal-runbook.md`

- [ ] **Step 1: Install Postgres client tools**

Run:

```bash
brew install libpq
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
```

Expected: Homebrew installs `libpq`.

- [ ] **Step 2: Verify tool versions**

Run:

```bash
pg_dump --version
psql --version
supabase --version
aws --version
```

Expected: `pg_dump` and `psql` are available. `supabase` is `2.67.1` or newer.

- [ ] **Step 3: Authenticate Supabase CLI**

Run:

```bash
supabase login
read -r -s WEAVE_SUPABASE_DB_PASSWORD
supabase link \
  --project-ref wzxrxgsvpfoteizjxuwz \
  --password "$WEAVE_SUPABASE_DB_PASSWORD"
```

Expected: the local Supabase CLI project is linked to `wzxrxgsvpfoteizjxuwz`.

### Task 3: Create Rehearsal Dumps

**Files:**
- Create runtime-only files under: `/tmp/weave-migration-20260610/`

- [ ] **Step 1: Create private dump directory**

Run:

```bash
mkdir -p /tmp/weave-migration-20260610
chmod 700 /tmp/weave-migration-20260610
```

Expected: directory exists and is user-private.

- [ ] **Step 2: Dump schema**

Run:

```bash
supabase db dump \
  --schema public \
  --file /tmp/weave-migration-20260610/weave-public-schema.sql
```

Expected: `/tmp/weave-migration-20260610/weave-public-schema.sql` exists and contains table/function/view DDL.

- [ ] **Step 3: Dump data**

Run:

```bash
supabase db dump \
  --schema public \
  --data-only \
  --use-copy \
  --file /tmp/weave-migration-20260610/weave-public-data.sql
```

Expected: `/tmp/weave-migration-20260610/weave-public-data.sql` exists and contains COPY data for `public` tables.

### Task 4: Restore Rehearsal Target

**Files:**
- Read: `/tmp/weave-migration-20260610/weave-public-schema.sql`
- Read: `/tmp/weave-migration-20260610/weave-public-data.sql`
- Read: `docs/migrations/weave-to-aws/verification.sql`

- [ ] **Step 1: Export target connection variables**

Run from an environment that can reach the private RDS endpoint:

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

Expected: variables are set without printing the password.

- [ ] **Step 2: Create rehearsal database**

Run:

```bash
PGPASSWORD="$TARGET_DB_PASSWORD" psql \
  --host "$TARGET_DB_HOST" \
  --port "$TARGET_DB_PORT" \
  --username "$TARGET_DB_USER" \
  --dbname "$TARGET_ADMIN_DB" \
  --set ON_ERROR_STOP=1 \
  --command "create database weave_rehearsal_20260610;"
```

Expected: command succeeds.

- [ ] **Step 3: Restore schema**

Run:

```bash
PGPASSWORD="$TARGET_DB_PASSWORD" psql \
  --host "$TARGET_DB_HOST" \
  --port "$TARGET_DB_PORT" \
  --username "$TARGET_DB_USER" \
  --dbname "$TARGET_REHEARSAL_DB" \
  --set ON_ERROR_STOP=1 \
  --file /tmp/weave-migration-20260610/weave-public-schema.sql
```

Expected: command succeeds with no SQL errors.

- [ ] **Step 4: Restore data**

Run:

```bash
PGPASSWORD="$TARGET_DB_PASSWORD" psql \
  --host "$TARGET_DB_HOST" \
  --port "$TARGET_DB_PORT" \
  --username "$TARGET_DB_USER" \
  --dbname "$TARGET_REHEARSAL_DB" \
  --set ON_ERROR_STOP=1 \
  --file /tmp/weave-migration-20260610/weave-public-data.sql
```

Expected: command succeeds with no SQL errors.

### Task 5: Verify Rehearsal

**Files:**
- Read: `docs/migrations/weave-to-aws/verification.sql`

- [ ] **Step 1: Capture source verification**

Run:

```bash
psql "$WEAVE_SUPABASE_DATABASE_URL" \
  --set ON_ERROR_STOP=1 \
  --file docs/migrations/weave-to-aws/verification.sql \
  --csv \
  --output /tmp/weave-migration-20260610/source-verification.csv
```

Expected: CSV file exists.

- [ ] **Step 2: Capture target verification**

Run:

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

Expected: CSV file exists.

- [ ] **Step 3: Compare verification output**

Run:

```bash
diff -u \
  /tmp/weave-migration-20260610/source-verification.csv \
  /tmp/weave-migration-20260610/target-verification.csv
```

Expected: no diff for a full rehearsal.

### Task 6: Cutover Gate

**Files:**
- Read: `docs/migrations/weave-to-aws/manifest.md`

- [ ] **Step 1: Decide `gmail_inbox_connections.refresh_token` handling**

Record one approved choice:

```text
copy to production AWS only
rotate/reconnect Gmail accounts after cutover
move refresh tokens into AWS Secrets Manager and store references in Postgres
```

Expected: no dev/shared copy of refresh tokens occurs.

- [ ] **Step 2: Decide downtime model**

Record one approved choice:

```text
short maintenance window using native dump/restore
near-zero downtime using logical replication or AWS DMS full-load plus CDC
```

Expected: current recommendation is short maintenance window unless product constraints require CDC.

- [ ] **Step 3: Approve production restore**

Run production restore only after Task 5 passes and Tasks 6.1 and 6.2 are approved.

Expected: production cutover is blocked until rehearsal evidence exists.

## Self-Review

Spec coverage: the plan covers live inventory, native dump/restore, target isolation, verification, secret handling, and cutover decisioning.

Placeholder scan: there are no unfinished placeholder markers. Sensitive values are intentionally provided via environment variables and AWS Secrets Manager rather than hardcoded.

Type consistency: database names, project refs, secret names, RDS endpoint, and file paths match the migration manifest and runbook.
