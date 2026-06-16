# Fireflies S3 Ingestion Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Near-real-time import of new Fireflies S3 recording folders into Puddle's artifacts bucket and dashboard database using the same idempotent historical import path.

**Architecture:** S3 `ObjectCreated` notifications for `raw/fireflies/` publish to SQS. A backend worker consumes SQS events, derives the recording folder prefix, waits until the folder has required Fireflies files, then invokes the existing historical import executor for exactly that prefix. Imports remain idempotent through existing S3 size checks and `(external_source, external_id)` session upserts.

**Tech Stack:** Node.js/TypeScript, AWS SDK v3 S3/SQS, ECS backend worker, AWS CDK S3/SQS notifications, Postgres/RDS, existing historical Fireflies importer.

---

## Task 1: Source Event And Readiness Module

**Files:**
- Create: `backend/src/weave/fireflies/liveIngestion.ts`
- Create: `backend/test/fireflies-live-ingestion.test.ts`

- [x] **Step 1: Write failing tests**

Test:
- deriving a recording prefix from an S3 key under `raw/fireflies/.../transcript_id=<id>/...`,
- returning `null` for keys outside the Fireflies recording layout,
- readiness requires transcript, metadata, and audio,
- video, summary, and ingestion result are optional,
- the planned import input uses the exact recording prefix and preserves the Puddle/Weave bucket settings.

Run:

```bash
cd backend
npm test -- fireflies-live-ingestion.test.ts
```

Expected: fail because `liveIngestion.ts` does not exist.

- [x] **Step 2: Implement the module**

Create:
- `firefliesRecordingPrefixFromKey(key, sourceRootPrefix)`
- `firefliesRecordingReadiness(recording)`
- `buildSingleRecordingImportInput(options)`

`buildSingleRecordingImportInput()` must pass `sourcePrefix = recording.prefix` and `sourceRootPrefix = raw/fireflies/` so the executor can list/import one folder while parsing the historical layout correctly.

- [x] **Step 3: Run tests**

```bash
cd backend
npm test -- fireflies-live-ingestion.test.ts
```

Expected: pass.

## Task 2: Executor Support For Exact Recording Prefixes

**Files:**
- Modify: `backend/src/weave/fireflies/historicalImportExecutor.ts`
- Modify: `backend/src/weave/fireflies/historicalInventory.ts`
- Modify: `backend/test/fireflies-historical-import-executor.test.ts`
- Modify: `backend/test/fireflies-historical-inventory.test.ts`

- [x] **Step 1: Write failing tests**

Test that the executor can import exactly one folder when:

```ts
sourcePrefix = "raw/fireflies/.../transcript_id=01ABC/"
sourceRootPrefix = "raw/fireflies/"
```

The test must verify only that one folder is planned and copied, without scanning/importing sibling folders.

- [x] **Step 2: Implement executor support**

Add optional `sourceRootPrefix?: string` to `ExecuteHistoricalFirefliesImportInput`.

Use:

```ts
const inventoryRootPrefix = input.sourceRootPrefix ?? input.sourcePrefix;
buildHistoricalFirefliesInventory(keys, inventoryRootPrefix)
```

Keep S3 listing against `input.sourcePrefix`. This lets a one-folder worker list one folder but parse using the root Fireflies layout.

- [x] **Step 3: Run tests**

```bash
cd backend
npm test -- fireflies-historical-import-executor.test.ts fireflies-historical-inventory.test.ts
```

Expected: pass.

## Task 3: SQS Worker

**Files:**
- Create: `backend/src/weave/fireflies/live-ingestion-worker.ts`
- Create: `backend/test/fireflies-live-ingestion-worker.test.ts`
- Modify: `backend/package.json`

- [x] **Step 1: Write failing tests**

Test:
- S3 event records are converted into recording-prefix import attempts,
- incomplete folders are requeued with delay and not imported,
- complete folders invoke the executor in `apply` mode,
- duplicate object events for the same folder are processed idempotently by the same single-folder import path,
- failures are surfaced without printing transcript text.

- [x] **Step 2: Implement worker**

The worker should:
- poll SQS with `ReceiveMessageCommand`,
- parse S3 event JSON from message body,
- derive unique recording prefixes,
- list each folder from S3,
- if incomplete, `ChangeMessageVisibilityCommand` to retry later and leave the message,
- if complete, run the existing importer in `apply` mode for the single folder,
- delete the SQS message after successful complete-folder import,
- use env vars for source/target bucket, regions, queue URL, org ID, DB connections, and Weave DB connections.

Add scripts:

```json
"fireflies-live-ingestion-worker": "node --env-file=../.env.local --import tsx src/weave/fireflies/live-ingestion-worker.ts",
"fireflies-live-ingestion-worker:prod": "node dist/weave/fireflies/live-ingestion-worker.js"
```

- [x] **Step 3: Run tests**

```bash
cd backend
npm test -- fireflies-live-ingestion-worker.test.ts
```

Expected: pass.

## Task 4: Infrastructure Wiring

**Files:**
- Modify: `infra/lib/infra-stack.ts`
- Modify: `infra/package.json` if needed

- [x] **Step 1: Add SQS queue and DLQ**

Add:
- `FirefliesIngestionQueue`
- `FirefliesIngestionDeadLetterQueue`
- retention long enough for retries,
- visibility timeout longer than one import attempt.

- [x] **Step 2: Add S3 notification**

Configure the imported Weave historical recordings bucket to send `s3:ObjectCreated:*` events with prefix `raw/fireflies/` to the queue. Grant S3 permission to send to the queue.

- [x] **Step 3: Add backend worker service**

Create an ECS Fargate service using the backend image with command:

```text
node dist/weave/fireflies/live-ingestion-worker.js
```

Give it the same DB/secrets/S3 permissions as backend plus SQS consume permissions. Set:

```text
FIREFLIES_INGESTION_QUEUE_URL
FIREFLIES_INGESTION_ORG_ID=org_01KV4FF7KX24B76H7Q57QVB5CT
WEAVE_HISTORICAL_RECORDINGS_PREFIX=raw/fireflies/
```

- [x] **Step 4: Build/synth**

Run:

```bash
cd backend
npm run build
cd ../infra
npm run build
npx cdk synth
```

Expected: TypeScript and CDK synth succeed.

## Task 5: End-To-End Verification

**Files:**
- Create: `platform/docs/superpowers/verification/2026-06-16-fireflies-s3-ingestion-bridge.md`

- [x] **Step 1: Run backend targeted tests**

```bash
cd backend
npm test -- fireflies-live-ingestion.test.ts fireflies-live-ingestion-worker.test.ts fireflies-historical-import-executor.test.ts
```

- [x] **Step 2: Run broader build checks**

```bash
cd backend
npm run build
cd ../infra
npm run build
npx cdk synth
```

- [x] **Step 3: Write verification note**

Document test/build/synth outputs and the idempotency guarantees. Do not include transcript text or secrets.

- [x] **Step 4: Commit**

```bash
git add backend infra platform/docs/superpowers/verification/2026-06-16-fireflies-s3-ingestion-bridge.md docs/superpowers/plans/2026-06-16-fireflies-s3-ingestion-bridge.md
git commit -m "Add Fireflies S3 ingestion bridge"
```
