# Ashby Self-Serve Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dashboard-driven Ashby onboarding flow where a customer admin enters an Ashby API key, selects jobs, receives a generated webhook secret, manually configures Ashby webhooks, and unlocks same-domain scoring once a signed ping is received.

**Architecture:** The backend owns integration state, encryption, Ashby API calls, webhook signature verification, active application sync, and score persistence. RDS stores encrypted customer Ashby credentials and queryable company state; AWS Secrets Manager stores only the backend-only encryption key. The platform derives company identity from WorkOS, proxies onboarding actions to the backend, and renders the onboarding wizard or recent screens.

**Tech Stack:** AWS CDK, ECS Fargate, AWS Secrets Manager, RDS Postgres, Fastify, Vitest, Next.js App Router, WorkOS AuthKit, Node test runner, TypeScript.

---

## Scope Check

This spec touches infra, database, backend, and platform, but the pieces are sequential and tightly coupled by one feature. Keep it in one plan so the worker can preserve the end-to-end contract across tasks.

## File Structure

- `infra/lib/infra-stack.ts`: add the runtime integration encryption secret, grant it only to backend execution, and inject it only into backend/migration containers.
- `infra/test/infra.test.ts`: assert secret count, backend injection, migration injection, and platform/agent non-injection.
- `backend/migrations/007_ashby_self_serve_onboarding.sql`: evolve Ashby integration rows for self-serve setup.
- `backend/test/migrations.test.ts`: assert migration ordering and required SQL.
- `backend/src/ashby/crypto.ts`: keep authenticated encryption and generate customer webhook secrets.
- `backend/src/ashby/webhook-signature.ts`: backend HMAC verification for Ashby raw webhook bodies.
- `backend/src/ashby/client.ts`: add `listJobs` for API key validation and job selection.
- `backend/src/ashby/types.ts`: add onboarding request/response types and new webhook envelope shape.
- `backend/src/ashby/repository.ts`: add statements for onboarding state, job selection, webhook secret lookup, and sync timestamp updates.
- `backend/src/ashby/routes.ts`: add onboarding endpoints and move webhook signature verification into backend.
- `backend/test/ashby-crypto.test.ts`, `backend/test/ashby-client.test.ts`, `backend/test/ashby-repository.test.ts`, `backend/test/ashby-routes.test.ts`: cover the backend contract.
- `platform/lib/ashby/server.ts`: extend company state and setup payload types.
- `platform/app/api/ashby/onboarding/api-key/route.ts`: authenticated API key onboarding proxy.
- `platform/app/api/ashby/onboarding/jobs/route.ts`: authenticated job selection proxy.
- `platform/app/api/ashby/onboarding/sync/route.ts`: authenticated sync proxy.
- `platform/app/api/ashby/webhook/route.ts`: raw-body webhook proxy with no platform-side Ashby secret.
- `platform/app/dashboard/DashboardSections.tsx`: replace the internal setup panel with a client onboarding wizard entry point.
- `platform/app/dashboard/AshbyOnboardingWizard.tsx`: interactive setup steps.
- `platform/tests/ashby-onboarding-source.test.mjs`: source-level platform contract tests.
- `platform/docs/ashby-internal-setup.md`: update runbook for self-serve setup and manual webhook verification.

## Task 1: Infra Integration Encryption Secret

**Files:**
- Modify: `infra/lib/infra-stack.ts`
- Modify: `infra/test/infra.test.ts`

- [ ] **Step 1: Write failing infra tests**

Add these assertions to `infra/test/infra.test.ts`. If existing tests already assert resource counts, update the expected Secrets Manager count by one.

```ts
test('injects the Ashby integration encryption key only into backend tasks', () => {
  const stack = createStack({
    backend: {
      ...defaultConfig().backend,
      deployService: true,
      imageTag: 'test',
    },
    agent: {
      ...defaultConfig().agent,
      deployService: true,
      imageTag: 'test',
    },
    platform: {
      ...defaultConfig().platform,
      hosting: 'container',
      imageTag: 'test',
    },
    liveKit: {
      recordingsEnabled: false,
      url: 'wss://livekit.example',
    },
  });
  const template = Template.fromStack(stack);

  template.hasOutput('IntegrationEncryptionKeySecretName', {
    Value: Match.stringLikeRegexp('/integrations/encryption-key$'),
  });

  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    ContainerDefinitions: Match.arrayWith([
      Match.objectLike({
        Name: 'backend',
        Secrets: Match.arrayWith([
          Match.objectLike({
            Name: 'PUDDLE_INTEGRATION_SECRET_KEY',
          }),
        ]),
      }),
    ]),
  });

  template.hasResourceProperties('AWS::ECS::TaskDefinition', {
    ContainerDefinitions: Match.arrayWith([
      Match.objectLike({
        Name: 'backend-migrations',
        Secrets: Match.arrayWith([
          Match.objectLike({
            Name: 'PUDDLE_INTEGRATION_SECRET_KEY',
          }),
        ]),
      }),
    ]),
  });

  const taskDefinitions = template.findResources('AWS::ECS::TaskDefinition');
  const platformTask = Object.values(taskDefinitions).find((task) =>
    JSON.stringify(task).includes('"Name":"platform"'),
  );
  const agentTask = Object.values(taskDefinitions).find((task) =>
    JSON.stringify(task).includes('"Name":"agent"'),
  );

  expect(JSON.stringify(platformTask)).not.toContain('PUDDLE_INTEGRATION_SECRET_KEY');
  expect(JSON.stringify(agentTask)).not.toContain('PUDDLE_INTEGRATION_SECRET_KEY');
});
```

- [ ] **Step 2: Run infra tests to verify failure**

Run:

```bash
cd infra && npm test -- --runInBand
```

Expected: FAIL because `IntegrationEncryptionKeySecretName` and `PUDDLE_INTEGRATION_SECRET_KEY` are not present.

- [ ] **Step 3: Implement infra secret wiring**

In `infra/lib/infra-stack.ts`, add the secret to `RuntimeSecrets`:

```ts
interface RuntimeSecrets {
  livekitApiKey: secretsmanager.ISecret;
  livekitApiSecret: secretsmanager.ISecret;
  anthropicApiKey: secretsmanager.ISecret;
  deepgramApiKey: secretsmanager.ISecret;
  cartesiaApiKey: secretsmanager.ISecret;
  geminiApiKey: secretsmanager.ISecret;
  backendInternalToken: secretsmanager.ISecret;
  platformAuthSecret: secretsmanager.ISecret;
  workosApiKey: secretsmanager.ISecret;
  workosClientId: secretsmanager.ISecret;
  weaveDatabaseCredentials: secretsmanager.ISecret;
  integrationEncryptionKey: secretsmanager.ISecret;
  livekitEgressS3Credentials?: secretsmanager.ISecret;
}
```

Add the path:

```ts
const RUNTIME_SECRET_PATHS: Record<keyof RuntimeSecrets, string> = {
  livekitApiKey: 'livekit/api-key',
  livekitApiSecret: 'livekit/api-secret',
  anthropicApiKey: 'providers/anthropic-api-key',
  deepgramApiKey: 'providers/deepgram-api-key',
  cartesiaApiKey: 'providers/cartesia-api-key',
  geminiApiKey: 'providers/gemini-api-key',
  backendInternalToken: 'backend/internal-token',
  platformAuthSecret: 'platform/auth-secret',
  workosApiKey: 'platform/workos-api-key',
  workosClientId: 'platform/workos-client-id',
  weaveDatabaseCredentials: 'weave/database/credentials',
  integrationEncryptionKey: 'integrations/encryption-key',
  livekitEgressS3Credentials: 'livekit/egress-s3-credentials',
};
```

Create it in `createRuntimeSecrets`:

```ts
integrationEncryptionKey: this.createSecret(
  'IntegrationEncryptionKey',
  RUNTIME_SECRET_PATHS.integrationEncryptionKey,
  removalPolicy,
),
```

Grant backend execution read access:

```ts
grantSecretsRead(backendExecutionRole, [
  runtimeSecrets.livekitApiKey,
  runtimeSecrets.livekitApiSecret,
  runtimeSecrets.backendInternalToken,
  runtimeSecrets.integrationEncryptionKey,
  ...(runtimeSecrets.livekitEgressS3Credentials
    ? [runtimeSecrets.livekitEgressS3Credentials]
    : []),
]);
```

Inject it into the backend container secrets object that is reused by backend and migration task definitions:

```ts
PUDDLE_INTEGRATION_SECRET_KEY: ecs.Secret.fromSecretsManager(
  params.runtimeSecrets.integrationEncryptionKey,
),
```

- [ ] **Step 4: Run infra tests and build**

Run:

```bash
cd infra && npm test -- --runInBand && npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lib/infra-stack.ts infra/test/infra.test.ts
git commit -m "feat: add integration key"
```

## Task 2: Database Migration for Self-Serve State

**Files:**
- Create: `backend/migrations/007_ashby_self_serve_onboarding.sql`
- Modify: `backend/test/migrations.test.ts`

- [ ] **Step 1: Write failing migration test**

Extend `backend/test/migrations.test.ts`:

```ts
it("keeps Ashby self-serve onboarding migration after composite key repair", () => {
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  const repairIndex = files.indexOf("006_repair_ashby_composite_keys.sql");
  const selfServeIndex = files.indexOf("007_ashby_self_serve_onboarding.sql");
  expect(selfServeIndex).toBeGreaterThan(repairIndex);

  const migration = readFileSync(join(migrationsDir, "007_ashby_self_serve_onboarding.sql"), "utf-8");
  expect(migration).toContain("ashby_webhook_secret_ciphertext");
  expect(migration).toContain("setup_status");
  expect(migration).toContain("last_sync_at");
  expect(migration).toContain("created_by_email");
  expect(migration).toContain("updated_by_email");
  expect(migration).toContain("ashby_company_integrations_setup_status_check");
});
```

- [ ] **Step 2: Run backend migration test to verify failure**

Run:

```bash
cd backend && npm test -- migrations.test.ts
```

Expected: FAIL because `007_ashby_self_serve_onboarding.sql` does not exist.

- [ ] **Step 3: Create migration**

Create `backend/migrations/007_ashby_self_serve_onboarding.sql`:

```sql
-- 007_ashby_self_serve_onboarding.sql — customer-facing Ashby onboarding state.

ALTER TABLE ashby_company_integrations
  ADD COLUMN IF NOT EXISTS ashby_webhook_secret_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS setup_status TEXT NOT NULL DEFAULT 'pending_webhook',
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by_email TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_email TEXT;

UPDATE ashby_company_integrations
SET setup_status = CASE
  WHEN connected_at IS NOT NULL THEN 'connected'
  WHEN array_length(selected_job_ids, 1) IS NULL OR array_length(selected_job_ids, 1) = 0 THEN 'job_selection_pending'
  ELSE 'pending_webhook'
END
WHERE setup_status IS NULL OR setup_status = 'pending_webhook';

ALTER TABLE ashby_company_integrations
  DROP CONSTRAINT IF EXISTS ashby_company_integrations_setup_status_check;

ALTER TABLE ashby_company_integrations
  ADD CONSTRAINT ashby_company_integrations_setup_status_check
  CHECK (setup_status IN ('job_selection_pending', 'pending_webhook', 'connected', 'error'));

CREATE INDEX IF NOT EXISTS ashby_company_integrations_setup_status_idx
  ON ashby_company_integrations(setup_status);
```

Do not mark `ashby_webhook_secret_ciphertext` `NOT NULL` in this migration because existing internal rows need an application-level backfill path after the encryption key is available.

- [ ] **Step 4: Run backend migration test**

Run:

```bash
cd backend && npm test -- migrations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/007_ashby_self_serve_onboarding.sql backend/test/migrations.test.ts
git commit -m "feat: ashby onboarding db"
```

## Task 3: Backend Ashby Client and Signature Utilities

**Files:**
- Create: `backend/src/ashby/webhook-signature.ts`
- Modify: `backend/src/ashby/client.ts`
- Modify: `backend/src/ashby/types.ts`
- Modify: `backend/test/ashby-client.test.ts`
- Create: `backend/test/ashby-webhook-signature.test.ts`
- Modify: `backend/test/ashby-crypto.test.ts`

- [ ] **Step 1: Write failing client and signature tests**

Append to `backend/test/ashby-client.test.ts`:

```ts
it("lists jobs with the Ashby API key for onboarding", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({
        success: true,
        results: [
          { id: "job_1", name: "Founding Engineer", status: "Open" },
          { id: "job_2", title: "Designer", status: "Closed" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  await expect(listJobs({ apiKey: "ashby-key", fetchImpl })).resolves.toEqual([
    { id: "job_1", name: "Founding Engineer", status: "Open" },
    { id: "job_2", name: "Designer", status: "Closed" },
  ]);

  expect(calls[0]?.url).toBe("https://api.ashbyhq.com/job.list");
  expect(calls[0]?.init.headers).toMatchObject({
    accept: "application/json; version=1",
    authorization: `Basic ${Buffer.from("ashby-key:").toString("base64")}`,
    "content-type": "application/json",
  });
});

it("surfaces Ashby job.list permission failures", async () => {
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify({ success: false, errorInfo: { message: "missing_endpoint_permission" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;

  await expect(listJobs({ apiKey: "ashby-key", fetchImpl })).rejects.toThrow(
    /missing_endpoint_permission/,
  );
});
```

Add the import in the same test file:

```ts
import { listActiveApplicationsForJob, listJobs } from "../src/ashby/client.js";
```

Create `backend/test/ashby-webhook-signature.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ashbyWebhookDigest, verifyAshbyWebhookSignature } from "../src/ashby/webhook-signature.js";

describe("Ashby webhook signature verification", () => {
  it("verifies sha256 signatures over the raw body", () => {
    const body = JSON.stringify({ action: "ping", data: { id: "hook_1" } });
    const secret = "webhook-secret";
    const signature = `sha256=${ashbyWebhookDigest(body, secret)}`;

    expect(verifyAshbyWebhookSignature({ body, secret, signature })).toBe(true);
  });

  it("rejects missing, malformed, or mismatched signatures", () => {
    const body = JSON.stringify({ action: "ping" });
    expect(verifyAshbyWebhookSignature({ body, secret: "secret", signature: null })).toBe(false);
    expect(verifyAshbyWebhookSignature({ body, secret: "secret", signature: "bad" })).toBe(false);
    expect(
      verifyAshbyWebhookSignature({
        body,
        secret: "secret",
        signature: `sha256=${ashbyWebhookDigest(body, "other-secret")}`,
      }),
    ).toBe(false);
  });
});
```

Append to `backend/test/ashby-crypto.test.ts`:

```ts
it("generates non-repeating webhook secrets", () => {
  expect(generateIntegrationSecret()).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  expect(generateIntegrationSecret()).not.toBe(generateIntegrationSecret());
});
```

Update the import:

```ts
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  generateIntegrationSecret,
  integrationSecretKeyFromEnv,
} from "../src/ashby/crypto.js";
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd backend && npm test -- ashby-client.test.ts ashby-webhook-signature.test.ts ashby-crypto.test.ts
```

Expected: FAIL because `listJobs`, `generateIntegrationSecret`, and backend webhook signature utilities do not exist.

- [ ] **Step 3: Implement client and signature utilities**

In `backend/src/ashby/types.ts`, add:

```ts
export interface AshbyJob {
  readonly id: string;
  readonly name: string;
  readonly status: string | null;
}
```

In `backend/src/ashby/crypto.ts`, add:

```ts
export function generateIntegrationSecret(): string {
  return randomBytes(32).toString("base64url");
}
```

Create `backend/src/ashby/webhook-signature.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function signatureBytes(value: string): Buffer | null {
  const normalized = value.trim().replace(/^sha256=/i, "");
  if (!/^[a-f0-9]{64}$/i.test(normalized)) {
    return null;
  }
  return Buffer.from(normalized, "hex");
}

export function ashbyWebhookDigest(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyAshbyWebhookSignature({
  body,
  secret,
  signature,
}: {
  readonly body: string;
  readonly secret: string;
  readonly signature: string | null;
}): boolean {
  if (!secret.trim() || !signature) {
    return false;
  }

  const provided = signatureBytes(signature);
  const expected = signatureBytes(ashbyWebhookDigest(body, secret));
  if (!provided || !expected || provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}
```

In `backend/src/ashby/client.ts`, import `AshbyJob` and add:

```ts
function jobFromAshby(value: Record<string, unknown>): AshbyJob | null {
  const id = stringValue(value.id);
  const name = stringValue(value.name) ?? stringValue(value.title);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    status: stringValue(value.status),
  };
}

export async function listJobs(input: {
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<AshbyJob[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${ASHBY_API_BASE_URL}/job.list`, {
    method: "POST",
    headers: {
      accept: "application/json; version=1",
      authorization: authHeader(input.apiKey),
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`Ashby job.list failed with ${response.status}`);
  }

  const payload = (await response.json()) as AshbyListResponse;
  if (payload.success === false) {
    throw new Error(`Ashby job.list failed: ${ashbyErrorMessage(payload)}`);
  }

  return (payload.results ?? [])
    .map(jobFromAshby)
    .filter((job): job is AshbyJob => job !== null);
}
```

- [ ] **Step 4: Run backend tests and build**

Run:

```bash
cd backend && npm test -- ashby-client.test.ts ashby-webhook-signature.test.ts ashby-crypto.test.ts && npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/ashby/client.ts backend/src/ashby/crypto.ts backend/src/ashby/types.ts backend/src/ashby/webhook-signature.ts backend/test/ashby-client.test.ts backend/test/ashby-crypto.test.ts backend/test/ashby-webhook-signature.test.ts
git commit -m "feat: ashby setup helpers"
```

## Task 4: Backend Repository Statements for Onboarding

**Files:**
- Modify: `backend/src/ashby/repository.ts`
- Modify: `backend/test/ashby-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Append to `backend/test/ashby-repository.test.ts`:

```ts
it("builds API key onboarding upsert with encrypted API and webhook secrets", () => {
  const stmt = integrationApiKeyUpsertStatement({
    organizationId: "org_1",
    emailDomain: "UsePuddle.COM",
    reviewerEmail: "admin@usepuddle.com",
    ashbyApiKeyCiphertext: "api:ciphertext",
    ashbyWebhookSecretCiphertext: "webhook:ciphertext",
  });

  expect(stmt.sql).toContain("ashby_company_integrations");
  expect(stmt.sql).toContain("ashby_api_key_ciphertext");
  expect(stmt.sql).toContain("ashby_webhook_secret_ciphertext");
  expect(stmt.sql).toContain("created_by_email");
  expect(stmt.sql).toContain("updated_by_email");
  expect(stmt.params).toEqual([
    expect.any(String),
    "org_1",
    "usepuddle.com",
    "api:ciphertext",
    "webhook:ciphertext",
    "job_selection_pending",
    "admin@usepuddle.com",
  ]);
});

it("builds job selection update and exposes setup secret lookup", () => {
  const update = integrationJobsUpdateStatement({
    integrationId: "int_1",
    selectedJobIds: ["job_1", "job_2"],
    reviewerEmail: "admin@usepuddle.com",
  });
  expect(update.sql).toContain("selected_job_ids = $2");
  expect(update.sql).toContain("setup_status = 'pending_webhook'");
  expect(update.params).toEqual(["int_1", ["job_1", "job_2"], "admin@usepuddle.com"]);

  const lookup = integrationSecretLookupStatement("int_1");
  expect(lookup.sql).toContain("ashby_api_key_ciphertext");
  expect(lookup.sql).toContain("ashby_webhook_secret_ciphertext");
  expect(lookup.params).toEqual(["int_1"]);
});

it("builds sync timestamp and connected status updates", () => {
  const sync = markIntegrationSyncedStatement("int_1");
  expect(sync.sql).toContain("last_sync_at = now()");
  expect(sync.params).toEqual(["int_1"]);

  const connected = markIntegrationPingStatement("int_1");
  expect(connected.sql).toContain("setup_status = 'connected'");
  expect(connected.sql).toContain("connected_at = COALESCE");
});
```

Add imports:

```ts
import {
  integrationApiKeyUpsertStatement,
  integrationJobsUpdateStatement,
  integrationSecretLookupStatement,
  markIntegrationSyncedStatement,
} from "../src/ashby/repository.js";
```

- [ ] **Step 2: Run repository tests to verify failure**

Run:

```bash
cd backend && npm test -- ashby-repository.test.ts
```

Expected: FAIL because the new statement builders do not exist and `markIntegrationPingStatement` does not set `setup_status`.

- [ ] **Step 3: Implement repository statements**

In `backend/src/ashby/repository.ts`, add:

```ts
export function integrationApiKeyUpsertStatement(input: {
  readonly organizationId?: string | null;
  readonly emailDomain: string;
  readonly reviewerEmail: string;
  readonly ashbyApiKeyCiphertext: string;
  readonly ashbyWebhookSecretCiphertext: string;
  readonly integrationId?: string;
}): SqlStatement {
  const integrationId = input.integrationId ?? randomUUID();
  return {
    sql:
      "WITH matching_integrations AS (" +
      "SELECT integration_id FROM ashby_company_integrations " +
      "WHERE ($2::text IS NOT NULL AND organization_id = $2) OR email_domain = $3 " +
      "FOR UPDATE" +
      "), identity_conflict AS (" +
      "SELECT count(DISTINCT integration_id) > 1 AS has_conflict FROM matching_integrations" +
      "), target AS (" +
      "SELECT integration_id FROM matching_integrations ORDER BY integration_id LIMIT 1" +
      "), updated AS (" +
      "UPDATE ashby_company_integrations SET " +
      "organization_id = COALESCE($2, organization_id), email_domain = $3, " +
      "ashby_api_key_ciphertext = $4, " +
      "ashby_webhook_secret_ciphertext = COALESCE(ashby_webhook_secret_ciphertext, $5), " +
      "setup_status = $6, updated_by_email = $7, updated_at = now() " +
      "WHERE integration_id = (SELECT integration_id FROM target) " +
      "AND NOT (SELECT has_conflict FROM identity_conflict) " +
      "RETURNING integration_id, ashby_webhook_secret_ciphertext, false AS identity_conflict" +
      "), inserted AS (" +
      "INSERT INTO ashby_company_integrations " +
      "(integration_id, organization_id, email_domain, ashby_api_key_ciphertext, ashby_webhook_secret_ciphertext, setup_status, created_by_email, updated_by_email) " +
      "SELECT $1, $2, $3, $4, $5, $6, $7, $7 " +
      "WHERE NOT EXISTS (SELECT 1 FROM matching_integrations) " +
      "AND NOT (SELECT has_conflict FROM identity_conflict) " +
      "RETURNING integration_id, ashby_webhook_secret_ciphertext, false AS identity_conflict" +
      ") SELECT integration_id, ashby_webhook_secret_ciphertext, identity_conflict FROM updated " +
      "UNION ALL SELECT integration_id, ashby_webhook_secret_ciphertext, identity_conflict FROM inserted " +
      "UNION ALL SELECT NULL::text AS integration_id, NULL::text AS ashby_webhook_secret_ciphertext, true AS identity_conflict " +
      "WHERE (SELECT has_conflict FROM identity_conflict)",
    params: [
      integrationId,
      input.organizationId ?? null,
      normalizeEmailDomain(input.emailDomain),
      input.ashbyApiKeyCiphertext,
      input.ashbyWebhookSecretCiphertext,
      "job_selection_pending",
      input.reviewerEmail,
    ],
  };
}

export function integrationJobsUpdateStatement(input: {
  readonly integrationId: string;
  readonly selectedJobIds: readonly string[];
  readonly reviewerEmail: string;
}): SqlStatement {
  return {
    sql:
      "UPDATE ashby_company_integrations SET selected_job_ids = $2, setup_status = 'pending_webhook', " +
      "updated_by_email = $3, updated_at = now() WHERE integration_id = $1 " +
      "RETURNING integration_id, email_domain, ashby_webhook_secret_ciphertext, selected_job_ids",
    params: [input.integrationId, [...input.selectedJobIds], input.reviewerEmail],
  };
}

export function integrationSecretLookupStatement(integrationId: string): SqlStatement {
  return {
    sql:
      "SELECT integration_id, email_domain, ashby_api_key_ciphertext, ashby_webhook_secret_ciphertext, selected_job_ids " +
      "FROM ashby_company_integrations WHERE integration_id = $1 LIMIT 1",
    params: [integrationId],
  };
}

export function markIntegrationSyncedStatement(integrationId: string): SqlStatement {
  return {
    sql: "UPDATE ashby_company_integrations SET last_sync_at = now(), updated_at = now() WHERE integration_id = $1",
    params: [integrationId],
  };
}
```

Update `markIntegrationPingStatement`:

```ts
export function markIntegrationPingStatement(integrationId: string): SqlStatement {
  return {
    sql:
      "UPDATE ashby_company_integrations " +
      "SET connected_at = COALESCE(connected_at, now()), last_ping_at = now(), setup_status = 'connected', updated_at = now() " +
      "WHERE integration_id = $1",
    params: [integrationId],
  };
}
```

- [ ] **Step 4: Run repository tests and build**

Run:

```bash
cd backend && npm test -- ashby-repository.test.ts && npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/ashby/repository.ts backend/test/ashby-repository.test.ts
git commit -m "feat: ashby setup sql"
```

## Task 5: Backend Onboarding Routes

**Files:**
- Modify: `backend/src/ashby/routes.ts`
- Modify: `backend/src/ashby/types.ts`
- Modify: `backend/test/ashby-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Append to `backend/test/ashby-routes.test.ts`:

```ts
it("onboards an Ashby API key and returns jobs without leaking the API key", async () => {
  process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
  const previousFetch = global.fetch;
  global.fetch = vi.fn(async () =>
    new Response(
      JSON.stringify({
        success: true,
        results: [{ id: "job_1", name: "Founding Engineer", status: "Open" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ) as unknown as typeof fetch;
  queryMock.mockResolvedValueOnce({
    rows: [
      {
        integration_id: "int_1",
        ashby_webhook_secret_ciphertext: "encrypted-webhook",
        identity_conflict: false,
      },
    ],
    rowCount: 1,
  });

  const app = buildServer(FAKE_LK);
  try {
    const res = await app.inject({
      method: "POST",
      url: "/integrations/ashby/onboarding/api-key",
      headers: { "content-type": "application/json" },
      payload: {
        emailDomain: "usepuddle.com",
        organizationId: null,
        reviewerEmail: "admin@usepuddle.com",
        ashbyApiKey: "ashby-secret",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      integrationId: "int_1",
      emailDomain: "usepuddle.com",
      setupStatus: "job_selection_pending",
      jobs: [{ id: "job_1", name: "Founding Engineer", status: "Open" }],
    });
    expect(JSON.stringify(res.json())).not.toContain("ashby-secret");
  } finally {
    global.fetch = previousFetch;
    await app.close();
  }
});

it("stores selected jobs and returns webhook setup values", async () => {
  process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
  const encryptedWebhookSecret = "v1:encrypted";
  const decryptedWebhookSecret = "webhook-secret";
  queryMock
    .mockResolvedValueOnce({
      rows: [
        {
          integration_id: "int_1",
          email_domain: "usepuddle.com",
          ashby_webhook_secret_ciphertext: encryptedWebhookSecret,
        },
      ],
      rowCount: 1,
    })
    .mockResolvedValueOnce({
      rows: [
        {
          integration_id: "int_1",
          email_domain: "usepuddle.com",
          ashby_webhook_secret_ciphertext: encryptIntegrationSecret(
            decryptedWebhookSecret,
            "test-secret",
          ),
          selected_job_ids: ["job_1"],
        },
      ],
      rowCount: 1,
    });

  const app = buildServer(FAKE_LK);
  try {
    const res = await app.inject({
      method: "POST",
      url: "/integrations/ashby/onboarding/jobs",
      headers: { "content-type": "application/json" },
      payload: {
        emailDomain: "usepuddle.com",
        organizationId: null,
        reviewerEmail: "admin@usepuddle.com",
        selectedJobIds: ["job_1"],
        publicBaseUrl: "https://app.usepuddle.com",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      integrationId: "int_1",
      webhookUrl: "https://app.usepuddle.com/api/ashby/webhook?integrationId=int_1",
      webhookSecret: decryptedWebhookSecret,
      requiredEvents: [
        "ping",
        "applicationSubmit",
        "applicationUpdate",
        "candidateStageChange",
        "candidateDelete",
        "candidateMerge",
        "candidateHire",
      ],
    });
  } finally {
    await app.close();
  }
});
```

Use the real helper name from `backend/src/ashby/crypto.ts` when importing encryption in the test:

```ts
import { encryptIntegrationSecret } from "../src/ashby/crypto.js";
```

- [ ] **Step 2: Run route tests to verify failure**

Run:

```bash
cd backend && npm test -- ashby-routes.test.ts
```

Expected: FAIL because the onboarding endpoints do not exist.

- [ ] **Step 3: Add onboarding types**

In `backend/src/ashby/types.ts`, add:

```ts
export interface AshbyApiKeyOnboardingRequest extends CompanyIdentity {
  readonly reviewerEmail: string;
  readonly ashbyApiKey: string;
}

export interface AshbyJobSelectionRequest extends CompanyIdentity {
  readonly reviewerEmail: string;
  readonly selectedJobIds: readonly string[];
  readonly publicBaseUrl: string;
}

export interface AshbySyncRequest extends CompanyIdentity {
  readonly reviewerEmail?: string;
}
```

- [ ] **Step 4: Implement onboarding route helpers**

In `backend/src/ashby/routes.ts`, import new helpers:

```ts
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  generateIntegrationSecret,
  integrationSecretKeyFromEnv,
} from "./crypto.js";
import { listActiveApplicationsForJob, listJobs, syncedApplicationFromAshby } from "./client.js";
import {
  integrationApiKeyUpsertStatement,
  integrationJobsUpdateStatement,
  integrationSecretLookupStatement,
  markIntegrationSyncedStatement,
} from "./repository.js";
```

Add constants near existing webhook action constants:

```ts
const REQUIRED_WEBHOOK_EVENTS = [
  "ping",
  "applicationSubmit",
  "applicationUpdate",
  "candidateStageChange",
  "candidateDelete",
  "candidateMerge",
  "candidateHire",
] as const;
```

Add safe URL helper:

```ts
function publicBaseUrl(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) {
    return null;
  }

  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      return null;
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Implement API key onboarding route**

Add inside `registerAshbyRoutes` before the existing internal setup route:

```ts
app.post<{ Body: AshbyApiKeyOnboardingRequest }>(
  "/integrations/ashby/onboarding/api-key",
  async (request, reply) => {
    const identity = companyIdentity(request.body);
    const body = objectValue(request.body);
    const reviewerEmail = stringValue(body?.reviewerEmail);
    const apiKey = stringValue(body?.ashbyApiKey);
    if (!identity || !reviewerEmail || !apiKey) {
      return reply.code(400).send({ error: "emailDomain, reviewerEmail, and ashbyApiKey are required" });
    }

    let jobs;
    try {
      jobs = await listJobs({ apiKey });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : "Ashby API key validation failed",
      });
    }

    const secretKey = integrationSecretKeyFromEnv();
    const encryptedApiKey = encryptIntegrationSecret(apiKey, secretKey);
    const encryptedWebhookSecret = encryptIntegrationSecret(generateIntegrationSecret(), secretKey);
    const stmt = integrationApiKeyUpsertStatement({
      organizationId: identity.organizationId,
      emailDomain: identity.emailDomain,
      reviewerEmail,
      ashbyApiKeyCiphertext: encryptedApiKey,
      ashbyWebhookSecretCiphertext: encryptedWebhookSecret,
    });
    const { rows } = await getPool().query<SetupRow & { ashby_webhook_secret_ciphertext?: unknown }>(
      stmt.sql,
      [...stmt.params],
    );
    const row = rows[0];
    if (row?.identity_conflict) {
      return reply.code(409).send({
        error: "Ashby identity conflict: organizationId and emailDomain match different integrations.",
      });
    }

    const integrationId = stringValue(row?.integration_id);
    if (!integrationId) {
      return reply.code(500).send({ error: "Ashby onboarding did not return an integration id" });
    }

    return reply.code(201).send({
      integrationId,
      emailDomain: identity.emailDomain,
      setupStatus: "job_selection_pending",
      jobs,
    });
  },
);
```

- [ ] **Step 6: Implement job selection route**

Add inside `registerAshbyRoutes`:

```ts
app.post<{ Body: AshbyJobSelectionRequest }>(
  "/integrations/ashby/onboarding/jobs",
  async (request, reply) => {
    const identity = companyIdentity(request.body);
    const body = objectValue(request.body);
    const reviewerEmail = stringValue(body?.reviewerEmail);
    const jobs = selectedJobIds(body?.selectedJobIds);
    const baseUrl = publicBaseUrl(body?.publicBaseUrl);
    if (!identity || !reviewerEmail || jobs.length === 0 || !baseUrl) {
      return reply.code(400).send({
        error: "emailDomain, reviewerEmail, selectedJobIds, and publicBaseUrl are required",
      });
    }

    const integration = await integrationForIdentity(identity);
    const integrationId = integrationIdFrom(integration);
    if (!integrationId) {
      return reply.code(404).send({ error: "Ashby integration is not configured" });
    }

    const update = integrationJobsUpdateStatement({
      integrationId,
      selectedJobIds: jobs,
      reviewerEmail,
    });
    const { rows } = await getPool().query<IntegrationRow>(update.sql, [...update.params]);
    const updated = rows[0];
    const encryptedWebhookSecret = stringValue(updated?.ashby_webhook_secret_ciphertext);
    if (!encryptedWebhookSecret) {
      return reply.code(500).send({ error: "Ashby webhook secret is not configured" });
    }

    const webhookSecret = decryptIntegrationSecret(encryptedWebhookSecret, integrationSecretKeyFromEnv());
    return reply.send({
      integrationId,
      webhookUrl: `${baseUrl}/api/ashby/webhook?integrationId=${encodeURIComponent(integrationId)}`,
      webhookSecret,
      requiredEvents: REQUIRED_WEBHOOK_EVENTS,
    });
  },
);
```

Update `IntegrationRow` to include `ashby_webhook_secret_ciphertext`, `setup_status`, and `last_sync_at`.

- [ ] **Step 7: Run backend tests and build**

Run:

```bash
cd backend && npm test -- ashby-routes.test.ts && npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/ashby/routes.ts backend/src/ashby/types.ts backend/test/ashby-routes.test.ts
git commit -m "feat: ashby onboarding api"
```

## Task 6: Backend Webhook Verification and Sync Timestamp

**Files:**
- Modify: `backend/src/ashby/routes.ts`
- Modify: `backend/src/ashby/types.ts`
- Modify: `backend/test/ashby-routes.test.ts`

- [ ] **Step 1: Write failing webhook verification tests**

Append to `backend/test/ashby-routes.test.ts`:

```ts
it("rejects Ashby webhooks with invalid per-company signatures before parsing JSON", async () => {
  process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
  queryMock.mockResolvedValueOnce({
    rows: [
      {
        integration_id: "int_1",
        ashby_webhook_secret_ciphertext: encryptIntegrationSecret("webhook-secret", "test-secret"),
      },
    ],
    rowCount: 1,
  });

  const app = buildServer(FAKE_LK);
  try {
    const res = await app.inject({
      method: "POST",
      url: "/integrations/ashby/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        integrationId: "int_1",
        rawBody: "{not json",
        signature: "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      },
    });

    expect(res.statusCode).toBe(401);
    expect(queryMock).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});

it("marks setup connected when a signed ping is received", async () => {
  process.env.PUDDLE_INTEGRATION_SECRET_KEY = "test-secret";
  const rawBody = JSON.stringify({ action: "ping", data: { webhookId: "hook_1" } });
  const signature = `sha256=${ashbyWebhookDigest(rawBody, "webhook-secret")}`;
  queryMock
    .mockResolvedValueOnce({
      rows: [
        {
          integration_id: "int_1",
          ashby_webhook_secret_ciphertext: encryptIntegrationSecret("webhook-secret", "test-secret"),
        },
      ],
      rowCount: 1,
    })
    .mockResolvedValueOnce({ rows: [], rowCount: 1 });

  const app = buildServer(FAKE_LK);
  try {
    const res = await app.inject({
      method: "POST",
      url: "/integrations/ashby/webhook",
      headers: { "content-type": "application/json" },
      payload: {
        integrationId: "int_1",
        rawBody,
        signature,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(String(queryMock.mock.calls[1]?.[0])).toContain("setup_status = 'connected'");
  } finally {
    await app.close();
  }
});
```

Add import:

```ts
import { ashbyWebhookDigest } from "../src/ashby/webhook-signature.js";
```

- [ ] **Step 2: Run route tests to verify failure**

Run:

```bash
cd backend && npm test -- ashby-routes.test.ts
```

Expected: FAIL because webhook route still expects parsed payload and does not verify signatures.

- [ ] **Step 3: Update webhook envelope type**

In `backend/src/ashby/types.ts`, replace `AshbyWebhookEnvelope` with:

```ts
export interface AshbyWebhookEnvelope {
  readonly integrationId?: string | null;
  readonly companyDomain?: string | null;
  readonly rawBody?: string | null;
  readonly signature?: string | null;
  readonly payload?: unknown;
}
```

Keep `payload` only for temporary compatibility with the internal setup path.

- [ ] **Step 4: Implement backend signature verification**

In `backend/src/ashby/routes.ts`, import:

```ts
import { verifyAshbyWebhookSignature } from "./webhook-signature.js";
```

At the start of `/integrations/ashby/webhook`, replace parsed-payload-first logic with:

```ts
const envelope = objectValue(request.body);
const integration = await integrationForWebhook({
  integrationId: stringValue(envelope?.integrationId),
  companyDomain: stringValue(envelope?.companyDomain),
});
const resolvedIntegrationId = integrationIdFrom(integration);
if (!resolvedIntegrationId) {
  return reply.code(404).send({ error: "Ashby integration is not configured" });
}

let payload: AshbyWebhookPayload | null = null;
const rawBody = stringValue(envelope?.rawBody);
if (rawBody) {
  const encryptedWebhookSecret = stringValue(integration?.ashby_webhook_secret_ciphertext);
  if (!encryptedWebhookSecret) {
    return reply.code(404).send({ error: "Ashby webhook secret is not configured" });
  }

  const webhookSecret = decryptIntegrationSecret(encryptedWebhookSecret, integrationSecretKeyFromEnv());
  if (
    !verifyAshbyWebhookSignature({
      body: rawBody,
      secret: webhookSecret,
      signature: stringValue(envelope?.signature),
    })
  ) {
    return reply.code(401).send({ error: "invalid webhook signature" });
  }

  try {
    payload = JSON.parse(rawBody) as AshbyWebhookPayload;
  } catch {
    return reply.code(400).send({ error: "invalid Ashby webhook json" });
  }
} else {
  payload = objectValue(envelope?.payload) as AshbyWebhookPayload | null;
}

const action = stringValue(payload?.action);
if (!payload || !action) {
  return reply.code(400).send({ error: "valid Ashby webhook payload is required" });
}
```

Remove the duplicate later `integrationForWebhook` lookup from the same route.

- [ ] **Step 5: Update sync route to mark last sync**

At the end of `/integrations/ashby/sync-active-applications`, before sending the response, run:

```ts
const synced = markIntegrationSyncedStatement(integrationId);
await getPool().query(synced.sql, [...synced.params]);
```

- [ ] **Step 6: Run route tests and build**

Run:

```bash
cd backend && npm test -- ashby-routes.test.ts && npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/ashby/routes.ts backend/src/ashby/types.ts backend/test/ashby-routes.test.ts
git commit -m "feat: verify ashby hooks"
```

## Task 7: Platform Onboarding API Routes and Webhook Proxy

**Files:**
- Create: `platform/app/api/ashby/onboarding/api-key/route.ts`
- Create: `platform/app/api/ashby/onboarding/jobs/route.ts`
- Create: `platform/app/api/ashby/onboarding/sync/route.ts`
- Modify: `platform/app/api/ashby/webhook/route.ts`
- Modify: `platform/lib/ashby/server.ts`
- Create: `platform/tests/ashby-onboarding-source.test.mjs`

- [ ] **Step 1: Write failing platform source tests**

Create `platform/tests/ashby-onboarding-source.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiKeyRoute = await readFile(
  new URL("../app/api/ashby/onboarding/api-key/route.ts", import.meta.url),
  "utf8",
).catch(() => "");
const jobsRoute = await readFile(
  new URL("../app/api/ashby/onboarding/jobs/route.ts", import.meta.url),
  "utf8",
).catch(() => "");
const syncRoute = await readFile(
  new URL("../app/api/ashby/onboarding/sync/route.ts", import.meta.url),
  "utf8",
).catch(() => "");
const webhookRoute = await readFile(new URL("../app/api/ashby/webhook/route.ts", import.meta.url), "utf8");

test("Ashby onboarding API routes are authenticated and derive company identity server-side", () => {
  for (const source of [apiKeyRoute, jobsRoute, syncRoute]) {
    assert.match(source, /withAuth/);
    assert.match(source, /isAllowedAuthEmail/);
    assert.match(source, /companyIdentityFromUser/);
    assert.match(source, /PUDDLE_BACKEND_BASE_URL|backendBaseUrl/);
    assert.doesNotMatch(source, /emailDomain:\s*body\.emailDomain/);
    assert.doesNotMatch(source, /organizationId:\s*body\.organizationId/);
  }
});

test("Ashby webhook proxy forwards raw body and signature to backend", () => {
  assert.match(webhookRoute, /request\.text\(\)/);
  assert.match(webhookRoute, /request\.headers\.get\("ashby-signature"\)/);
  assert.match(webhookRoute, /rawBody/);
  assert.match(webhookRoute, /signature/);
  assert.doesNotMatch(webhookRoute, /PUDDLE_ASHBY_WEBHOOK_SECRET/);
  assert.doesNotMatch(webhookRoute, /verifyAshbyWebhookSignature/);
});
```

- [ ] **Step 2: Run platform source test to verify failure**

Run:

```bash
cd platform && node --test tests/ashby-onboarding-source.test.mjs
```

Expected: FAIL because onboarding routes do not exist and webhook route still verifies a global secret.

- [ ] **Step 3: Add shared route helper pattern**

In each onboarding route file, use this structure:

```ts
import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { companyIdentityFromUser } from "@/lib/ashby/server";
import { isAllowedAuthEmail } from "@/lib/auth/allowed-domains";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
```

- [ ] **Step 4: Create API key onboarding route**

Create `platform/app/api/ashby/onboarding/api-key/route.ts`:

```ts
import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { companyIdentityFromUser } from "@/lib/ashby/server";
import { isAllowedAuthEmail } from "@/lib/auth/allowed-domains";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function POST(request: Request) {
  const { user, organizationId } = await withAuth();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (!isAllowedAuthEmail(user.email)) {
    return NextResponse.json({ error: "Email domain is not allowed." }, { status: 403 });
  }

  const body = objectBody(await request.json().catch(() => ({})));
  const ashbyApiKey = typeof body.ashbyApiKey === "string" ? body.ashbyApiKey : "";
  const identity = companyIdentityFromUser({ email: user.email, organizationId });

  let response: Response;
  try {
    response = await fetch(`${backendBaseUrl()}/integrations/ashby/onboarding/api-key`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({
        ...identity,
        reviewerEmail: user.email,
        ashbyApiKey,
      }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
```

- [ ] **Step 5: Create jobs route**

Create `platform/app/api/ashby/onboarding/jobs/route.ts` with the same auth pattern and this backend body:

```ts
body: JSON.stringify({
  ...identity,
  reviewerEmail: user.email,
  selectedJobIds: Array.isArray(body.selectedJobIds)
    ? body.selectedJobIds.filter((jobId): jobId is string => typeof jobId === "string")
    : [],
  publicBaseUrl: process.env.PUDDLE_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
}),
```

Use endpoint:

```ts
`${backendBaseUrl()}/integrations/ashby/onboarding/jobs`
```

- [ ] **Step 6: Create sync route**

Create `platform/app/api/ashby/onboarding/sync/route.ts` with the same auth pattern and endpoint:

```ts
`${backendBaseUrl()}/integrations/ashby/onboarding/sync`
```

Use backend body:

```ts
JSON.stringify({
  ...identity,
  reviewerEmail: user.email,
})
```

- [ ] **Step 7: Update webhook proxy**

Replace `platform/app/api/ashby/webhook/route.ts` with a raw-body proxy:

```ts
import { NextResponse } from "next/server";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("ashby-signature");
  const url = new URL(request.url);
  const integrationId = url.searchParams.get("integrationId");
  const companyDomain = url.searchParams.get("companyDomain");

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${backendBaseUrl()}/integrations/ashby/webhook`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({ integrationId, companyDomain, rawBody, signature }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const responsePayload = await backendResponse.json().catch(() => ({}));
  return NextResponse.json(responsePayload, { status: backendResponse.status });
}
```

- [ ] **Step 8: Run platform tests and build**

Run:

```bash
cd platform && node --test tests/ashby-onboarding-source.test.mjs && npm run lint && npm run build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add platform/app/api/ashby/onboarding platform/app/api/ashby/webhook/route.ts platform/lib/ashby/server.ts platform/tests/ashby-onboarding-source.test.mjs
git commit -m "feat: ashby setup routes"
```

## Task 8: Platform Dashboard Onboarding Wizard

**Files:**
- Create: `platform/app/dashboard/AshbyOnboardingWizard.tsx`
- Modify: `platform/app/dashboard/DashboardSections.tsx`
- Modify: `platform/app/dashboard/page.tsx`
- Modify: `platform/lib/ashby/server.ts`
- Modify: `platform/tests/ashby-onboarding-source.test.mjs`

- [ ] **Step 1: Extend source test for wizard behavior**

Append to `platform/tests/ashby-onboarding-source.test.mjs`:

```js
const wizardSource = await readFile(
  new URL("../app/dashboard/AshbyOnboardingWizard.tsx", import.meta.url),
  "utf8",
).catch(() => "");
const dashboardSource = await readFile(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");

test("dashboard uses the Ashby onboarding wizard for non-connected companies", () => {
  assert.match(dashboardSource, /AshbyOnboardingWizard/);
  assert.match(wizardSource, /\/api\/ashby\/onboarding\/api-key/);
  assert.match(wizardSource, /\/api\/ashby\/onboarding\/jobs/);
  assert.match(wizardSource, /\/api\/ashby\/onboarding\/sync/);
  assert.match(wizardSource, /webhookSecret/);
  assert.match(wizardSource, /requiredEvents/);
  assert.match(wizardSource, /navigator\.clipboard\.writeText/);
});
```

- [ ] **Step 2: Run platform source test to verify failure**

Run:

```bash
cd platform && node --test tests/ashby-onboarding-source.test.mjs
```

Expected: FAIL because `AshbyOnboardingWizard.tsx` is missing and dashboard does not import it.

- [ ] **Step 3: Extend platform Ashby types**

In `platform/lib/ashby/server.ts`, update `AshbyCompanyState`:

```ts
export interface AshbyCompanyState {
  readonly connected: boolean;
  readonly setupStatus: string;
  readonly integrationId: string | null;
  readonly emailDomain: string;
  readonly selectedJobIds: readonly string[];
  readonly lastPingAt: string | null;
  readonly lastSyncAt: string | null;
  readonly webhookUrlPath?: string | null;
}
```

Add:

```ts
export interface AshbyJobOption {
  readonly id: string;
  readonly name: string;
  readonly status: string | null;
}
```

- [ ] **Step 4: Create onboarding wizard**

Create `platform/app/dashboard/AshbyOnboardingWizard.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { AshbyCompanyState, AshbyJobOption } from "@/lib/ashby/server";
import { cx, primaryButtonClass } from "./dashboard-ui";

interface SetupPayload {
  readonly integrationId: string;
  readonly webhookUrl: string;
  readonly webhookSecret: string;
  readonly requiredEvents: readonly string[];
}

type Feedback = { readonly tone: "success" | "error"; readonly text: string } | null;

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }
  return fallback;
}

function jobOptions(payload: unknown): AshbyJobOption[] {
  if (!payload || typeof payload !== "object" || !("jobs" in payload) || !Array.isArray(payload.jobs)) {
    return [];
  }
  return payload.jobs.filter((job): job is AshbyJobOption => {
    if (!job || typeof job !== "object") {
      return false;
    }
    const value = job as Record<string, unknown>;
    return typeof value.id === "string" && typeof value.name === "string";
  });
}

export function AshbyOnboardingWizard({ state }: { readonly state: AshbyCompanyState }) {
  const [apiKey, setApiKey] = useState("");
  const [jobs, setJobs] = useState<AshbyJobOption[]>([]);
  const [selectedJobIds, setSelectedJobIds] = useState<readonly string[]>(state.selectedJobIds);
  const [setup, setSetup] = useState<SetupPayload | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const canSubmitApiKey = apiKey.trim().length > 0 && !isSubmitting;
  const canSubmitJobs = selectedJobIds.length > 0 && !isSubmitting;
  const statusLabel = state.connected ? "Connected" : setup ? "Waiting for ping" : "Setup required";
  const selectedJobs = useMemo(() => new Set(selectedJobIds), [selectedJobIds]);

  async function submitApiKey() {
    setIsSubmitting(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/ashby/onboarding/api-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ashbyApiKey: apiKey }),
      });
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({ tone: "error", text: errorMessage(payload, "Could not validate Ashby API key.") });
        return;
      }
      setJobs(jobOptions(payload));
      setFeedback({ tone: "success", text: "Ashby API key validated." });
    } catch {
      setFeedback({ tone: "error", text: "Could not reach Ashby onboarding API." });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitJobs() {
    setIsSubmitting(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/ashby/onboarding/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selectedJobIds }),
      });
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({ tone: "error", text: errorMessage(payload, "Could not save Ashby jobs.") });
        return;
      }
      setSetup(payload as SetupPayload);
      setFeedback({ tone: "success", text: "Webhook setup values generated." });
    } catch {
      setFeedback({ tone: "error", text: "Could not save Ashby jobs." });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function runSync() {
    setIsSyncing(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/ashby/onboarding/sync", { method: "POST" });
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFeedback({ tone: "error", text: errorMessage(payload, "Could not sync active Ashby candidates.") });
        return;
      }
      setFeedback({ tone: "success", text: "Active Ashby candidates synced." });
    } catch {
      setFeedback({ tone: "error", text: "Could not reach Ashby sync API." });
    } finally {
      setIsSyncing(false);
    }
  }

  function toggleJob(jobId: string) {
    setSelectedJobIds((current) =>
      current.includes(jobId) ? current.filter((id) => id !== jobId) : [...current, jobId],
    );
  }

  return (
    <div className="grid gap-4 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-700">Connect Ashby</div>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">{state.emailDomain}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            One company-level Ashby connection unlocks candidate search and scorecards for teammates on this domain.
          </p>
        </div>
        <div className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
          {statusLabel}
        </div>
      </div>

      <div className="grid gap-3">
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          Ashby API key
          <input
            value={apiKey}
            type="password"
            autoComplete="off"
            disabled={isSubmitting}
            onChange={(event) => setApiKey(event.target.value)}
            className="min-h-10 rounded-md border border-slate-300 px-3 text-sm text-slate-950 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
          />
        </label>
        <button
          type="button"
          disabled={!canSubmitApiKey}
          onClick={() => void submitApiKey()}
          className={cx(primaryButtonClass, "w-fit disabled:cursor-not-allowed disabled:opacity-60")}
        >
          Validate key
        </button>
      </div>

      {jobs.length ? (
        <div className="grid gap-2">
          <div className="text-sm font-semibold text-slate-800">Ashby jobs</div>
          {jobs.map((job) => (
            <label key={job.id} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={selectedJobs.has(job.id)}
                onChange={() => toggleJob(job.id)}
              />
              <span className="font-medium">{job.name}</span>
              {job.status ? <span className="text-xs text-slate-500">{job.status}</span> : null}
            </label>
          ))}
          <button
            type="button"
            disabled={!canSubmitJobs}
            onClick={() => void submitJobs()}
            className={cx(primaryButtonClass, "w-fit disabled:cursor-not-allowed disabled:opacity-60")}
          >
            Save jobs
          </button>
        </div>
      ) : null}

      {setup ? (
        <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <CopyField label="Webhook URL" value={setup.webhookUrl} />
          <CopyField label="Webhook secret" value={setup.webhookSecret} secret />
          <div className="grid gap-2">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Required events</div>
            {setup.requiredEvents.map((event) => (
              <div key={event} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800">
                {event}
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={isSyncing}
            onClick={() => void runSync()}
            className={cx(primaryButtonClass, "w-fit disabled:cursor-not-allowed disabled:opacity-60")}
          >
            Sync active candidates
          </button>
        </div>
      ) : null}

      {feedback ? (
        <div
          role="status"
          aria-live="polite"
          className={cx(
            "rounded-md border px-3 py-2 text-sm font-medium",
            feedback.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900",
          )}
        >
          {feedback.text}
        </div>
      ) : null}
    </div>
  );
}

function CopyField({
  label,
  value,
  secret = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly secret?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1.5">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800">
          {secret ? value : value}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            });
          }}
          className="min-h-9 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-800 hover:bg-white"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire dashboard page**

In `platform/app/dashboard/page.tsx`, import:

```ts
import { AshbyOnboardingWizard } from "./AshbyOnboardingWizard";
```

Replace the not-connected branch:

```tsx
{state.connected ? (
  <RecentScreensTable screens={screens} />
) : (
  <AshbyOnboardingWizard state={state} />
)}
```

Remove `publicBaseUrl` and `AshbySetupPanel` imports if unused.

- [ ] **Step 6: Remove internal setup panel if unused**

In `platform/app/dashboard/DashboardSections.tsx`, delete `AshbySetupPanel` only if no other imports remain. Keep `RecentScreensTable`.

- [ ] **Step 7: Run platform checks**

Run:

```bash
cd platform && node --test tests/ashby-onboarding-source.test.mjs tests/score-tab-source.test.mjs && npm run lint && npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add platform/app/dashboard/AshbyOnboardingWizard.tsx platform/app/dashboard/DashboardSections.tsx platform/app/dashboard/page.tsx platform/lib/ashby/server.ts platform/tests/ashby-onboarding-source.test.mjs
git commit -m "feat: ashby setup wizard"
```

## Task 9: Runbook and End-to-End Verification

**Files:**
- Modify: `platform/docs/ashby-internal-setup.md`
- Modify: `docs/RUNBOOK.md`

- [ ] **Step 1: Update Ashby setup runbook**

Replace `platform/docs/ashby-internal-setup.md` content with:

```md
# Ashby Self-Serve Setup

## Runtime prerequisites

The backend service and backend migration task require:

```text
PUDDLE_INTEGRATION_SECRET_KEY
```

This value comes from AWS Secrets Manager at:

```text
/puddle-videoagent/integrations/encryption-key
```

The platform does not need `PUDDLE_ASHBY_WEBHOOK_SECRET`.

## Customer setup

1. Sign in to `/dashboard` with an allowed company email domain.
2. Paste an Ashby API key.
3. Select one or more Ashby jobs.
4. Copy the generated webhook URL and webhook secret.
5. In Ashby, create webhooks for:
   - `ping`
   - `applicationSubmit`
   - `applicationUpdate`
   - `candidateStageChange`
   - `candidateDelete`
   - `candidateMerge`
   - `candidateHire`
6. Use the generated Puddle webhook URL as the request URL.
7. Use the generated Puddle webhook secret as the Ashby secret token.
8. Wait for the Ashby `ping` to mark the setup connected.
9. Run initial active candidate sync from the Puddle dashboard.

## Local testing

Use `pnpm dev:connected` to run localhost against the deployed dev backend.
Use a public HTTPS tunnel only when testing real Ashby webhook delivery against
localhost.
```
```

- [ ] **Step 2: Update connected-dev runbook note**

In `docs/RUNBOOK.md`, in the connected backend section, add:

```md
Ashby self-serve onboarding requires `PUDDLE_INTEGRATION_SECRET_KEY` in the
backend runtime. The deployed backend receives it from Secrets Manager. If you
run `pnpm dev:backend:connected`, export the same dev secret locally before
testing Ashby onboarding routes.
```

- [ ] **Step 3: Run full verification**

Run:

```bash
cd infra && npm test -- --runInBand && npm run build
cd ../backend && npm test && npm run build
cd ../platform && node --test tests/ashby-onboarding-source.test.mjs tests/score-tab-source.test.mjs && npm run lint && npm run build
```

Expected: all commands PASS.

- [ ] **Step 4: Commit docs**

```bash
git add platform/docs/ashby-internal-setup.md docs/RUNBOOK.md
git commit -m "docs: ashby setup flow"
```

## Task 10: Manual Acceptance Test

**Files:**
- No source edits expected.

- [ ] **Step 1: Deploy dev with latest images and migrations**

Run the existing deployment path for dev. Confirm backend migration task applies:

```text
007_ashby_self_serve_onboarding
```

Expected: migration task exits 0 and `schema_migrations` contains the new version.

- [ ] **Step 2: Open dashboard and connect Ashby**

Open:

```text
https://app.usepuddle.com/dashboard
```

Expected:

- Not-connected company shows Ashby onboarding wizard.
- API key validation returns jobs.
- Job selection returns webhook URL and webhook secret.

- [ ] **Step 3: Configure Ashby webhooks**

In Ashby Admin > Integrations > Webhooks, create webhooks for:

```text
ping
applicationSubmit
applicationUpdate
candidateStageChange
candidateDelete
candidateMerge
candidateHire
```

Use the Puddle webhook URL and generated webhook secret.

Expected: Ashby sends `ping`; Puddle marks setup connected.

- [ ] **Step 4: Sync and score**

In Puddle:

1. Run active candidate sync.
2. Open a role `Score` tab.
3. Search a synced Ashby candidate.
4. Select the candidate.
5. Save scores.
6. Return to `/dashboard`.

Expected: saved score appears under recent screens.

- [ ] **Step 5: Same-domain bypass**

Sign in as another allowed user on the same email domain.

Expected: user lands on recent screens and does not see Ashby setup.

- [ ] **Step 6: Final implementation commit if needed**

If the manual acceptance test required a small fix, commit it:

```bash
git add <changed-files>
git commit -m "fix: ashby setup polish"
```

If no fix was needed, do not create an empty commit.
