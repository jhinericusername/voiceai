# Weave Candidate Evaluation Sync Runbook

This runbook deploys the Weave Supabase candidate evaluation sync into Puddle AWS/RDS. Normal Puddle app runtime does not read Supabase: Supabase only pushes `candidate_evaluations` events to the AWS ingress endpoint, and the Puddle app reads imported rows from Puddle RDS.

Manual production gates are required before applying the RDS migration, deploying CDK changes, applying the Supabase hook, or running a full production backfill.

## Placeholders

Set these values in the operator shell or replace them in the commands below:

```sh
export AWS_PROFILE="<prod-or-stage-profile>"
export AWS_REGION="us-west-1"
export PUDDLE_ENV_NAME="prod"
export PUDDLE_STACK_NAME="Puddle-VideoAgent-Infra"
export BACKEND_IMAGE_TAG="<git-sha-or-release-tag>"
export PLATFORM_IMAGE_TAG="<git-sha-or-release-tag>"
export LIVEKIT_URL="wss://<livekit-host>"
export PUDDLE_PUBLIC_BASE_URL="https://<puddle-platform-host>"
export PUDDLE_BACKEND_BASE_URL="https://<public-or-proxied-backend-host>"
export WEAVE_ORG_ID="org_01KV4FF7KX24B76H7Q57QVB5CT"
export WEBHOOK_SECRET_VALUE="<generated-high-entropy-secret>"
export JSONL_INPUT="<path-to-weave-candidate-evaluation-events.jsonl>"
```

The webhook URL sent from Supabase must target the backend route:

```sh
export WEAVE_WEBHOOK_URL="${PUDDLE_BACKEND_BASE_URL}/integrations/weave/candidate-evaluations/webhook"
```

## Prerequisite Checks

Confirm the branch and artifacts:

```sh
git status --short --branch
test -f backend/migrations/019_weave_candidate_evaluation_imports.sql
test -f supabase/weave_candidate_evaluation_hooks.sql
test -f docs/runbooks/weave-candidate-evaluation-sync.md
```

Confirm the app has no normal runtime Supabase dependency for this sync:

```sh
rg -n "supabase-js|createClient|NEXT_PUBLIC_SUPABASE" backend/src platform/app platform/lib
```

Expected: no new runtime Supabase client usage from this sync. Existing unrelated matches must be reviewed before the production gate.

Confirm backend tests and infra tests have passed for the release candidate:

```sh
npm --prefix backend test -- weave-candidate-evaluations
npm --prefix backend test -- ashby-repository.test.ts dashboard-interviews.test.ts
npm --prefix infra test
```

## Gate 1: CDK Synth And Deploy

Synthesize first. This is a read-only planning check:

```sh
cd infra
npm run cdk -- synth \
  -c envName="${PUDDLE_ENV_NAME}" \
  -c region="${AWS_REGION}" \
  -c deployBackendService=true \
  -c backendImageTag="${BACKEND_IMAGE_TAG}" \
  -c liveKitUrl="${LIVEKIT_URL}" \
  -c enableLiveKitRecordings=true \
  -c platformHosting=container \
  -c platformImageTag="${PLATFORM_IMAGE_TAG}"
```

Manual approval gate: do not deploy until the synthesized diff is reviewed and approved.

After approval:

```sh
cd infra
npm run cdk -- deploy \
  -c envName="${PUDDLE_ENV_NAME}" \
  -c region="${AWS_REGION}" \
  -c deployBackendService=true \
  -c backendImageTag="${BACKEND_IMAGE_TAG}" \
  -c liveKitUrl="${LIVEKIT_URL}" \
  -c enableLiveKitRecordings=true \
  -c platformHosting=container \
  -c platformImageTag="${PLATFORM_IMAGE_TAG}"
```

Capture outputs:

```sh
aws cloudformation describe-stacks \
  --stack-name "${PUDDLE_STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='ExternalIntegrationWebhookSecretSecretName' || OutputKey=='ExternalIntegrationIngressQueueUrl' || OutputKey=='ExternalIntegrationIngressDeadLetterQueueUrl' || OutputKey=='WeaveCandidateEvaluationsWorkerServiceName' || OutputKey=='BackendMigrationTaskDefinitionArn' || OutputKey=='BackendTasksSecurityGroupId' || OutputKey=='PrivateSubnetIds' || OutputKey=='ClusterName' || OutputKey=='BackendInternalBaseUrl' || OutputKey=='BackendLogGroupName'].[OutputKey,OutputValue]" \
  --output table
```

## Gate 2: Puddle RDS Migration

Manual approval gate: do not apply `backend/migrations/019_weave_candidate_evaluation_imports.sql` to production RDS without approval.

After approval, run the existing backend migration task in the private subnets. Fill values from CloudFormation outputs:

```sh
export CLUSTER_NAME="<ClusterName>"
export MIGRATION_TASK_DEFINITION_ARN="<BackendMigrationTaskDefinitionArn>"
export BACKEND_TASKS_SECURITY_GROUP_ID="<BackendTasksSecurityGroupId>"
export PRIVATE_SUBNET_IDS="<comma-separated-PrivateSubnetIds>"

aws ecs run-task \
  --cluster "${CLUSTER_NAME}" \
  --launch-type FARGATE \
  --task-definition "${MIGRATION_TASK_DEFINITION_ARN}" \
  --network-configuration "awsvpcConfiguration={subnets=[${PRIVATE_SUBNET_IDS}],securityGroups=[${BACKEND_TASKS_SECURITY_GROUP_ID}],assignPublicIp=DISABLED}"
```

Wait for completion and verify the migration task exited 0 before proceeding.

## Gate 3: AWS Webhook Secret

Write or rotate the external integration webhook secret in AWS Secrets Manager only after CDK has created the secret placeholder:

```sh
export EXTERNAL_WEBHOOK_SECRET_NAME="<ExternalIntegrationWebhookSecretSecretName>"

aws secretsmanager put-secret-value \
  --secret-id "${EXTERNAL_WEBHOOK_SECRET_NAME}" \
  --secret-string "${WEBHOOK_SECRET_VALUE}"
```

Restart the backend service and Weave candidate evaluations worker after rotation so the new secret is loaded by ECS tasks:

```sh
aws ecs update-service --cluster "${CLUSTER_NAME}" --service "<BackendServiceName>" --force-new-deployment
aws ecs update-service --cluster "${CLUSTER_NAME}" --service "<WeaveCandidateEvaluationsWorkerServiceName>" --force-new-deployment
```

## Gate 4: Supabase Vault Secrets

Manual approval gate: do not write Supabase Vault secrets or enable the trigger until the AWS endpoint responds and the AWS secret is live.

In the Weave Supabase SQL editor, insert the URL and secret:

```sql
select vault.create_secret(
  '<WEAVE_WEBHOOK_URL>',
  'puddle_weave_candidate_evaluation_webhook_url',
  'Puddle AWS Weave candidate evaluation webhook URL'
);

select vault.create_secret(
  '<WEBHOOK_SECRET_VALUE>',
  'puddle_weave_candidate_evaluation_webhook_secret',
  'Puddle AWS Weave candidate evaluation webhook shared secret'
);

select name
from vault.decrypted_secrets
where name in (
  'puddle_weave_candidate_evaluation_webhook_url',
  'puddle_weave_candidate_evaluation_webhook_secret'
);
```

Do not paste the secret value into logs, tickets, or screenshots.

## Gate 5: Supabase Hook Apply

Manual approval gate: do not apply the Supabase hook until Gates 1-4 are complete.

After approval, apply the committed file to the Weave Supabase database using the approved SQL deployment path:

```sh
psql "${WEAVE_SUPABASE_DATABASE_URL}" \
  --set ON_ERROR_STOP=1 \
  --file supabase/weave_candidate_evaluation_hooks.sql
```

Smoke test with one non-production-safe row change or a single approved production row update. Confirm AWS receives and queues the event before any full backfill.

## JSONL Dry Run And Apply

Use the JSONL CLI for controlled file-based backfills. The input must contain one event per line with `eventId`, `source`, `operation`, and `record`.

Dry run:

```sh
npm --prefix backend run weave:candidate-evaluations -- \
  --input "${JSONL_INPUT}" \
  --organization-id "${WEAVE_ORG_ID}" \
  --dry-run
```

Manual approval gate: do not run `--apply` against production RDS without approval.

After approval:

```sh
npm --prefix backend run weave:candidate-evaluations -- \
  --input "${JSONL_INPUT}" \
  --organization-id "${WEAVE_ORG_ID}" \
  --apply
```

## Supabase Backfill Emitter

Manual approval gate: do not run a full Supabase backfill without approval. Start with a small batch after the smoke test succeeds:

```sql
select public.puddle_backfill_candidate_evaluations_v1(10) as emitted_count;
```

The Supabase emitter is not a stateful batch runner: it does not store a cursor, mark emitted rows, or accept a range predicate. Repeated calls with the same `batch_limit` can re-select and re-emit the same first ordered rows. For full controlled migrations, prefer the JSONL backfill path above. If operators choose a Supabase-driven full backfill, first modify the SQL backfill function in a reviewed change to add explicit range predicates or cursor tracking, then run approved non-overlapping ranges while observing queue/worker health.

Do not run this as a repeated full-backfill loop unless that external tracking or reviewed SQL range control exists:

```sql
select public.puddle_backfill_candidate_evaluations_v1(500) as emitted_count;
```

## CloudWatch, SQS, And DLQ Checks

Check queue depth:

```sh
export EXTERNAL_QUEUE_URL="<ExternalIntegrationIngressQueueUrl>"
export EXTERNAL_DLQ_URL="<ExternalIntegrationIngressDeadLetterQueueUrl>"
export BACKEND_LOG_GROUP_NAME="<BackendLogGroupName>"

aws sqs get-queue-attributes \
  --queue-url "${EXTERNAL_QUEUE_URL}" \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateAgeOfOldestMessage

aws sqs get-queue-attributes \
  --queue-url "${EXTERNAL_DLQ_URL}" \
  --attribute-names ApproximateNumberOfMessages ApproximateAgeOfOldestMessage
```

Check worker logs:

```sh
aws logs filter-log-events \
  --log-group-name "${BACKEND_LOG_GROUP_NAME}" \
  --log-stream-name-prefix "weave-candidate-evaluations" \
  --filter-pattern "status=failed"

aws logs filter-log-events \
  --log-group-name "${BACKEND_LOG_GROUP_NAME}" \
  --log-stream-name-prefix "weave-candidate-evaluations" \
  --filter-pattern "status=processed"
```

If the DLQ is non-empty, stop backfill batches, inspect one message without exposing candidate payloads broadly, fix the processor or source data, then replay only after approval.

## Final Puddle RDS Verification

Run against Puddle RDS after the queue drains:

```sql
select count(*) as imported_evaluations
from weave_candidate_evaluation_imports
where organization_id = 'org_01KV4FF7KX24B76H7Q57QVB5CT'
  and sync_status = 'synced';

select count(*) as imported_scores
from ashby_candidate_scores s
join weave_candidate_evaluation_imports imp on imp.score_id = s.score_id
where imp.organization_id = 'org_01KV4FF7KX24B76H7Q57QVB5CT';
```

Spot-check imported rows:

```sql
select source_evaluation_id, application_id, ashby_candidate_id, ashby_job_id, score_id, source_updated_at, last_synced_at
from weave_candidate_evaluation_imports
where organization_id = 'org_01KV4FF7KX24B76H7Q57QVB5CT'
order by last_synced_at desc
limit 20;
```

## Rollback Notes

To stop new Supabase events, disable the trigger in Weave Supabase:

```sql
drop trigger if exists puddle_candidate_evaluation_webhook_v1 on public.candidate_evaluations;
```

To keep functions installed but block direct backfill calls:

```sql
revoke execute on function public.puddle_backfill_candidate_evaluations_v1(integer)
  from public, anon, authenticated;
```

To stop AWS processing, scale the worker service to zero:

```sh
aws ecs update-service \
  --cluster "${CLUSTER_NAME}" \
  --service "<WeaveCandidateEvaluationsWorkerServiceName>" \
  --desired-count 0
```

Do not delete imported RDS rows as an automatic rollback. If data cleanup is required, prepare a reviewed SQL plan keyed by `organization_id = 'org_01KV4FF7KX24B76H7Q57QVB5CT'` and `source_evaluation_id`.
