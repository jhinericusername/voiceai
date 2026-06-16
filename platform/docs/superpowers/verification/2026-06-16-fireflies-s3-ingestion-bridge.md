# Fireflies S3 Ingestion Bridge Verification

Date: 2026-06-16

## Scope

Implemented near-real-time ingestion for new Fireflies S3 recording folders:

- Source S3 `ObjectCreated` events for `raw/fireflies/` publish to a source-region SQS queue.
- A backend ECS worker polls the queue and waits until a recording folder has metadata, transcript, and audio.
- Complete folders are imported through the existing historical Fireflies importer with `sourcePrefix` set to the exact recording folder and `sourceRootPrefix` set to `raw/fireflies/`.
- Imported data uses the same Puddle artifacts bucket layout, Weave match enrichment, JSONB source metadata, S3 size-skip copy behavior, and `(external_source, external_id)` upserts as the historical import.

## Verification Commands

```bash
cd backend
npm test -- fireflies-live-ingestion.test.ts fireflies-live-ingestion-worker.test.ts fireflies-historical-import-executor.test.ts fireflies-historical-inventory.test.ts
```

Result:

```text
Test Files  4 passed (4)
Tests  34 passed (34)
```

```bash
cd backend
npm run build
```

Result:

```text
tsc -p tsconfig.json
```

```bash
cd infra
npm test -- infra.test.ts
```

Result:

```text
Test Suites: 1 passed, 1 total
Tests: 26 passed, 26 total
```

```bash
cd infra
npm run build
```

Result:

```text
tsc
```

```bash
cd infra
npx cdk synth
```

Result:

```text
Default foundation synth succeeded.
```

```bash
cd infra
npx cdk synth -c deployBackendService=true -c liveKitUrl=wss://livekit.example
```

Result:

```text
Successfully synthesized to infra/cdk.out
Stacks available: Puddle-VideoAgent-Infra, Puddle-VideoAgent-Infra-FirefliesSource
```

## Idempotency Notes

- Duplicate S3 object events for the same recording folder are de-duplicated before import.
- Incomplete folders are requeued by changing message visibility; no import or DB write runs until required files are present.
- The worker invokes the existing importer in `apply` mode for exactly one folder.
- Existing destination artifacts are skipped when object size matches.
- Existing sessions are upserted by Fireflies external source identity through the historical repository path.
- The source bucket remains unmodified.

## Deployment Shape

The source Fireflies bucket is in `us-west-2`, while Puddle application services run in `us-west-1`. S3 notifications require same-region destinations, so backend-enabled CDK deployments synthesize:

- `Puddle-VideoAgent-Infra-FirefliesSource`: source-region SQS queue, DLQ, and S3 notification.
- `Puddle-VideoAgent-Infra`: backend ECS worker service that polls the source-region queue cross-region.

The source-region notification stack is gated behind `deployBackendService=true` so foundation-only deploys do not modify the production Fireflies bucket.
