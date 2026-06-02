# Infrastructure Security Audit

Date: 2026-05-29

## Executive Summary

No critical vulnerabilities were confirmed in the reviewed codebase. The strongest existing controls are the CDK guardrail that blocks public backend exposure, private ECS/RDS networking, private encrypted S3 buckets, Secrets Manager injection, opaque candidate invite tokens, LiveKit webhook signature verification, parameterized SQL, and passing automated tests.

The main unsafe areas are production hardening gaps rather than obvious exposed secrets: broad GitHub OIDC deploy trust, fail-open backend internal auth when a token is missing, missing app/edge rate limits, no visible CSP/security-header baseline, disabled Postgres certificate verification, moderate dependency advisories, root-running Node containers, and domain-only authorization on privileged platform actions.

Audit limitations: I reviewed local code and lockfiles, not the live AWS account, WorkOS tenant settings, DNS, runtime response headers, or deployed ALB/WAF state. Local `.env.local` files were inspected only for variable names, not reported values.

## What Is Good

- CDK blocks public backend exposure even when auth is requested until request auth is fully implemented: `infra/lib/infra-stack.ts:211-219`; covered by tests at `infra/test/infra.test.ts:46-72`.
- ECS tasks run in private subnets with `assignPublicIp: false`; backend ALB is internal; RDS is private and isolated: `infra/lib/infra-stack.ts:977-1001`, `infra/lib/infra-stack.ts:590-595`.
- S3 buckets block public access, enforce SSL, enable encryption, and log artifact/web bucket access: `infra/lib/infra-stack.ts:460-504`, `infra/lib/infra-stack.ts:516-532`.
- Secrets are injected through Secrets Manager into ECS task definitions, not hard-coded into task environment: `infra/lib/infra-stack.ts:610-681`, `infra/lib/infra-stack.ts:908-918`, `infra/lib/infra-stack.ts:1062-1077`, `infra/lib/infra-stack.ts:1176-1187`.
- `.env.local` and nested env files are ignored, and only `.env.example` templates are tracked: `.gitignore:15-18`, `.dockerignore:2-5`.
- Candidate invite tokens are 32 random bytes, URL-safe, hashed before storage, and expire: `backend/src/invites/tokens.ts:3-10`, `backend/src/invites/repository.ts:36-48`, `backend/src/invites/repository.ts:68-76`, `backend/src/invites/repository.ts:93-112`.
- LiveKit join tokens are room-scoped and short-lived: `backend/src/livekit/token.ts:18-35`.
- LiveKit webhooks are signature verified before persistence: `backend/src/livekit/webhooks.ts:145-158`.
- SQL access is mostly parameterized; no user-controlled SQL string interpolation was confirmed in request paths.
- Agent container drops to a non-root user: `agent/Dockerfile:25-35`.
- Dependency audit results: Python agent had no known vulnerabilities; JS workspace and infra each had one moderate advisory.
- Verification passed: `corepack pnpm@9.12.0 -r test`, `npm test` in `infra/`, and `uv run pytest` all pass.

## High Severity Findings

### SEC-HIGH-001: GitHub OIDC deploy role is too broadly trusted

Location: `infra/lib/infra-stack.ts:1316-1336`

Evidence:

```ts
assumedBy: new iam.OpenIdConnectPrincipal(provider).withConditions({
  StringEquals: {
    'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
  },
  StringLike: {
    'token.actions.githubusercontent.com:sub': `repo:${this.cfg.githubOidc.owner}/${this.cfg.githubOidc.repo}:*`,
  },
}),
...
repository.grantPullPush(role);
bucket.grantReadWrite(role);
bucket.grantDelete(role);
```

Impact: if GitHub OIDC is enabled and any untrusted ref/workflow in that repo can request an ID token, it can assume a role that can push container images and mutate/delete static web assets.

Fix: restrict `sub` to protected refs or GitHub environments, for example `repo:owner/repo:ref:refs/heads/main` for non-prod and a protected `environment:prod` role for prod. Split deploy roles by environment and by asset class, and require branch protection/review for workflows with `id-token: write`.

Mitigation: keep `enableGithubOidc=false` until the trust policy is narrowed.

False positive notes: severity is lower if no workflow grants `id-token: write`, if the role is disabled, or if repo branch protections and environments fully constrain deploy workflows.

### SEC-HIGH-002: Backend internal auth fails open when the shared token is missing

Location: `backend/src/integration/internal-auth.ts:44-50`, route registration at `backend/src/server.ts:105-109`

Evidence:

```ts
export function registerInternalAuth(
  app: FastifyInstance,
  expectedToken = internalAuthTokenFromEnv(),
): void {
  if (!expectedToken) {
    return;
  }
```

Impact: any non-CDK deployment, local tunnel, or future public backend path that omits `PUDDLE_BACKEND_INTERNAL_TOKEN` silently disables auth for state-changing endpoints like `/sessions`, `/integration/sessions`, and `/candidate/invites/:token/join`.

Fix: fail closed outside explicit local test/dev. Require `PUDDLE_BACKEND_INTERNAL_TOKEN` when `NODE_ENV=production`, and add an explicit `PUDDLE_BACKEND_AUTH_DISABLED=true` escape hatch for local-only runs.

Mitigation: CDK currently injects `PUDDLE_BACKEND_INTERNAL_TOKEN` and blocks public backend exposure, so the main risk is alternate deployment paths or future changes.

False positive notes: this is not currently a confirmed internet exposure in CDK-managed infra.

## Medium Severity Findings

### SEC-MED-001: Privileged platform actions use domain checks, not role/permission checks

Location: `platform/app/api/team-invitations/route.ts:45-74`, `platform/app/api/interviews/route.ts:41-68`, dashboard displays roles but does not enforce them at `platform/app/dashboard/page.tsx:19-27`

Evidence:

```ts
const { user, organizationId } = await withAuth();
...
if (!isAllowedAuthEmail(user.email)) {
  return NextResponse.json({ error: "Email domain is not allowed." }, { status: 403 });
}
...
const invitation = await getWorkOS().userManagement.sendInvitation({
  email,
  expiresInDays: invitationExpiryDays(),
  inviterUserId: user.id,
```

Impact: any authenticated user from an allowed email domain can create interview invites and send WorkOS team invitations unless WorkOS configuration externally prevents it.

Fix: enforce WorkOS roles/permissions server-side before these POST routes. For example, require an `admin` or `interviews:create` permission for interview creation and `team:invite` for team invitations.

Mitigation: keep public signup disabled and restrict who can receive initial accounts.

False positive notes: if WorkOS tenant-level policies already restrict session issuance to admins only, risk is reduced, but the route code itself does not enforce it.

### SEC-MED-002: Public platform has no visible WAF, rate limiting, or abuse throttles

Location: public ALB at `infra/lib/infra-stack.ts:1145-1157`; state-changing routes at `platform/app/api/interviews/route.ts:41-68`, `platform/app/api/team-invitations/route.ts:45-74`, `platform/app/api/interviews/[token]/join/route.ts:20-35`

Evidence: no WAF constructs, rate-limit middleware, or rate-limit dependency were found. Public ALB creation has access logs but no WAF attachment:

```ts
const loadBalancer = new elbv2.ApplicationLoadBalancer(... {
  internetFacing: true,
  ...
});
loadBalancer.logAccessLogs(params.accessLogsBucket, 'platform-alb');
```

Impact: authenticated users or automated clients can create costly backend/LiveKit room operations or send WorkOS invitations without visible quotas. Candidate join endpoints also lack IP/token attempt throttles, though token entropy is strong.

Fix: add AWS WAF rate-based rules on the public ALB or a CloudFront layer, plus application-level per-user/per-IP quotas around invitation creation and interview creation.

Mitigation: monitor ALB logs and WorkOS/LiveKit usage until throttles exist.

False positive notes: runtime WAF/rate limits may exist outside this repo; verify live infra.

### SEC-MED-003: No visible CSP/security-header baseline for the Next.js platform

Location: `platform/next.config.ts:3-5`, external font import at `platform/app/globals.css:1`

Evidence:

```ts
const nextConfig: NextConfig = {
  /* config options here */
};
```

```css
@import url("https://fonts.googleapis.com/css2?family=Poppins:wght@500;600&display=swap");
```

Impact: the platform lacks visible defense-in-depth against XSS, clickjacking, MIME sniffing, and referrer leakage. External font CSS also needs to be reflected in a CSP if kept.

Fix: add global headers via Next config or edge/CDN: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and `frame-ancestors 'none'` or an explicit allowlist. Prefer `next/font` or self-hosted fonts to simplify CSP.

Mitigation: if headers are set by ALB/CloudFront elsewhere, capture that in infra tests or deployment docs.

False positive notes: runtime edge/CDN headers were not checked.

### SEC-MED-004: RDS TLS is enabled but certificate verification is disabled

Location: CDK env at `infra/lib/infra-stack.ts:902-907`, DB pool at `backend/src/db/pool.ts:31-34`

Evidence:

```ts
DATABASE_SSL: 'true',
DATABASE_SSL_REJECT_UNAUTHORIZED: 'false',
```

```ts
ssl:
  env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
    : undefined,
```

Impact: traffic is encrypted, but the client does not verify the server certificate. A network-positioned attacker inside the VPC path could impersonate the database more easily than with CA verification.

Fix: ship/configure the AWS RDS CA bundle and set `DATABASE_SSL_REJECT_UNAUTHORIZED=true` in deployed services.

Mitigation: private isolated RDS subnets and security groups reduce exposure.

False positive notes: this may have been chosen for early RDS connectivity; it should not stay as the production default.

### SEC-MED-005: LiveKit egress assume-role external ID is optional

Location: validation at `infra/lib/infra-stack.ts:226-234`, role trust at `infra/lib/infra-stack.ts:780-792`, S3 object permission at `infra/lib/infra-stack.ts:800-811`

Evidence:

```ts
const assumeRolePrincipal = this.cfg.liveKit.egressAssumeRoleExternalId
  ? new iam.ArnPrincipal(principalArn).withConditions({
      StringEquals: {
        'sts:ExternalId': this.cfg.liveKit.egressAssumeRoleExternalId,
      },
    })
  : new iam.ArnPrincipal(principalArn);
```

Impact: without an external ID, the LiveKit Cloud egress upload role is more exposed to confused-deputy mistakes. The role can also `PutObject` anywhere in the artifact bucket.

Fix: require `liveKitEgressAssumeRoleExternalId` for stage/prod backend deploys, and scope egress writes to a dedicated prefix such as `livekit-egress/*` or `{env}/interviews/*`.

Mitigation: the role grants no object read/delete, which limits blast radius.

False positive notes: tests use an external ID, but CDK config does not require it.

### SEC-MED-006: Node runtime containers run as root

Location: `backend/Dockerfile:21-37`, `platform/Dockerfile:19-36`

Evidence: neither Dockerfile creates a user or sets `USER`; by contrast the agent does at `agent/Dockerfile:25-35`.

Impact: a successful app/container escape path starts with root inside the backend/platform containers, increasing blast radius.

Fix: add a system user/group in runtime stages, chown copied runtime files, and run `USER <nonroot>`.

Mitigation: ECS Fargate still isolates tasks, but non-root containers are a standard hardening step.

False positive notes: no direct container escape was found.

### SEC-MED-007: Moderate dependency advisories are present in JavaScript lockfiles

Location: platform dependency root at `platform/package.json:12`; infra dependency root at `infra/package.json:15-20`

Evidence from package audits:

- `postcss@8.4.31` via `platform > next@16.2.6`; advisory `GHSA-qx2v-qp2m-jg93`; patched `postcss >=8.5.10`.
- `brace-expansion@5.0.2 - 5.0.5` via `infra > aws-cdk-lib`; advisory `GHSA-jxxr-4gwj-5jf2`.

Impact: both are moderate advisories. The PostCSS issue is XSS in CSS stringification output; the brace-expansion issue is a DoS class bug in range expansion.

Fix: run targeted dependency upgrades/overrides. For platform, upgrade Next or override PostCSS to `>=8.5.10` if compatible. For infra, run `npm audit fix` or upgrade `aws-cdk-lib` to a version that resolves the transitive advisory.

Mitigation: neither audit reported high/critical JS advisories; Python `pip-audit` reported no known vulnerabilities.

False positive notes: production exploitability depends on whether vulnerable code paths process attacker-controlled CSS/patterns.

## Low Severity Findings

### SEC-LOW-001: Service image tags default to `latest`

Location: `infra/lib/infra-stack.ts:878-881`, `infra/lib/infra-stack.ts:1051-1054`, `infra/lib/infra-stack.ts:1160-1163`

Evidence:

```ts
this.cfg.backend.imageTag ?? 'latest'
this.cfg.agent.imageTag ?? 'latest'
this.cfg.platform.imageTag ?? 'latest'
```

Impact: defaulting to `latest` makes deploy provenance weaker and can make rollback/debugging ambiguous. Prod ECR tags are immutable, which helps, but the CDK config should still require explicit image tags for deployed services.

Fix: fail validation for service deploys without explicit image tags in stage/prod; prefer git SHA or image digest.

### SEC-LOW-002: Artifact bucket has no current-object retention/expiration policy

Location: `infra/lib/infra-stack.ts:483-503`

Evidence: lifecycle rules abort incomplete multipart uploads and expire noncurrent versions, but do not expire current recordings/transcripts/events.

Impact: candidate media and derived artifacts may be retained indefinitely unless deletion workflows are consistently invoked.

Fix: define product/legal retention windows per environment and add current object expiration or lifecycle transitions.

### SEC-LOW-003: Input validation is present but shallow on session creation

Location: `backend/src/integration/contract.ts:23-43`, scheduler route at `backend/src/scheduler/routes.ts:22-24`

Evidence:

```ts
if (!body[field] || !String(body[field]).trim()) {
  return { ok: false, reason: `missing required field: ${field}` };
}
```

Impact: invalid dates, malformed emails, oversized strings, or unexpected object shapes can enter persistence/provider calls. Auth and parameterized SQL reduce immediate exploitability, but runtime schema validation should be stricter.

Fix: add a runtime schema library or explicit validators for email, ISO timestamps, max lengths, script-version allowlists, and scalar-only types. Apply validation to `/sessions` too or retire it from deployed surfaces.

### SEC-LOW-004: Deployment helper contains hard-coded environment-specific AWS defaults

Location: `scripts/deploy-platform.sh:6-10`

Evidence:

```bash
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-851725544921}"
REGION="${REGION:-us-west-1}"
CERT_ARN="${CERT_ARN:-arn:aws:acm:us-west-1:851725544921:certificate/...}"
BACKEND_IMAGE_TAG="${BACKEND_IMAGE_TAG:-23b88a7-rds-ssl-migrations}"
```

Impact: this can cause accidental deploys to the wrong account/certificate/backend image if run casually.

Fix: remove account/certificate/image defaults and require explicit env vars or named deployment profiles.

## Verification Commands Run

- `corepack pnpm@9.12.0 -r test` passed: backend 56 tests, room 4 tests, review 5 tests.
- `npm test` in `infra/` passed: 13 tests.
- `uv run pytest` in `agent/` passed: 130 tests.
- `corepack pnpm@9.12.0 audit --prod --audit-level moderate` found 1 moderate advisory.
- `npm audit --omit=dev --audit-level=moderate` in `infra/` found 1 moderate advisory.
- `uvx pip-audit -r /private/tmp/puddle-agent-requirements-audit.txt --progress-spinner off` found no known Python vulnerabilities.

