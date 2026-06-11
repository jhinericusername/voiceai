# Connected Local Development Design

## Goal

Make localhost development feel like the deployed product without requiring each developer to run the whole backend stack locally. The default path should let a developer open `localhost:3000` and exercise real Puddle flows against deployed non-production resources with one command.

## Decision

Use a shared AWS `dev` stack as the default testing environment. Do not create a separate `test-infra/` fork. Keep the existing `infra/` CDK app as the source of truth, add dev-focused connection helpers, and make scripts hide AWS outputs, tunnel setup, and secret loading.

The default workflow is:

```sh
pnpm dev:connected
```

That workflow runs the local Next.js platform app and forwards backend calls to the deployed dev backend through a local tunnel.

The backend-development workflow is:

```sh
pnpm dev:backend:connected
```

That workflow runs the backend locally while still using deployed dev resources such as RDS, LiveKit, the deployed agent, and object storage.

## Current Context

- The platform already proxies server-side API calls through `PUDDLE_BACKEND_BASE_URL`.
- The deployed platform and agent call the backend through an internal AWS load balancer.
- The backend load balancer and RDS database are private. A local machine cannot reach them directly.
- CDK already emits useful stack outputs: backend internal URL, private subnets, security groups, database endpoint, database secret, and runtime secret names.
- Local env files exist and are ignored by git. They must not be printed, committed, or copied into docs.
- The backend requires `LIVEKIT_URL`, LiveKit API credentials, database config, and optionally `PUDDLE_BACKEND_INTERNAL_TOKEN`.
- The deployed LiveKit agent registers as `puddle-interviewer`. The backend dispatches to that fixed name today.

## Architecture

### Shared Dev Stack

The shared dev stack remains production-shaped enough to be trustworthy:

- deployed backend service behind the internal backend ALB,
- deployed platform service for smoke checks,
- deployed agent service registered with LiveKit,
- private RDS database,
- LiveKit Cloud project,
- optional recording/artifact storage.

The stack should also include a small dev-only SSM tunnel target in the VPC, such as a minimal EC2 instance with no SSH ingress. Developers use AWS SSO/IAM plus Session Manager port forwarding. This avoids public backend exposure, SSH keys, VPN setup, and duplicated local infrastructure.

### Default Mode: Local Platform To Deployed Backend

`pnpm dev:connected` should:

1. Confirm the AWS CLI can access the selected dev account/profile.
2. Read the dev stack outputs from CloudFormation.
3. Fetch the backend internal token from Secrets Manager without printing it.
4. Start an SSM port-forwarding session from `127.0.0.1:<backend-port>` to the backend internal ALB on port `80`.
5. Start the platform dev server with:
   - `PUDDLE_BACKEND_BASE_URL=http://127.0.0.1:<backend-port>`
   - `PUDDLE_BACKEND_INTERNAL_TOKEN=<secret value>`
   - existing platform local auth/site env values.

In this mode, local code is limited to the platform app. Backend code, database writes, LiveKit room provisioning, agent execution, recordings, and callbacks all use deployed dev resources.

### Backend Development Mode

`pnpm dev:backend:connected` should:

1. Confirm AWS access and read dev stack outputs.
2. Start an SSM tunnel to RDS, for example `127.0.0.1:<db-port>` to the private RDS endpoint on `5432`.
3. Fetch required runtime secrets without printing them:
   - backend internal token,
   - LiveKit API key and secret,
   - database username and password,
   - optional recording/storage secrets when recordings are enabled.
4. Start the local backend on `localhost:8080` with:
   - `DATABASE_HOST=127.0.0.1`
   - `DATABASE_PORT=<db-port>`
   - deployed dev database name/user/password,
   - `DATABASE_SSL=true`
   - `DATABASE_SSL_REJECT_UNAUTHORIZED=false`
   - deployed dev LiveKit config,
   - matching `PUDDLE_BACKEND_INTERNAL_TOKEN`.
5. Start or instruct the developer to start the platform with `PUDDLE_BACKEND_BASE_URL=http://localhost:8080`.

This mode is for backend changes. It should not be the default for product/UI testing because it has more moving parts and can diverge from the deployed backend image.

## Resource Boundaries

The default environment must never target production unless a developer explicitly opts into a production profile and the script displays a blocking confirmation. The normal scripts should default to:

- `envName=dev`,
- `region=us-west-1`,
- stack name `Puddle-VideoAgent-Infra`,
- resource prefix `puddle-videoagent`.

The shared dev database can contain test candidate data, demo data, and cofounder-created sessions. It should not contain real candidate data unless the team intentionally promotes the environment's data-handling policy.

## Developer Experience

The scripts should fail with actionable messages:

- not logged into AWS,
- stack output missing,
- no SSM tunnel target available,
- required secret is empty,
- requested local port already in use,
- deployed backend health check fails through the tunnel,
- local platform/backend process exits.

They should also clean up child tunnel processes when the dev server stops.

Secrets should be passed through process environment variables or generated ignored env files. Generated files must live under ignored paths such as `.env.connected.local` or `platform/.env.connected.local`.

## Implementation Surface

Expected changes:

- Add dev tunnel support to `infra/` using the existing CDK stack, gated to non-production environments.
- Add scripts under `scripts/dev/` for stack output lookup, secret retrieval, SSM tunnel startup, and process cleanup.
- Add root package scripts:
  - `dev:connected`
  - `dev:backend:connected`
- Update `docs/RUNBOOK.md` with the two localhost workflows.
- Consolidate platform backend URL/header helpers where practical so all platform API routes use the same env behavior.

The first implementation can keep the LiveKit agent name fixed and rely on the deployed dev agent. A later improvement can make the agent name configurable if local and deployed agents need to run side by side without competing for the same dispatches.

## Error Handling

- If the tunnel cannot be established, do not start the platform/backend with a stale URL.
- If a required secret is empty, fail before starting any server.
- If the dev backend health check fails through the tunnel, show the backend service name and the relevant CloudWatch log group.
- If a developer selects production, require an explicit interactive confirmation and never persist production secrets to generated env files.
- Do not run migrations automatically. Database migrations remain a manual-gate operation.

## Testing

Automated verification:

- CDK tests for the dev-only tunnel target and outputs.
- Script unit tests or shellcheck-style validation for output parsing where feasible.
- Backend/platform tests affected by helper consolidation.
- `pnpm -r test` for TypeScript packages touched by the implementation.

Manual verification:

1. Run `pnpm dev:connected`.
2. Open `http://localhost:3000`.
3. Create or join a test interview through the platform.
4. Confirm requests reach the deployed dev backend through the tunnel.
5. Confirm rows are written to the shared dev database.
6. Run `pnpm dev:backend:connected`.
7. Confirm `GET http://localhost:8080/healthz` returns `200`.
8. Create or join a test interview through the local backend and confirm LiveKit dispatch still reaches the deployed dev agent.

## Non-Goals

- No public exposure of the backend.
- No separate test infrastructure fork.
- No automatic production tunnel.
- No automatic migrations.
- No local replacement for LiveKit, RDS, or the agent in the default workflow.
- No real-candidate testing requirement.
