# Puddle VoiceAI Infrastructure Plan

This document translates the high-level `build.md` architecture into concrete
AWS/CDK decisions for the current `voiceai` codebase.

It is intentionally biased toward the code that exists today, not the full
future platform. The goal is to create enough infrastructure to run and test a
controlled interview platform without committing too early to heavyweight
systems that the code does not yet use.

## Current Code Context

The repository is a monorepo under `voiceai/` with these deployable pieces:

| Path | Current role | Runtime shape |
|---|---|---|
| `backend/` | Fastify API for session creation, LiveKit room provisioning, agent dispatch, DB migrations, deletion/finalization helpers | Node HTTP service |
| `agent/` | Python LiveKit agent worker with deterministic interview controller, STT/TTS adapters, scorer, probe generator, audit/event logging | Long-running worker process |
| `room/` | Candidate room React/Vite shell with landing, consent, preflight, waiting, in-call, completion screens | Static web app |
| `review/` | Reviewer React/Vite shell with VOD/signoff UI placeholders | Static web app |
| `rubric/` | YAML rubric config currently loaded from local files by the agent | Runtime config/data |
| `backend/migrations/` | SQL migrations for the current Postgres schema | Migration input |

The current backend depends on:

- `DATABASE_URL`
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

The current agent depends on:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `ANTHROPIC_API_KEY`
- `DEEPGRAM_API_KEY`
- `CARTESIA_API_KEY`
- optionally `GEMINI_API_KEY`

Known v1 gaps from the runbook and code review:

- The agent worker has an `entrypoint(job)` function, but the LiveKit Agents CLI
  launcher is not committed yet.
- The room app is still a flow shell; it does not yet request a candidate token
  or join LiveKit.
- The review app uses placeholder data and does not yet fetch real session
  artifacts.
- `backend/src/storage/layout.ts` defines S3-style artifact paths, but no object
  storage client is wired.
- The backend lifecycle is much simpler than the agent lifecycle. Backend status
  is roughly `scheduled -> in_progress -> recording_finalizing -> review_ready`,
  while the agent has richer states such as `candidate_joined`,
  `preflight_complete`, `consent_captured`, `question_answering`, and
  `question_probing`.
- There is no Temporal, Redis, queue consumer, Dockerfile, CI/CD, or production
  auth implementation yet.

## Infrastructure Principle

Start with the smallest AWS foundation that lets us run the real product shape:

```text
static candidate/review apps
+ backend API
+ long-running agent worker
+ Postgres connection
+ LiveKit Cloud
+ private artifact bucket
+ secrets
+ logs
```

Do not start by building the full `build.md` target architecture. The first CDK
implementation should support the current control plane and leave clear seams
for Temporal, Redis, RDS, object storage integration, and CI/CD.

## Recommended First CDK Scope

The first useful CDK stack should contain:

| AWS service | Use | Why now |
|---|---|---|
| S3 | Private artifact bucket | Required by the storage layout and LiveKit Egress destination plan |
| Secrets Manager | Runtime secrets | Keeps provider keys and DB URL out of task definitions and source |
| ECR | Backend and agent images | Required once services are containerized |
| ECS Fargate | Backend API and agent worker | Fits both HTTP service and long-running LiveKit worker |
| Application Load Balancer | Public backend ingress | Stable public API entry point for session creation/integration routes |
| CloudWatch Logs | Backend and agent logs | Required for debugging sessions, agent startup, provider failures |
| S3 + CloudFront | Static `room` and `review` hosting | Fits Vite build outputs and keeps apps CDN-backed |
| IAM roles/policies | Least-privilege service access | Backend/agent need secrets, logs, and eventually S3 writes |

This is enough to deploy the current architecture without pretending the future
orchestrator and review platform already exist.

## Services To Defer

Do not add these in the first CDK pass unless code lands that actually uses
them:

| Service | Defer because |
|---|---|
| RDS/Aurora | Current code only needs a Postgres URL, and the runbook says Supabase is being used |
| ElastiCache/Redis | No code uses locks, rate limits, room presence, or worker capacity state yet |
| Temporal Cloud/Self-hosted Temporal | No Temporal SDK/workflow code exists yet |
| SQS | No async consumer exists yet; a queue without a worker is premature |
| EventBridge | Useful later for schedules and ops automation, not required by current code |
| EKS | Too much operational surface for this stage |
| WAF | Add when public traffic or customer security posture requires it |
| Multi-region resources | The MVP should be single-region control plane with managed LiveKit media routing |

## Region Decision

Default to `us-east-1` for the initial control plane unless there is a concrete
reason not to.

Reasons:

- broad AWS service availability
- common default for vendor integrations
- good enough for US-first backend/API traffic
- the media path is handled primarily by LiveKit Cloud, not our API region

For candidates outside the US, the first latency lever should be LiveKit media
region/agent placement, not multi-region Postgres.

Initial topology:

```text
AWS us-east-1:
  backend ECS service
  agent ECS service
  artifact S3 bucket
  CloudFront origins for room/review
  secrets
  logs

External managed services:
  LiveKit Cloud
  Supabase/Postgres, initially
  Anthropic
  Deepgram
  Cartesia
  Gemini, optional
```

## Database Decision

### Recommendation

Keep Postgres external for now and inject it as `DATABASE_URL` through Secrets
Manager.

The code uses `pg` directly through `backend/src/db/pool.ts` and is already
compatible with any normal Postgres connection string. The runbook says the
current schema is already applied to Supabase.

### Why not RDS immediately?

RDS would force more infrastructure decisions before the data model is mature:

- VPC/subnet design
- security group design
- backup and maintenance windows
- migration path from Supabase
- private connectivity from ECS tasks
- NAT or VPC endpoint cost decisions

Those are worth doing once the product schema stabilizes. Right now the schema
is only six tables:

- `sessions`
- `consent_records`
- `assessments`
- `events`
- `audit_log`
- `schema_migrations`

The fuller platform schema still needs orgs, users, immutable template
versions, question templates, candidate invites, room instances, recording
jobs, transcript segments, review assignments, review notes, and model version
records.

### Trigger to move to RDS/Aurora

Move database hosting into AWS when one or more of these becomes true:

- customers require AWS-contained data plane
- private networking becomes a procurement requirement
- Supabase connection pooling or limits become a bottleneck
- we need AWS-native backup/audit/restore controls
- we are ready to formalize production/staging database separation

## VPC And Networking

There are two reasonable early networking paths.

### Option A: Production-shaped VPC

Use:

- VPC across two availability zones
- public subnets for ALB
- private subnets for ECS tasks
- NAT gateway for outbound calls to LiveKit, Anthropic, Deepgram, Cartesia,
  Supabase, and package/provider APIs

Pros:

- standard production topology
- backend and agent tasks have no public IPs
- straightforward later path to RDS/ElastiCache

Cons:

- NAT gateway cost starts immediately
- more CDK surface area up front

### Option B: Lean early VPC

Use:

- VPC across two availability zones
- public ALB
- ECS tasks in public subnets with public IPs but locked-down security groups

Pros:

- cheaper and simpler for early testing
- still lets tasks call external managed services
- avoids NAT cost while there is no private database/cache

Cons:

- less production-pure
- requires careful security group rules
- likely needs refactor when RDS/Redis arrives

### Recommendation

If the goal is serious staging/prod from the beginning, choose Option A. If the
goal is short-term live testing with very low spend, Option B is acceptable as a
temporary dev stack.

For a hiring/interview product, I would choose Option A for `stage` and `prod`,
and optionally keep a cheaper `dev` stack.

## Backend Service

### Shape

Run `backend/` as a containerized ECS Fargate service behind an ALB.

The service should expose:

- `POST /sessions`
- `POST /integration/sessions`

Current runtime command from the runbook:

```text
node dist/server.js
```

The backend service needs:

- `DATABASE_URL`
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- optional `HOST=0.0.0.0`
- optional `PORT=8080`

### ECS Fargate vs App Runner

App Runner is simpler for one HTTP service. ECS Fargate is better for this repo
because the agent worker is also a long-running service and will need the same
container/logging/secrets patterns.

Recommendation: use ECS Fargate for both backend and agent so the operational
model is consistent.

## Agent Worker Service

### Shape

Run `agent/` as an ECS Fargate service with no public ingress.

The agent connects outbound to LiveKit Cloud and receives dispatch jobs. It
should scale horizontally by running more worker tasks.

The worker needs:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `ANTHROPIC_API_KEY`
- `DEEPGRAM_API_KEY`
- `CARTESIA_API_KEY`
- optional `GEMINI_API_KEY`

### Current blocker

The code has `agent/src/agent/worker/entrypoint.py`, but not the committed CLI
launcher described in the runbook. Do not wire the final ECS command until this
exists.

Expected command after launcher lands:

```text
uv run python -m agent.worker
```

or the equivalent container command.

### Scaling

Start with desired count `1` in dev/stage. For production, scale based on
scheduled interview volume, not CPU alone.

Important future metric:

```text
available_agent_slots >= sessions_starting_soon
```

The code does not yet publish this metric, so do not build custom autoscaling
until that signal exists.

## Static Apps

### Candidate room

Deploy `room/dist` to S3 behind CloudFront.

This app will eventually need:

- route support for invite/session tokens
- API base URL configuration
- LiveKit candidate token retrieval
- LiveKit room join
- consent/preflight signals back to the backend

Current state: UI flow shell only.

### Review app

Deploy `review/dist` to separate S3/CloudFront hosting, or at minimum a separate
CloudFront path/origin.

Recommendation: keep review separate from candidate room because it will need
stricter authentication and authorization.

Current state: placeholder assessment and video URL.

### Next.js vs Vite

`build.md` recommends Next.js, but the current code uses Vite. Do not introduce
Next.js just for infra. Vite static hosting is simpler and matches the code.
Revisit Next.js only if server-rendered dashboard/auth patterns become useful.

## Artifact Storage

Create one private S3 bucket for interview artifacts.

The code already defines this path contract in `backend/src/storage/layout.ts`:

```text
/{orgId}/interviews/{sessionId}/
  media/
    composite.mp4
    candidate_video.mp4
    candidate_audio.m4a
    agent_audio.m4a
  transcripts/
    transcript.v1.json
  events/
    agent_events.jsonl
    media_events.jsonl
    integrity_events.jsonl
  assessment/
    scores.json
    integrity_flags.json
  review/
    reviewer_notes.json
    signoff.json
  audit/
    consent.json
    script_version.json
    model_versions.json
```

Bucket defaults:

- block all public access
- enforce TLS
- server-side encryption
- bucket versioning optional in dev, recommended in stage/prod
- lifecycle expiration for temporary/intermediate objects
- separate retention policy for production recordings once legal/product policy
  is decided

The backend/agent IAM roles should eventually receive narrow access to this
bucket. Start broad enough for development, then narrow to prefixes when
tenant/session access patterns settle.

## LiveKit Decision

Use LiveKit Cloud as an external managed media plane.

AWS should not host the SFU/media infrastructure in the first version. CDK
should only manage:

- secrets for LiveKit credentials
- backend service that provisions rooms
- agent service that connects to LiveKit
- artifact bucket for egress outputs if LiveKit writes to S3

Current backend behavior:

- creates a room named `interview-{sessionId}`
- sets `emptyTimeout: 600`
- sets `maxParticipants: 3`
- dispatches agent named `puddle-interviewer`
- passes session metadata to the worker

That `puddle-interviewer` agent name is a real integration contract. Infra and
worker deployment should preserve it.

## Recording And Finalization

Current code has two partial pieces:

- `agent/src/agent/worker/recording.py` builds a LiveKit Egress request and
  polls for finalization.
- `backend/src/finalization/finalize.ts` builds an artifact manifest from the
  S3 layout.

Missing pieces:

- actual LiveKit Egress client wiring
- S3 destination credentials/config
- webhook handler for egress completion/failure
- `recording_jobs` and `recording_artifacts` tables
- retry/failure workflow

Do not add SQS/Temporal just for recording until the code has a worker or
workflow to consume those events.

First infra step: create the bucket and secrets.

First code step later: wire LiveKit Egress to write to the bucket and persist a
recording job row.

## Secrets

Use Secrets Manager for sensitive runtime config.

Recommended secret shape for early CDK:

```text
/puddle/{env}/database-url
/puddle/{env}/livekit
/puddle/{env}/anthropic-api-key
/puddle/{env}/deepgram-api-key
/puddle/{env}/cartesia-api-key
/puddle/{env}/gemini-api-key
```

`/puddle/{env}/livekit` can be a JSON secret:

```json
{
  "LIVEKIT_URL": "...",
  "LIVEKIT_API_KEY": "...",
  "LIVEKIT_API_SECRET": "..."
}
```

Runtime injection:

- backend task receives database and LiveKit secrets
- agent task receives LiveKit and AI/voice provider secrets
- static apps should not receive provider secrets

## IAM

Initial IAM roles:

| Role | Needs |
|---|---|
| Backend task role | read database/livekit secrets, write CloudWatch logs, later read/write selected S3 artifact prefixes |
| Agent task role | read livekit/provider secrets, write CloudWatch logs, later write event/transcript/artifact objects |
| Static deploy role | write to room/review web buckets and invalidate CloudFront |
| CDK deploy role | provision infrastructure |

Avoid giving static web apps direct AWS credentials. Browser access to artifacts
should go through signed URLs generated by the backend once that code exists.

## Observability

CDK should create CloudWatch log groups for:

- backend service
- agent worker service

Set explicit retention:

- dev: 7 to 14 days
- stage: 30 days
- prod: 90 days or per compliance policy

Metrics to add once code emits them:

- session created
- room provisioned
- agent dispatched
- candidate joined
- consent captured
- recording started
- recording finalized
- review ready
- agent startup failures
- provider errors
- first audio latency
- script mismatch count

Do not start with Datadog/Honeycomb unless there is already an account and
operational habit. CloudWatch is enough for the first CDK pass.

## CI/CD

Current state: no CI/CD.

Recommended eventual GitHub Actions flow:

1. Run backend tests.
2. Run room/review tests.
3. Run agent tests/lint.
4. Build backend image.
5. Build agent image.
6. Push images to ECR.
7. Build room/review static assets.
8. Deploy CDK.
9. Upload static assets.
10. Invalidate CloudFront.

Use GitHub OIDC to assume an AWS deploy role. Do not store AWS access keys in
GitHub secrets unless there is no alternative.

## Environment Structure

Use explicit environment naming from the start:

```text
dev
stage
prod
```

Do not overbuild multi-account immediately if that slows down iteration, but
design the stack so it can be moved to multi-account later.

Recommended CDK stack naming:

```text
PuddleVoiceAi-{env}-Network
PuddleVoiceAi-{env}-Storage
PuddleVoiceAi-{env}-Services
PuddleVoiceAi-{env}-Web
```

For the very first implementation, a single stack is acceptable if the resources
are small. Split stacks once dependencies become noisy.

## CDK Project Layout

Current CDK scaffold exists under `voiceai/infra/`.

Recommended future layout:

```text
infra/
  bin/
    infra.ts
  lib/
    config.ts
    network-stack.ts
    storage-stack.ts
    services-stack.ts
    web-stack.ts
  infra.md
```

The repo root currently has a pnpm workspace for `room`, `review`, and
`backend`. The CDK scaffold currently has its own `package.json` and npm lock.
That is fine for now.

Later decision:

- keep `infra/` as an independent npm project, or
- add `infra` to `pnpm-workspace.yaml` and standardize package management

Do not mix npm and pnpm commands for the same package once the team chooses one.

## Near-Term Implementation Order

Recommended order for CDK resources:

1. Parameterize `env` and `region`.
2. Add artifact S3 bucket.
3. Add Secrets Manager secret definitions/imports.
4. Add ECR repos for backend and agent.
5. Add CloudWatch log groups.
6. Add VPC/networking decision.
7. Add backend ECS service and ALB.
8. Add static buckets and CloudFront for `room` and `review`.
9. Add agent ECS service after the launcher exists.
10. Add deployment role/GitHub OIDC.
11. Add object storage permissions once S3 client/Egress wiring lands.

## Product/Infra Decisions Still Needed

Before production, make these decisions explicitly:

- Is Supabase acceptable for the first production pilot, or must Postgres be AWS
  RDS/Aurora?
- Which AWS account and region are `stage` and `prod`?
- Are `room` and `review` separate domains?
- What auth protects the review app?
- What is the artifact retention policy?
- Can an interview proceed if recording fails to start?
- Does LiveKit Egress write directly to our S3 bucket, or does our backend copy
  artifacts after completion?
- Are agent event logs written locally first, directly to S3, or streamed to the
  backend?
- What is the minimum viable ops alert path for failed recordings and stuck
  finalization?

## Recommended MVP Infra Decision

For the next CDK pass, build:

```text
S3 artifact bucket
+ Secrets Manager secrets
+ ECR repos
+ CloudWatch log groups
+ ECS Fargate backend service behind ALB
+ S3/CloudFront hosting for room and review
```

Then add:

```text
ECS Fargate agent worker
```

after the worker launcher is committed.

Do not add:

```text
RDS
Redis
Temporal
SQS
EKS
multi-region
```

until the code has reached the point where those services are solving a real
runtime problem.

The near-term priority remains:

```text
database/state model
-> lifecycle reconciliation
-> minimal deployable runtime
-> LiveKit room join
-> recording to S3
-> review from real artifacts
```
