# Puddle VoiceAI Infrastructure Plan

This document is the infrastructure foundation for the current `voiceai` /
Puddle interview platform codebase and the first AWS CDK implementation.

It is intentionally **foundation-first**. The first CDK pass should create the
network, storage, secrets, repositories, log groups, and web-hosting primitives
that the platform needs. It should **not** blindly expose the backend to the
public internet until the service-level blockers in this document are fixed.

The goal is to support the real product shape:

```text
controlled interview platform
+ platform web app
+ backend API
+ LiveKit-backed realtime room
+ long-running LiveKit agent worker
+ artifact storage
+ reviewable recordings/transcripts
+ clean path to later orchestration, scoring, RDS, Redis, and multi-region
```

The immediate architecture is intentionally conservative. The goal is to avoid
unnecessary cost, operational complexity, and premature platform commitments.

---

## Executive Verdict

### Greenlight now

Greenlight a CDK foundation pass that creates:

| Resource | Decision |
|---|---|
| Environment config | `dev`, `stage`, `prod` naming and per-env config |
| VPC | Option A by default: public ALB subnets, private ECS task subnets, NAT egress |
| Artifact S3 bucket | Private bucket for recordings/transcripts/events/audit artifacts |
| Static/web buckets | Buckets for static deployables or temporary web shells |
| Secrets Manager | Placeholder/imported secrets for database, LiveKit, providers, auth, platform |
| ECR repositories | `backend`, `agent`, and `platform` images |
| CloudWatch log groups | Backend, agent, platform, migration/one-off tasks |
| IAM roles | Least-privilege task roles and deploy roles |
| Optional GitHub OIDC | Deploy role foundation, if the AWS account is ready |

### Block for public backend deployment

Do **not** deploy a public backend behind an internet-facing ALB until these are
fixed:

| Blocker | Required fix |
|---|---|
| Public unauthenticated POST routes | Add API auth/HMAC/JWT middleware or keep backend private/internal |
| Missing backend health endpoint | Done for the private backend service path; keep it dependency-light |
| Platform hosting undecided | Treat `platform/` as the canonical web surface and choose static vs container explicitly |
| Missing Dockerfiles/image path | Backend Dockerfile exists; agent/platform still need production image paths |
| Agent command stale | Use the LiveKit Agents production startup mode with the `start` subcommand |
| Database decision too soft | Mark Supabase as dev/internal-stage unless explicitly approved for real candidate data |

### Current infrastructure stance

```text
Foundation resources: yes, now.
Private backend service: wired through ECS/Fargate and an internal ALB.
Public backend service: not until request auth is implemented.
Agent ECS service: after Dockerfile and production start command are verified.
Platform hosting: containerized Next.js by default; static export only if the app remains fully static/client-only.
RDS: included in the foundation as a small private PostgreSQL instance by default; external Postgres remains available only when explicitly configured.
```

---

## Current Code Context

The repository is a monorepo under `voiceai/` with these pieces:

| Path | Current role | Runtime shape | Infra status |
|---|---|---|---|
| `backend/` | Fastify API for session creation, LiveKit room provisioning, agent dispatch, migrations, deletion/finalization helpers | Node HTTP service | Private ECS deploy path exists; auth still required before public deploy |
| `agent/` | Python LiveKit agent worker with deterministic interview controller, STT/TTS adapters, scorer/probe logic, audit/event logging | Long-running worker process | Worker launcher exists; ECS command must include production `start` mode |
| `platform/` | Next.js platform app for the broader product surface | Next.js web app | Canonical web app going forward; default to containerized deployment |
| `room/` | Candidate room React/Vite shell with landing, consent, preflight, waiting, in-call, completion screens | Static web app | May remain as temporary static shell or be folded into `platform/` |
| `review/` | Reviewer React/Vite shell with VOD/signoff placeholders | Static web app | May remain as temporary static shell or be folded into `platform/` |
| `rubric/` | YAML rubric config currently loaded locally by the agent | Runtime config/data | Later move to database/S3/config service |
| `backend/migrations/` | SQL migrations for current Postgres schema | Migration input | Run via one-off task or CI job, not app startup |

The current backend depends on:

```text
DATABASE_URL
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
```

The current agent depends on:

```text
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
ANTHROPIC_API_KEY
DEEPGRAM_API_KEY
CARTESIA_API_KEY
GEMINI_API_KEY, optional
```

The platform will likely need:

```text
NEXT_PUBLIC_API_BASE_URL
NEXT_PUBLIC_LIVEKIT_URL, if the browser joins rooms directly
PLATFORM_BASE_URL
SESSION_COOKIE_SECRET or AUTH_SECRET
AUTH provider config, later
BACKEND_INTERNAL_BASE_URL, if using platform as BFF/server-side caller
```

Known current gaps:

- Backend `POST /sessions` and `POST /integration/sessions` are not safe to
  expose publicly without auth.
- Backend has `GET /healthz` for ALB/ECS health checks.
- Backend has a Dockerfile/image path; agent/platform image paths are still open.
- Platform hosting needs to be explicit now that `platform/` exists.
- The CDK foundation now defaults to AWS-hosted Postgres; external Supabase or
  Postgres remains an explicit opt-in path.
- Recording finalization is partial: artifact paths exist, but S3/Egress job
  persistence, webhooks, and retry workflow still need to land.
- Temporal, Redis, and SQS are still future layers unless code lands that
  uses them.

---

## Infrastructure Principle

Start with the smallest AWS foundation that supports the real product shape:

```text
VPC Option A
+ private ECS tasks
+ controlled/public ingress only when authenticated
+ platform web app
+ backend API
+ agent worker
+ external Postgres initially
+ LiveKit Cloud media plane
+ private artifact bucket
+ secrets
+ logs
+ ECR image repositories
```

Do not build the full future architecture in the first pass. The CDK app should
leave clean seams for:

- RDS/Aurora
- Redis/ElastiCache
- Temporal
- SQS/EventBridge
- WAF
- multi-account deployment
- India regional agent/media/storage expansion
- scoring workflows

The foundation should make those additions easy later without dragging them into
MVP before the code needs them.

---

## CDK Deployment Gates

The CDK app should encode safety gates so a config mistake cannot accidentally
ship an unsafe public backend.

Recommended config booleans:

```ts
export interface EnvConfig {
  envName: 'dev' | 'stage' | 'prod';
  awsAccount: string;
  awsRegion: string;

  networkMode: 'private-tasks-public-alb';

  deployBackendService: boolean;
  exposeBackendPublicly: boolean;
  requireBackendAuth: boolean;

  deployAgentService: boolean;
  deployPlatformService: boolean;
  platformHosting: 'container' | 'static-export' | 'disabled';

  useExternalDatabase: boolean;
  allowRealCandidateDataOnExternalDatabase: boolean;
}
```

Recommended guardrail:

```ts
if (cfg.exposeBackendPublicly && !cfg.requireBackendAuth) {
  throw new Error(
    'Refusing to deploy public backend without backend auth enabled.'
  );
}

if (cfg.envName === 'prod' && cfg.useExternalDatabase && !cfg.allowRealCandidateDataOnExternalDatabase) {
  throw new Error(
    'Refusing prod deploy with external database unless explicitly approved.'
  );
}
```

This guardrail prevents accidental public exposure of unauthenticated
session-creation endpoints.

---

## Recommended First CDK Scope

The first useful CDK implementation should create these resources even before
all services are live.

| AWS service | Use | First-pass action |
|---|---|---|
| VPC | Private ECS tasks, public ingress, NAT egress | Create Option A VPC across 2 AZs |
| S3 | Private interview artifact bucket | Create encrypted/private bucket |
| S3 | Static web buckets | Create bucket(s) for static shells/assets if needed |
| CloudFront | Static app delivery | Create distributions for static apps when used |
| Secrets Manager | Runtime secret storage | Create placeholders or import named secrets |
| RDS PostgreSQL | AWS-contained application database | Create a small private instance in isolated subnets by default |
| ECR | Container images | Create repos for `backend`, `agent`, `platform` |
| ECS Cluster | Runtime for services | Create cluster in VPC |
| CloudWatch Logs | Logs | Create log groups with explicit retention |
| IAM | Task/deploy permissions | Create least-privilege roles and policies |
| ALB | Backend/platform ingress | Create only when service is ready or behind safe auth/private mode |
| ACM/Route 53 | TLS/custom domains | Optional first pass if domains are ready |
| GitHub OIDC | CI/CD deploy identity | Optional but recommended early |

The first pass should be safe to deploy even when application services are not
ready. Creating ECR, secrets, buckets, log groups, and VPC first is useful and
low-risk.

---

## Services To Defer

Do not add these in the first CDK pass unless code lands that actually uses
them:

| Service | Defer because | Add when |
|---|---|---|
| ElastiCache/Redis | No current lock/rate-limit/presence/worker-capacity code | Session concurrency, locks, rate limits, worker slots |
| Temporal | No workflow code yet | Durable interview orchestration and recording finalization workflows land |
| SQS | No consumer yet | Recording/event async consumers exist |
| EventBridge | Not needed for current session flow | Scheduling, cron cleanup, lifecycle automation |
| EKS | Too much operational surface | Only if Fargate/ECS becomes limiting |
| WAF | Useful but not first foundation-critical | Public production traffic or customer security requirements |
| Multi-region data plane | Not needed for US-first MVP | India/other regional residency or latency requirements become concrete |

---

## Region Decision

Default to:

```text
AWS region: us-east-1
```

Reasons:

- broad AWS service availability
- common default for vendor integrations
- good enough for US-first backend/API traffic
- CloudFront and LiveKit handle most user-facing/media latency concerns
- future India expansion can be added at the media/agent layer first

Initial topology:

```text
AWS us-east-1:
  VPC
  ECS cluster
  backend service, when unblocked
  platform service, if containerized
  agent service, when unblocked
  artifact S3 bucket
  static web buckets/distributions, if used
  secrets
  logs
  ECR repos

External managed services:
  LiveKit Cloud
  Supabase/Postgres, initially for dev/internal stage
  Anthropic
  Deepgram
  Cartesia
  Gemini, optional
```

For non-US candidates, the first latency lever should be LiveKit media routing
and agent placement, not multi-region Postgres.

---

## India Later

Do not add India infrastructure in the first pass.

When India becomes a real requirement, decide which of these is actually needed:

| Requirement | Likely infra response |
|---|---|
| Indian candidates join US company interviews | Add India/nearby LiveKit media routing and possibly regional agent workers |
| Low-latency realtime voice for India users | Run agent workers near India, probably `ap-south-1` or LiveKit regional deployment |
| India data residency | Add regional artifact bucket/database strategy |
| India customer admin/review traffic | Consider regional platform/API endpoints |
| Cross-region review access | Signed URL and replication policy decision |

Default later path:

```text
Phase India-1:
  keep control plane in us-east-1
  add regional agent/media placement
  keep artifacts in US unless data residency requires otherwise

Phase India-2:
  add regional artifact bucket
  add regional processing workers
  introduce replication/access policy

Phase India-3:
  evaluate regional database/control plane only if customers require it
```

Avoid active-active multi-region databases until concrete latency or residency
requirements justify them.

---

## VPC And Networking

### Decision: Option A by default

Use the production-shaped VPC:

```text
VPC across 2 AZs
public subnets:
  ALB
  NAT gateways
private subnets:
  ECS backend tasks
  ECS platform tasks
  ECS agent tasks
future private subnets:
  RDS
  Redis
```

ECS tasks should not have public IPs.

Outbound access from private ECS tasks goes through NAT for:

- LiveKit Cloud
- Supabase/Postgres, while external
- Anthropic
- Deepgram
- Cartesia
- Gemini
- package/provider APIs as needed

Recommended NAT setup:

| Env | NAT gateways | Notes |
|---|---:|---|
| `dev` | 1 | Keep cost down |
| `stage` | 1 | Acceptable early |
| `prod` | 2 | One per AZ once real traffic/customer commitments exist |

Recommended VPC endpoints:

| Endpoint | Type | Add when |
|---|---|---|
| S3 | Gateway | Add first pass if simple; reduces NAT path for S3 |
| Secrets Manager | Interface | Add when NAT cost/security warrants it |
| ECR API/Docker | Interface | Add when fully private image pulls matter |
| CloudWatch Logs | Interface | Add when reducing NAT dependency matters |

### Security groups

| Security group | Inbound | Outbound |
|---|---|---|
| ALB SG | `80/443` from internet or CloudFront/WAF path | Backend/platform task SGs |
| Backend task SG | App port only from ALB SG or platform SG | HTTPS/everything required for providers/DB |
| Platform task SG | App port only from ALB SG | Backend internal URL, auth providers, etc. |
| Agent task SG | None | LiveKit/providers/DB/S3 as needed |
| Future RDS SG | Postgres only from backend/agent/platform SGs | None/default |

### Public ingress rule

Do not expose backend publicly unless backend auth is active.

Acceptable early modes:

| Mode | Description | Use case |
|---|---|---|
| `internal-backend` | Backend ALB/service is internal only | Platform BFF calls backend server-side |
| `public-authenticated-backend` | Public ALB but backend enforces HMAC/JWT/API auth | Integration testing and external clients |
| `public-unauthenticated-backend` | Public ALB and no auth | Never for shared AWS envs. Local only. |

---

## Backend Service

### Shape

Run `backend/` as a containerized ECS Fargate service.

Target runtime:

```text
node dist/server.js
```

Recommended container port:

```text
8080
```

Recommended environment variables:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=8080
DATABASE_URL
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
ARTIFACT_BUCKET_NAME
ARTIFACT_BUCKET_REGION
BACKEND_REQUIRE_AUTH=true
BACKEND_AUTH_MODE=hmac|jwt|disabled
```

### Required before ALB deploy

Backend must expose:

```text
GET /healthz
```

`/healthz` should:

- return HTTP `200` when the process can serve requests
- not depend on Postgres, LiveKit, or other external providers
- respond quickly
- include basic version/env metadata if useful

Example response:

```json
{
  "ok": true,
  "service": "backend",
  "env": "stage",
  "version": "git-sha-or-build-id"
}
```

Add optional:

```text
GET /readyz
```

`/readyz` can check deeper dependencies:

- database connectivity
- required secrets loaded
- artifact bucket config present
- LiveKit config present

Use `/healthz` for ALB target health. Use `/readyz` for ops/manual debugging.
If `/readyz` checks third-party providers, do not let transient provider issues
cause ECS to churn healthy app containers.

### ALB target group health check

Use:

```text
path: /healthz
healthy HTTP codes: 200
interval: 10s or 30s
healthy threshold: 2
unhealthy threshold: 2-3
```

Do not point ALB health checks at `/`, `POST /sessions`, or anything that
creates side effects. Health checks must be read-only, stable, and cheap.

### Backend auth requirement

The current session-creation endpoints must not be public without auth:

```text
POST /sessions
POST /integration/sessions
```

Recommended first auth mode for integration endpoints:

```text
HMAC API authentication
```

Suggested headers:

```text
x-puddle-key-id: key identifier
x-puddle-timestamp: unix timestamp seconds
x-puddle-signature: hex/base64 HMAC signature
```

Suggested canonical string:

```text
METHOD\nPATH\nTIMESTAMP\nSHA256_BODY
```

Validation rules:

- reject missing auth headers
- reject timestamps outside a 5-minute skew window
- verify key id maps to an active secret
- compare signatures using constant-time comparison
- later add nonce/replay tracking once Redis or DB support lands

Recommended secret shape:

```json
{
  "keys": [
    {
      "id": "stage-key-1",
      "secret": "...",
      "status": "active",
      "createdAt": "2026-05-01T00:00:00Z"
    }
  ]
}
```

Future platform/admin routes should use proper user auth through WorkOS, Clerk,
Cognito, or another identity provider. Do not treat HMAC integration auth as
human dashboard auth.

### Candidate link auth

Candidate session access should eventually use signed, scoped invite tokens:

```text
/session/{inviteToken}
```

Token rules:

- scoped to one session/candidate
- expires
- can be revoked
- cannot create arbitrary sessions
- cannot access review/admin artifacts

This can be implemented in the backend or platform BFF later. It should not be
mixed with integration API keys.

### Backend Docker packaging

Add one of these before deploying the service:

1. `backend/Dockerfile`, built in CI and pushed to ECR.
2. CDK Docker image asset, acceptable for early dev but less ideal for formal CI.

Recommended production path:

```text
GitHub Actions builds image
-> pushes to ECR with git SHA tag
-> CDK deploy references tag or updates service
```

Example image tags:

```text
backend:{git-sha}
backend:stage-latest
backend:prod-{release-version}
```

### Backend ECS sizing

Start small:

| Env | CPU | Memory | Desired count |
|---|---:|---:|---:|
| `dev` | 256 | 512 MiB | 1 |
| `stage` | 256-512 | 512 MiB-1 GiB | 1 |
| `prod` | 512 | 1 GiB | 2 once public/customer-facing |

Autoscaling later:

- ALB request count per target
- CPU/memory
- custom session creation/request metrics

---

## Agent Worker Service

### Shape

Run `agent/` as an ECS Fargate service with no public ingress.

The agent connects outbound to LiveKit Cloud and receives dispatched jobs. It
should scale horizontally by running more worker tasks.

### Required before ECS deploy

The worker launcher now exists, but production command must include the LiveKit
Agents server startup mode.

Expected command shape:

```text
uv run python -m agent.worker start
```

or, if the entrypoint is a script path inside the container:

```text
uv run src/agent.py start
```

The important part is the `start` subcommand. Do not run only:

```text
python -m agent.worker
```

unless that module itself translates to the LiveKit Agents `start` mode.

Before wiring ECS, verify locally/containerized:

```text
uv run python -m agent.worker --help
uv run python -m agent.worker start --help
```

If the module path is different, update the ECS command to match the committed
launcher. The dispatch name must remain:

```text
puddle-interviewer
```

That name is an integration contract with the backend dispatch behavior.

### Agent environment variables

```text
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
LIVEKIT_AGENT_NAME=puddle-interviewer
ANTHROPIC_API_KEY
DEEPGRAM_API_KEY
CARTESIA_API_KEY
GEMINI_API_KEY, optional
DATABASE_URL, if the agent reads/writes DB directly
ARTIFACT_BUCKET_NAME, when writing artifacts directly
LIVEKIT_LOG_LEVEL=info
```

### Agent ECS sizing

Start:

| Env | CPU | Memory | Desired count |
|---|---:|---:|---:|
| `dev` | 512 | 1 GiB | 1 |
| `stage` | 512-1024 | 1-2 GiB | 1 |
| `prod` | TBD by load test | TBD by model/provider use | >=2 when customer-facing |

The right production sizing depends on:

- number of concurrent interviews
- STT/TTS provider behavior
- whether video/avatar processing runs in the worker
- how many LiveKit jobs one worker can safely accept
- model warmup and VAD/turn-detector memory

### Scaling policy

Do not rely on CPU alone.

Future scaling signal:

```text
available_agent_slots >= sessions_starting_soon
```

Until that signal exists, use conservative desired counts and manual scaling for
scheduled pilots.

Useful future metrics:

- active LiveKit jobs per worker
- available worker slots
- worker startup time
- first agent audio latency
- provider error rate
- STT/TTS latency
- session crash count

### Agent deployment model

This infra plan assumes **self-hosted agent workers on ECS Fargate** that connect
to LiveKit Cloud.

Do not mix this up with LiveKit Cloud-managed agent deployment unless the team
explicitly switches deployment models. If using LiveKit Cloud-managed agents,
ECS for `agent/` may not be necessary, and deployment would flow through LiveKit
Cloud agent commands instead.

---

## Platform Web App

### Decision

`platform/` is now the canonical web surface.

Default hosting decision:

```text
Containerized Next.js on ECS Fargate
```

Reason: the platform is likely to need server-side auth, protected review pages,
signed artifact URL generation, cookies/session handling, dynamic routes, and
possibly server-side API calls. Those are a poor fit for static export once the
platform becomes the actual B2B app.

### Static export is allowed only if all are true

Use static export only if `platform/` is strictly:

- public/static or client-only
- no server actions
- no dynamic request-dependent route handlers
- no request-time cookies/session logic
- no server-side signed URL generation
- no server-side auth callbacks
- no dynamic routes that cannot be generated at build time

If those constraints hold, set:

```js
// platform/next.config.js
const nextConfig = {
  output: 'export'
};

module.exports = nextConfig;
```

and deploy `platform/out` to S3/CloudFront.

### Containerized platform path

Recommended for stage/prod:

```text
platform Dockerfile
+ Next standalone build
+ ECR repo
+ ECS Fargate service
+ ALB or CloudFront -> ALB
```

Recommended platform environment variables:

```text
NODE_ENV=production
PORT=3000
NEXT_PUBLIC_API_BASE_URL
NEXT_PUBLIC_LIVEKIT_URL
PLATFORM_BASE_URL
BACKEND_INTERNAL_BASE_URL
AUTH_SECRET or SESSION_COOKIE_SECRET
```

If platform acts as a BFF, browser calls platform, and platform calls backend
through an internal backend URL. This reduces public backend surface area.

```text
Browser -> Platform -> Backend internal service -> LiveKit/DB/S3
```

That is the recommended shape once auth is implemented.

### Candidate room and review shells

`room/` and `review/` can still be deployed as static apps while the platform is
under construction.

Recommended stance:

| App | Infra decision |
|---|---|
| `platform/` | Canonical product web app; containerized by default |
| `room/` | Temporary candidate-room static shell or migrate into `platform/` |
| `review/` | Temporary review static shell or migrate into `platform/` |

Do not build long-term infrastructure complexity around all three unless the
product intentionally keeps them separate.

### Web domains

Possible domain layout:

```text
app.puddle.ai          -> platform
interview.puddle.ai    -> candidate room, if separate
review.puddle.ai       -> review app, if separate
api.puddle.ai          -> backend API, only if public/authenticated
```

If using a BFF platform, hide backend behind internal networking and skip public
`api` until needed.

---

## Static Web Hosting

For static apps or static-exported platform builds:

```text
S3 private bucket
+ CloudFront distribution
+ Origin Access Control
+ ACM certificate
+ optional Route 53 alias
```

Recommended buckets:

```text
puddle-{env}-web-platform
puddle-{env}-web-room
puddle-{env}-web-review
```

Use only the buckets that correspond to deployed apps.

Bucket settings:

- block all public access
- CloudFront OAC only
- no AWS credentials in browser
- cache static assets aggressively
- keep `index.html`/HTML low-cache or invalidated on deploy

Static app runtime config options:

1. build-time `NEXT_PUBLIC_*` / `VITE_*` variables
2. generated `/config.json` uploaded during deploy
3. CloudFront function/rewrite only if needed later

Use generated `/config.json` if you want the same static build promoted across
environments. Use build-time variables if speed matters more than artifact
promotion purity.

---

## Artifact Storage

Create one private S3 bucket for interview artifacts.

Recommended name pattern:

```text
puddle-{env}-artifacts-{account}-{region}
```

Current path contract:

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

Recommended bucket defaults:

| Setting | Dev | Stage | Prod |
|---|---|---|---|
| Public access | Block all | Block all | Block all |
| TLS | Enforce | Enforce | Enforce |
| Encryption | SSE-S3 | SSE-S3 or KMS | KMS preferred |
| Versioning | Optional/off | On preferred | On |
| Object lock | Off | Off | Consider only after legal review |
| Lifecycle | Short temp cleanup | Temp cleanup | Formal retention policy |

Do not make artifacts public. Review playback should use backend-generated
signed URLs or platform-server-mediated access.

### Lifecycle policy

Start with conservative lifecycle rules:

```text
tmp/ or incomplete/ prefixes: expire after 7 days
staging test sessions: expire after 30-90 days
production sessions: no automatic delete until product/legal retention policy exists
```

Do not silently delete real candidate recordings before the customer retention
policy is decided. That is not “lean.” That is “future subpoena fan fiction.”

### S3 access patterns

| Actor | Access |
|---|---|
| Backend task | read/write artifacts, generate signed URLs |
| Agent task | write transcripts/events/media metadata if needed |
| Platform task | preferably ask backend for signed URLs; direct read only if BFF owns review |
| Browser | no AWS credentials; signed URL only |
| LiveKit Egress | narrow write access if writing directly to S3 |

### LiveKit Egress to S3

There are two possible paths:

| Path | Description | Recommendation |
|---|---|---|
| LiveKit writes directly to S3 | Configure Egress with S3 credentials/destination | Preferred once recording is wired |
| Backend copies artifacts | Backend downloads/copies after egress | Avoid unless direct upload is blocked |

If LiveKit Cloud writes directly to S3, create a narrow upload principal:

```text
s3:PutObject
s3:AbortMultipartUpload
s3:ListBucketMultipartUploads, if required
s3:ListBucket, limited if required
```

Limit it to:

```text
arn:aws:s3:::puddle-{env}-artifacts-*/{orgId}/interviews/*
```

or a less tenant-specific prefix until org/session prefix enforcement exists.
Store the access key material in Secrets Manager and copy/configure it into
LiveKit Cloud securely. Do not reuse backend task credentials for external
services.

---

## Database Decision

### Immediate decision

Use a private RDS PostgreSQL instance in the AWS foundation by default.
External Postgres via `DATABASE_URL` is still supported as an explicit opt-in.
Supabase is acceptable for:

```text
dev
internal stage testing
synthetic sessions
small founder/customer demos without sensitive candidate data, if explicitly accepted
```

### Real candidate data decision

Before running real candidate interviews, choose one:

| Option | Description | When acceptable |
|---|---|---|
| A. Move to RDS/Aurora | AWS-contained Postgres in the VPC | Recommended default for production candidate data |
| B. Keep Supabase production | Use managed external Supabase with formal approval | Only with explicit security/legal/product signoff |

Do not let “we already have a Supabase URL” become the data-plane decision by
accident. That is how MVPs grow a compliance tail.

### Current RDS stance

The CDK foundation creates the minimal AWS-contained database path now:

- PostgreSQL RDS instance
- isolated subnets
- existing app-to-database security group rules
- generated Secrets Manager credentials
- small dev sizing by default
- deletion protection and Multi-AZ defaults only for prod-shaped config

Move beyond this baseline when any of these are true:

- real production candidate data is being processed
- customers require AWS-contained data plane
- private networking is a procurement/security requirement
- Supabase connection pooling/limits are a bottleneck
- AWS-native backup/audit/restore is needed
- multi-env isolation must be formalized
- scoring/review workflows create heavier database usage

### Migration execution

Do not run migrations automatically on every backend container startup.

Recommended path:

```text
CI/CD migration step
or
one-off ECS task using backend image
```

Create a future `backend-migrate` task definition that uses the backend image and
secrets but runs only an explicit migration command.

---

## LiveKit Decision

Use LiveKit Cloud as the managed media plane.

AWS should not host SFU/media infrastructure in the first version.

CDK manages:

- LiveKit credentials in Secrets Manager
- backend service that provisions rooms
- agent service that connects to LiveKit
- artifact bucket for Egress outputs
- optional upload credentials for LiveKit Egress

Current backend behavior to preserve:

```text
room name: interview-{sessionId}
emptyTimeout: 600
maxParticipants: 3
agent dispatch name: puddle-interviewer
session metadata passed to worker
```

The agent dispatch name is a contract. Treat it like an API name, not a random
string someone typed before lunch.

---

## Recording And Finalization

Current partial pieces:

- `agent/src/agent/worker/recording.py` builds a LiveKit Egress request and polls
  for finalization.
- `backend/src/finalization/finalize.ts` builds an artifact manifest from the S3
  layout.
- `backend/src/storage/layout.ts` defines artifact paths.

Missing pieces before production-grade recording:

- LiveKit Egress client wiring
- S3 destination credentials/config
- webhook handler for Egress completion/failure
- `recording_jobs` table
- `recording_artifacts` table
- retry/failure workflow
- stuck finalization alert
- reviewer-visible failure state

First infra step:

```text
artifact bucket
+ secrets for egress/upload config
+ IAM policy for future egress writer
```

First code step:

```text
create recording job row
-> start egress
-> persist egress id
-> receive/poll completion
-> write artifact manifest
-> mark session review_ready or recording_failed
```

Do not add SQS/Temporal just for recording until a worker/workflow exists to
consume those events. Once recording finalization becomes important, Temporal is
the better long-term fit than ad hoc API request retries.

---

## Secrets

Use AWS Secrets Manager for sensitive runtime config.

Recommended secret names:

```text
/puddle/{env}/database-url
/puddle/{env}/livekit
/puddle/{env}/anthropic-api-key
/puddle/{env}/deepgram-api-key
/puddle/{env}/cartesia-api-key
/puddle/{env}/gemini-api-key
/puddle/{env}/backend-hmac-keys
/puddle/{env}/candidate-token-signing-key
/puddle/{env}/platform-auth
/puddle/{env}/livekit-egress-s3-writer
```

`/puddle/{env}/livekit`:

```json
{
  "LIVEKIT_URL": "...",
  "LIVEKIT_API_KEY": "...",
  "LIVEKIT_API_SECRET": "..."
}
```

`/puddle/{env}/backend-hmac-keys`:

```json
{
  "keys": [
    {
      "id": "stage-key-1",
      "secret": "...",
      "status": "active"
    }
  ]
}
```

`/puddle/{env}/platform-auth`:

```json
{
  "AUTH_SECRET": "...",
  "ISSUER": "...",
  "CLIENT_ID": "...",
  "CLIENT_SECRET": "..."
}
```

`/puddle/{env}/livekit-egress-s3-writer`:

```json
{
  "AWS_ACCESS_KEY_ID": "...",
  "AWS_SECRET_ACCESS_KEY": "...",
  "AWS_REGION": "us-east-1",
  "S3_BUCKET": "puddle-stage-artifacts-..."
}
```

Do not expose provider secrets or AWS credentials to static browser apps.

### CDK secret creation approach

For first pass, create placeholder empty/generated secrets where safe, and
import existing secrets where they already exist.

Prefer this pattern:

```text
CDK creates secret names and permissions.
Operators or CI populate secret values out-of-band.
Services read secrets at runtime.
```

Avoid hardcoding secret values in CDK context files. CDK context is not a
secrets manager and should not contain sensitive values.

---

## IAM

Initial roles:

| Role | Needs |
|---|---|
| Backend task execution role | Pull ECR image, write CloudWatch logs |
| Backend task role | Read DB/LiveKit/auth secrets, read/write artifact bucket as needed |
| Agent task execution role | Pull ECR image, write CloudWatch logs |
| Agent task role | Read LiveKit/provider secrets, write logs/artifacts as needed |
| Platform task execution role | Pull ECR image, write CloudWatch logs |
| Platform task role | Read platform auth secrets, call backend, maybe generate signed URLs later |
| Static deploy role | Write web buckets and invalidate CloudFront |
| CDK deploy role | Provision infrastructure |
| GitHub OIDC role | Assume deploy permissions from CI |
| LiveKit Egress writer | Narrow S3 write permissions only, if direct Egress-to-S3 is used |

Rules:

- Static web apps get no AWS credentials.
- Backend and agent should not get `s3:*` on all buckets.
- Prefer bucket/prefix-specific permissions.
- Provider API keys stay in Secrets Manager.
- Use separate secrets per environment.
- Use separate IAM roles per service.

---

## ECR Repositories

Create ECR repositories:

```text
puddle-{env}/backend
puddle-{env}/agent
puddle-{env}/platform
```

or environment-agnostic repos:

```text
puddle/backend
puddle/agent
puddle/platform
```

Environment-agnostic repos are usually cleaner if tags encode environment/release.

Recommended image tags:

```text
{git-sha}
{env}-latest
release-{semver}
```

Repository settings:

- scan on push if enabled/available
- lifecycle policy to expire old untagged images
- retain enough tagged releases for rollback
- no mutable `prod-latest` as the only source of truth

---

## Docker Packaging

Add Dockerfiles before creating live ECS services.

### Backend Dockerfile requirements

- install dependencies reproducibly
- build TypeScript
- copy only runtime artifacts
- run as non-root if practical
- expose `8080`
- command: `node dist/server.js`

### Agent Dockerfile requirements

- install `uv`/Python dependencies
- include model/download files if required by VAD/turn detector
- copy agent code and rubric config
- run production `start` mode
- set sensible log output for CloudWatch

Expected command shape:

```text
uv run python -m agent.worker start
```

### Platform Dockerfile requirements

If containerized:

- build Next app
- use standalone output if configured
- run on `PORT=3000`
- do not bake secrets into image
- inject runtime config through env/secrets

### CI image build path

Recommended order:

```text
lint/test
build backend image
build agent image
build platform image
push to ECR
cdk deploy/update services
run migrations explicitly if needed
```

---

## ECS Services

### Cluster

Create one ECS cluster per environment:

```text
puddle-{env}-cluster
```

Enable Container Insights later if needed. CloudWatch logs are enough for the
first pass.

### Backend service

Create only after blockers are fixed:

- Dockerfile/image exists
- `/healthz` exists
- public auth or internal-only ingress is configured
- database secret exists
- LiveKit secret exists

Ingress modes:

| Mode | ALB scheme | Use |
|---|---|---|
| internal backend | internal | Platform/BFF only |
| public authenticated backend | internet-facing | External integrations/API clients |
| public unauthenticated backend | none | Not allowed |

### Platform service

If containerized:

```text
CloudFront optional
-> public ALB listener 443
-> platform ECS service private subnets
```

The platform can call the backend through internal service discovery or internal
ALB URL once backend is internal.

### Agent service

No public ALB.

```text
ECS service desired count >= 1
private subnets
outbound NAT
secrets injected
CloudWatch logs
```

Deploy after command and Dockerfile are verified.

### One-off migration task

Add later:

```text
backend-migrate task definition
same backend image
same DB secret
command: migration command
run manually/CI before service deploy
```

---

## Load Balancers And Domains

### Public platform ALB

Use public ALB for platform if containerized.

Recommended:

```text
HTTPS listener 443
HTTP 80 redirect to HTTPS
ACM cert
Route53 alias if domain is in AWS
```

### Backend ALB

Default safe shape:

```text
internal ALB
```

Public backend only after auth exists.

If public:

```text
api.puddle.ai
HTTPS only
HMAC/JWT enforced in backend
optional WAF/IP allowlist later
```

### CloudFront

Use CloudFront for:

- static web apps
- static platform export, if chosen
- optional fronting of containerized platform later

Do not prematurely put CloudFront in front of every ALB if it slows iteration.
Add it when custom domains, caching, WAF, or global delivery justify it.

---

## Observability

### CloudWatch log groups

Create explicit log groups:

```text
/puddle/{env}/backend
/puddle/{env}/agent
/puddle/{env}/platform
/puddle/{env}/migrations
```

Retention:

| Env | Retention |
|---|---:|
| `dev` | 7-14 days |
| `stage` | 30 days |
| `prod` | 90 days minimum or per compliance policy |

### Minimum alarms

Add after services exist:

| Alarm | Why |
|---|---|
| Backend ECS desired != running | Service unhealthy |
| Backend target group unhealthy hosts > 0 | ALB health problem |
| Backend 5xx rate | API failures |
| Platform 5xx rate | User-facing failures |
| Agent desired != running | Agent capacity lost |
| Task restart count high | Crash loop |
| Egress/finalization failure metric | Missing recordings |

### Metrics to emit from code later

Session lifecycle:

```text
session_created
room_provisioned
agent_dispatched
candidate_joined
preflight_complete
consent_captured
recording_started
recording_finalized
review_ready
session_failed
```

Agent metrics:

```text
agent_startup_success
agent_startup_failure
first_audio_latency_ms
provider_error
script_mismatch_count
clarifier_count
question_timeout_count
```

Recording metrics:

```text
egress_start_latency_ms
egress_completion_latency_ms
egress_failed
artifact_manifest_created
recording_missing_track
```

CloudWatch is enough for the first CDK pass. Add Datadog, Honeycomb, or
OpenTelemetry when operational ownership and alert response paths are defined.

---

## CI/CD

Current state: no full CI/CD assumed.

Recommended GitHub Actions flow:

1. Install dependencies.
2. Run backend tests/lint/build.
3. Run agent tests/lint.
4. Run platform tests/lint/build.
5. Build backend image.
6. Build agent image.
7. Build platform image or static export.
8. Push images to ECR.
9. Deploy CDK.
10. Run migrations explicitly, when applicable.
11. Deploy static assets to S3, if applicable.
12. Invalidate CloudFront distributions.

Use GitHub OIDC to assume an AWS deploy role.

Do not store long-lived AWS access keys in GitHub secrets unless there is no
reasonable alternative.

### CI/CD deployment modes

| Mode | Use |
|---|---|
| Foundation deploy | CDK deploys network/storage/secrets/ECR/logs |
| Service deploy | CI builds images, pushes ECR, updates ECS services |
| Static web deploy | CI uploads static assets and invalidates CloudFront |
| Migration deploy | CI runs one-off migration task or controlled migration command |

---

## Environment Structure

Use explicit environment names:

```text
dev
stage
prod
```

Recommended account strategy:

| Stage | Account strategy |
|---|---|
| `dev` | Shared dev account acceptable early |
| `stage` | Separate account preferred before external pilots |
| `prod` | Separate account strongly recommended |

Do not block the first foundation pass on perfect multi-account setup if it
slows the team down. But name and tag resources so migration to multi-account is
not a nightmare later.

### Naming convention

Resource prefix:

```text
puddle-{env}-{resource}
```

CDK stack names:

```text
Puddle-{env}-Network
Puddle-{env}-Storage
Puddle-{env}-Secrets
Puddle-{env}-Ecr
Puddle-{env}-Services
Puddle-{env}-Web
Puddle-{env}-CiCd
```

For the very first implementation, a single stack is acceptable if the team wants
speed:

```text
Puddle-{env}-Foundation
```

Split once dependencies become noisy.

### Tags

Apply tags to all resources:

```text
Project=Puddle
Environment={env}
ManagedBy=CDK
Service=backend|agent|platform|shared
DataClassification=candidate-data|operational|public
```

---

## CDK Project Layout

Current CDK scaffold exists under:

```text
voiceai/infra/
```

Recommended layout:

```text
infra/
  bin/
    infra.ts
  lib/
    config.ts
    foundation-stack.ts        # optional first-pass combined stack
    network-stack.ts
    storage-stack.ts
    secrets-stack.ts
    ecr-stack.ts
    services-stack.ts
    web-stack.ts
    cicd-stack.ts
  infra.md
```

Recommended if starting simple:

```text
infra/
  bin/infra.ts
  lib/config.ts
  lib/foundation-stack.ts
  infra.md
```

Then split into multiple stacks later.

### Package manager

The repo root may use `pnpm`, while `infra/` may have its own `package.json` and
npm lockfile.

Choose one path:

| Option | Decision |
|---|---|
| Independent infra npm project | Fine early; keep commands isolated inside `infra/` |
| Add infra to pnpm workspace | Cleaner long-term monorepo consistency |

Do not mix npm and pnpm commands inside the same package after the team chooses.
That prevents divergent lockfiles and inconsistent install behavior.

---

## CDK Config Shape

Example `config.ts`:

```ts
export type EnvName = 'dev' | 'stage' | 'prod';

export interface PuddleEnvConfig {
  envName: EnvName;
  account: string;
  region: string;

  domainName?: string;

  vpc: {
    maxAzs: number;
    natGateways: number;
  };

  backend: {
    deployService: boolean;
    exposePublicly: boolean;
    requireAuth: boolean;
    imageTag?: string;
    port: number;
  };

  agent: {
    deployService: boolean;
    imageTag?: string;
    desiredCount: number;
  };

  platform: {
    hosting: 'container' | 'static-export' | 'disabled';
    imageTag?: string;
    port: number;
  };

  database: {
    external: boolean;
    allowRealCandidateDataExternal: boolean;
  };

  logs: {
    retentionDays: number;
  };
}
```

Example `stage`:

```ts
export const stage: PuddleEnvConfig = {
  envName: 'stage',
  account: process.env.CDK_DEFAULT_ACCOUNT!,
  region: 'us-east-1',

  vpc: {
    maxAzs: 2,
    natGateways: 1,
  },

  backend: {
    deployService: false,
    exposePublicly: false,
    requireAuth: true,
    port: 8080,
  },

  agent: {
    deployService: false,
    desiredCount: 1,
  },

  platform: {
    hosting: 'disabled',
    port: 3000,
  },

  database: {
    external: true,
    allowRealCandidateDataExternal: false,
  },

  logs: {
    retentionDays: 30,
  },
};
```

The initial foundation deploy can set all services to disabled while still
creating shared resources.

---

## Near-Term Implementation Order

### Pass 0: Code blockers before public services

Do these before public backend deployment:

1. Keep `GET /healthz` dependency-light.
2. Add backend auth middleware for session-creation routes, or keep backend private.
3. Add Dockerfiles for agent and platform if containerized.
4. Verify agent worker command uses production `start` mode.
5. Decide platform hosting mode.
6. Populate the RDS credentials/connection config before running AWS-hosted services.

### Pass 1: CDK foundation

Implement now:

1. Parameterize `env`, `account`, and `region`.
2. Add VPC Option A.
3. Add artifact S3 bucket.
4. Add static/web buckets, if static apps remain.
5. Add Secrets Manager secret placeholders/imports.
6. Add ECR repos for backend, agent, platform.
7. Add CloudWatch log groups.
8. Add ECS cluster.
9. Add baseline IAM roles.
10. Add GitHub OIDC deploy role if account setup is ready.
11. Add stack outputs for bucket names, ECR repo URIs, cluster name, secret names.

### Pass 2: Backend service

Private backend path now exists:

1. Build and push backend image.
2. Deploy backend ECS service.
3. Use internal ALB first, or public ALB with auth enabled.
4. Configure ALB health check to `/healthz`.
5. Add basic alarms.

### Pass 3: Platform service/static hosting

If containerized:

1. Build and push platform image.
2. Deploy platform ECS service behind public ALB.
3. Configure auth/session secrets.
4. Configure platform-to-backend internal URL.

If static:

1. Confirm `output: 'export'` constraints.
2. Build static output.
3. Upload to S3.
4. Invalidate CloudFront.

### Pass 4: Agent worker

Only after Docker/command verification:

1. Build and push agent image.
2. Deploy agent ECS service with no public ingress.
3. Inject LiveKit/provider secrets.
4. Verify worker registers as `puddle-interviewer`.
5. Run synthetic dispatch test.

### Pass 5: Recording and artifacts

1. Wire LiveKit Egress to S3.
2. Store recording job metadata.
3. Handle completion/failure webhook or polling.
4. Generate artifact manifest.
5. Surface recording status in platform/review.
6. Add failure alarms.

---

## Service Readiness Checklists

### Backend public deployment checklist

- [x] `GET /healthz` exists and returns 200 without external dependency calls.
- [ ] `POST /sessions` requires auth or is not publicly reachable.
- [ ] `POST /integration/sessions` requires auth or is not publicly reachable.
- [ ] HMAC/JWT/API auth secret exists in Secrets Manager.
- [x] Dockerfile exists.
- [x] ECS task runs with `HOST=0.0.0.0` and correct `PORT`.
- [x] ALB health check path is `/healthz`.
- [x] RDS credentials secret exists.
- [ ] LiveKit secret exists.
- [ ] Logs appear in CloudWatch.
- [ ] No provider secrets are exposed in frontend env vars.

### Agent deployment checklist

- [ ] Dockerfile exists.
- [ ] Production command includes `start` mode.
- [ ] Worker command verified in container.
- [ ] `LIVEKIT_AGENT_NAME=puddle-interviewer` or equivalent dispatch config is set.
- [ ] LiveKit credentials injected from Secrets Manager.
- [ ] Provider credentials injected from Secrets Manager.
- [ ] Agent task has no public ingress.
- [ ] Logs appear in CloudWatch.
- [ ] Synthetic LiveKit dispatch succeeds.

### Platform deployment checklist

- [ ] Hosting mode chosen: `container` or `static-export`.
- [ ] If static, app does not rely on unsupported runtime server features.
- [ ] If container, Dockerfile exists and image builds.
- [ ] Auth/session strategy is defined before protected review pages are public.
- [ ] Platform can reach backend through internal URL or authenticated public API.
- [ ] Browser env vars contain only public-safe values.
- [ ] Artifact playback uses signed URLs or server-mediated access.

### Real candidate data checklist

- [ ] Database hosting decision documented.
- [ ] Supabase approved for production candidate data or RDS/Aurora provisioned.
- [ ] Artifact retention policy exists.
- [ ] Recording consent flow exists.
- [ ] Access controls for review artifacts exist.
- [ ] Deletion/export process is defined.
- [ ] Logs do not leak provider keys or sensitive candidate answers unnecessarily.

---

## Product/Infra Decisions Still Needed

Before production, decide:

- Is Supabase allowed for production candidate data, or is RDS/Aurora required?
- Will backend be public authenticated API or internal-only behind platform/BFF?
- Is `platform/` fully replacing `room/` and `review/`, or are all three deployed?
- What auth provider protects platform/review?
- What is the artifact retention policy?
- Can an interview proceed if recording fails to start?
- Does LiveKit Egress write directly to S3, or does backend copy artifacts?
- Are agent event logs written directly to S3, to backend, or both?
- What is the minimum ops alert path for failed recordings?
- What is the first customer-facing domain layout?
- What is the first India requirement: latency only or data residency?

---

## Recommended MVP Infra Decision

For the next CDK pass, build:

```text
VPC Option A
+ artifact S3 bucket
+ static/web buckets as needed
+ Secrets Manager placeholders/imports
+ ECR repos for backend, agent, platform
+ CloudWatch log groups
+ ECS cluster
+ IAM roles
+ optional GitHub OIDC deploy role
```

Do **not** deploy public backend yet unless these are done:

```text
/healthz
+ backend auth/private ingress
+ Dockerfile/image path
+ platform hosting decision
+ agent start command verified
+ database policy for real candidate data
```

Then deploy in this order:

```text
foundation
-> backend internal or public-authenticated service
-> platform web app
-> agent worker
-> recording to S3
-> review from real artifacts
-> Temporal/Redis when runtime requirements justify them
```

The near-term priority remains:

```text
safe foundation
-> deployable containers
-> controlled ingress
-> lifecycle state
-> LiveKit room join
-> agent dispatch
-> recording to S3
-> human review from real artifacts
```

That is the platform spine. Additional infrastructure should be added only when
specific runtime requirements justify it.
