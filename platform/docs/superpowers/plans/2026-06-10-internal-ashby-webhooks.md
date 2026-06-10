# Internal Ashby Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the internal Ashby webhook setup, active-candidate sync, same-domain integration bypass, recent screens dashboard, and role-level score tab.

**Architecture:** The platform app verifies Ashby webhooks, forwards verified events to the backend, and renders backend-sourced Ashby/screen data. The backend stores company-level Ashby integration records, active applications, webhook idempotency records, and Puddle score records. Same-domain users bypass Ashby setup when the backend finds an active integration for their WorkOS organization ID or normalized email domain.

**Tech Stack:** Next.js 16 App Router, React 19, Fastify 5, PostgreSQL migrations, Vitest, Ashby API `POST https://api.ashbyhq.com/application.list` with HTTP Basic auth.

---

## Scope Check

This work spans platform webhook/UI and backend persistence/API. It stays in one plan because the platform routes, dashboard data, backend sync, and same-domain bypass are one vertical feature: no phase produces the requested user experience alone. Execute in task order and commit after each task.

## File Structure

Platform files:

- Create `platform/lib/backend-api.ts`: shared platform-to-backend URL/header helpers.
- Create `platform/lib/ashby/webhook-signature.ts`: Ashby HMAC verification helper.
- Create `platform/lib/ashby/server.ts`: server-side backend calls for company state and recent screens.
- Create `platform/app/api/ashby/webhook/route.ts`: public Ashby webhook receiver.
- Create `platform/app/api/ashby/applications/search/route.ts`: authenticated candidate search proxy for the score tab.
- Create `platform/app/api/ashby/scores/route.ts`: authenticated score save proxy for the score tab.
- Modify `platform/proxy.ts`: exempt `api/ashby/webhook` from WorkOS auth.
- Modify `platform/.env.example`: document Ashby/backend env vars.
- Modify `platform/app/dashboard/page.tsx`: show recent screens or Ashby setup state.
- Modify `platform/app/dashboard/DashboardSections.tsx`: add recent screens and setup panels.
- Modify `platform/app/dashboard/roles/[roleId]/RoleWorkspaceTabs.tsx`: add `Score` tab.
- Create `platform/app/dashboard/roles/[roleId]/ScoreTab.tsx`: interactive scoring form.

Backend files:

- Create `backend/migrations/005_ashby_integrations.sql`: integration, application, webhook event, and score tables.
- Create `backend/src/ashby/types.ts`: request/response and Ashby payload types.
- Create `backend/src/ashby/crypto.ts`: API key encryption helpers.
- Create `backend/src/ashby/repository.ts`: SQL statement builders.
- Create `backend/src/ashby/client.ts`: Ashby API client for active application sync.
- Create `backend/src/ashby/routes.ts`: Fastify routes for setup, state, sync, webhook ingestion, search, recent screens, and scores.
- Modify `backend/src/server.ts`: register Ashby routes.
- Modify `backend/src/integration/internal-auth.ts`: protect `/integrations/` backend routes.
- Create `backend/test/ashby-crypto.test.ts`: encryption unit tests.
- Create `backend/test/ashby-repository.test.ts`: SQL statement unit tests.
- Create `backend/test/ashby-client.test.ts`: Ashby client unit tests with fake fetch.
- Create `backend/test/ashby-routes.test.ts`: Fastify route behavior tests.

Documentation:

- Create `platform/docs/ashby-internal-setup.md`: manual setup runbook.

---

### Task 1: Platform Webhook Receiver

**Files:**
- Create: `platform/lib/backend-api.ts`
- Create: `platform/lib/ashby/webhook-signature.ts`
- Create: `platform/app/api/ashby/webhook/route.ts`
- Modify: `platform/proxy.ts`
- Modify: `platform/.env.example`

- [ ] **Step 1: Add shared backend helpers**

Create `platform/lib/backend-api.ts`:

```ts
export function backendBaseUrl(): string {
  return (process.env.PUDDLE_BACKEND_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
}

export function backendHeaders(contentType = "application/json"): HeadersInit {
  const headers: Record<string, string> = { "content-type": contentType };
  const token = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN?.trim();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}
```

- [ ] **Step 2: Add Ashby signature verification helper**

Create `platform/lib/ashby/webhook-signature.ts`:

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

- [ ] **Step 3: Add Ashby webhook route**

Create `platform/app/api/ashby/webhook/route.ts`:

```ts
import { NextResponse } from "next/server";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";
import { verifyAshbyWebhookSignature } from "@/lib/ashby/webhook-signature";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ashbyWebhookSecret(): string {
  return process.env.PUDDLE_ASHBY_WEBHOOK_SECRET?.trim() ?? "";
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("ashby-signature");
  const secret = ashbyWebhookSecret();

  if (!verifyAshbyWebhookSignature({ body, secret, signature })) {
    return NextResponse.json({ error: "invalid webhook signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid webhook json" }, { status: 400 });
  }

  const integrationId = new URL(request.url).searchParams.get("integrationId");
  const companyDomain = new URL(request.url).searchParams.get("companyDomain");

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${backendBaseUrl()}/integrations/ashby/webhook`, {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({ integrationId, companyDomain, payload }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const responsePayload = await backendResponse.json().catch(() => ({}));
  if (!backendResponse.ok) {
    return NextResponse.json(
      { error: responsePayload.error ?? "Ashby webhook was rejected." },
      { status: backendResponse.status },
    );
  }

  return NextResponse.json(responsePayload, { status: 200 });
}
```

- [ ] **Step 4: Exempt webhook route from WorkOS proxy**

Modify `platform/proxy.ts` matcher from:

```ts
"/((?!api/livekit/webhook|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|humans.txt|manifest.json|manifest.webmanifest|opengraph-image|twitter-image|icon|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
```

to:

```ts
"/((?!api/livekit/webhook|api/ashby/webhook|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|humans.txt|manifest.json|manifest.webmanifest|opengraph-image|twitter-image|icon|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)",
```

- [ ] **Step 5: Document environment variables**

Append to `platform/.env.example`:

```bash

# Internal Ashby webhook receiver. Use the same secret in Ashby webhook settings.
PUDDLE_ASHBY_WEBHOOK_SECRET=
```

- [ ] **Step 6: Run platform verification**

Run:

```bash
cd platform && npm run lint
```

Expected: exits `0`.

Run:

```bash
cd platform && npm run build
```

Expected: exits `0`.

- [ ] **Step 7: Commit**

```bash
git add platform/lib/backend-api.ts platform/lib/ashby/webhook-signature.ts platform/app/api/ashby/webhook/route.ts platform/proxy.ts platform/.env.example
git commit -m "feat: receive ashby webhooks"
```

---

### Task 2: Backend Ashby Schema

**Files:**
- Create: `backend/migrations/005_ashby_integrations.sql`
- Modify: `backend/src/integration/internal-auth.ts`
- Test: `backend/test/server.test.ts`

- [ ] **Step 1: Add migration**

Create `backend/migrations/005_ashby_integrations.sql`:

```sql
-- 005_ashby_integrations.sql — internal Ashby integration state.

CREATE TABLE ashby_company_integrations (
  integration_id          TEXT PRIMARY KEY,
  organization_id         TEXT,
  email_domain            TEXT NOT NULL,
  ashby_api_key_ciphertext TEXT NOT NULL,
  selected_job_ids        TEXT[] NOT NULL DEFAULT '{}',
  connected_at            TIMESTAMPTZ,
  last_ping_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ashby_company_integrations_email_domain_idx
  ON ashby_company_integrations(email_domain);

CREATE UNIQUE INDEX ashby_company_integrations_organization_id_idx
  ON ashby_company_integrations(organization_id)
  WHERE organization_id IS NOT NULL;

CREATE TABLE ashby_webhook_events (
  webhook_action_id TEXT PRIMARY KEY,
  integration_id    TEXT REFERENCES ashby_company_integrations(integration_id) ON DELETE SET NULL,
  action            TEXT NOT NULL,
  payload           JSONB NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ
);

CREATE INDEX ashby_webhook_events_integration_idx
  ON ashby_webhook_events(integration_id, received_at DESC);

CREATE TABLE ashby_applications (
  application_id   TEXT PRIMARY KEY,
  integration_id   TEXT NOT NULL REFERENCES ashby_company_integrations(integration_id) ON DELETE CASCADE,
  candidate_id     TEXT NOT NULL,
  candidate_name   TEXT NOT NULL,
  candidate_email  TEXT,
  job_id           TEXT NOT NULL,
  current_stage    TEXT,
  source           TEXT,
  status           TEXT NOT NULL,
  ashby_updated_at TIMESTAMPTZ,
  raw_payload      JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ashby_applications_integration_job_status_idx
  ON ashby_applications(integration_id, job_id, status);

CREATE INDEX ashby_applications_candidate_search_idx
  ON ashby_applications(integration_id, lower(candidate_name), lower(candidate_email));

CREATE TABLE ashby_candidate_scores (
  score_id            TEXT PRIMARY KEY,
  integration_id      TEXT NOT NULL REFERENCES ashby_company_integrations(integration_id) ON DELETE CASCADE,
  application_id      TEXT NOT NULL REFERENCES ashby_applications(application_id) ON DELETE CASCADE,
  role_id             TEXT NOT NULL,
  reviewer_email      TEXT NOT NULL,
  problem_solving     NUMERIC(2,1) NOT NULL CHECK (problem_solving >= 0 AND problem_solving <= 4 AND problem_solving * 2 = floor(problem_solving * 2)),
  agency              NUMERIC(2,1) NOT NULL CHECK (agency >= 0 AND agency <= 4 AND agency * 2 = floor(agency * 2)),
  competitiveness     NUMERIC(2,1) NOT NULL CHECK (competitiveness >= 0 AND competitiveness <= 4 AND competitiveness * 2 = floor(competitiveness * 2)),
  curiosity           NUMERIC(2,1) NOT NULL CHECK (curiosity >= 0 AND curiosity <= 4 AND curiosity * 2 = floor(curiosity * 2)),
  total_score         NUMERIC(3,1) NOT NULL CHECK (total_score >= 0 AND total_score <= 16 AND total_score * 2 = floor(total_score * 2)),
  comments            TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (application_id, reviewer_email)
);

CREATE INDEX ashby_candidate_scores_recent_idx
  ON ashby_candidate_scores(integration_id, updated_at DESC);
```

- [ ] **Step 2: Protect `/integrations/` backend routes**

Modify `backend/src/integration/internal-auth.ts`:

```ts
const PROTECTED_POST_PATHS = [
  "/integration/",
  "/integrations/",
  "/candidate/invites/",
  "/internal/",
] as const;
```

- [ ] **Step 3: Add auth test for plural integration route**

Append this test inside `describe("buildServer", ...)` in `backend/test/server.test.ts`:

```ts
  it("requires internal auth for plural integrations routes", async () => {
    const previousToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = "test-token";
    const app = buildServer(FAKE_LK);
    try {
      const unauthenticated = await app.inject({
        method: "POST",
        url: "/integrations/ashby/company-state",
        headers: { "content-type": "application/json" },
        payload: { emailDomain: "usepuddle.com" },
      });
      expect(unauthenticated.statusCode).toBe(401);
    } finally {
      if (previousToken === undefined) {
        delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
      } else {
        process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousToken;
      }
      await app.close();
    }
  });
```

- [ ] **Step 4: Run targeted backend test and expect route not found after auth succeeds**

Run:

```bash
cd backend && npm test -- test/server.test.ts
```

Expected before Task 5 route registration: tests pass because this new test only asserts unauthenticated requests return `401`.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/005_ashby_integrations.sql backend/src/integration/internal-auth.ts backend/test/server.test.ts
git commit -m "feat: add ashby integration schema"
```

---

### Task 3: Backend Ashby Types, Encryption, and Repository

**Files:**
- Create: `backend/src/ashby/types.ts`
- Create: `backend/src/ashby/crypto.ts`
- Create: `backend/src/ashby/repository.ts`
- Create: `backend/test/ashby-crypto.test.ts`
- Create: `backend/test/ashby-repository.test.ts`

- [ ] **Step 1: Add Ashby types**

Create `backend/src/ashby/types.ts`:

```ts
export interface CompanyIdentity {
  readonly organizationId?: string | null;
  readonly emailDomain: string;
}

export interface AshbySetupRequest extends CompanyIdentity {
  readonly ashbyApiKey: string;
  readonly selectedJobIds: readonly string[];
}

export interface AshbyWebhookEnvelope {
  readonly integrationId?: string | null;
  readonly companyDomain?: string | null;
  readonly payload: unknown;
}

export interface AshbyWebhookPayload {
  readonly webhookActionId?: string;
  readonly action: string;
  readonly data?: Record<string, unknown>;
}

export interface SyncedAshbyApplication {
  readonly applicationId: string;
  readonly integrationId: string;
  readonly candidateId: string;
  readonly candidateName: string;
  readonly candidateEmail: string | null;
  readonly jobId: string;
  readonly currentStage: string | null;
  readonly source: string | null;
  readonly status: string;
  readonly ashbyUpdatedAt: string | null;
  readonly rawPayload: Record<string, unknown>;
}

export interface ScoreInput extends CompanyIdentity {
  readonly applicationId: string;
  readonly roleId: string;
  readonly reviewerEmail: string;
  readonly problemSolving: number;
  readonly agency: number;
  readonly competitiveness: number;
  readonly curiosity: number;
  readonly comments: string;
}
```

- [ ] **Step 2: Add encryption helper**

Create `backend/src/ashby/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function keyFromSecret(secret: string): Buffer {
  if (!secret.trim()) {
    throw new Error("PUDDLE_INTEGRATION_SECRET_KEY must be set");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptIntegrationSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptIntegrationSecret(encoded: string, secret: string): string {
  const [version, ivText, tagText, ciphertextText] = encoded.split(":");
  if (version !== VERSION || !ivText || !tagText || !ciphertextText) {
    throw new Error("Invalid encrypted integration secret");
  }
  const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function integrationSecretKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.PUDDLE_INTEGRATION_SECRET_KEY?.trim();
  if (!secret) {
    throw new Error("PUDDLE_INTEGRATION_SECRET_KEY must be set");
  }
  return secret;
}
```

- [ ] **Step 3: Add crypto tests**

Create `backend/test/ashby-crypto.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  integrationSecretKeyFromEnv,
} from "../src/ashby/crypto.js";

describe("Ashby integration secret encryption", () => {
  it("round-trips encrypted secrets", () => {
    const encrypted = encryptIntegrationSecret("ashby-key", "local-secret");
    expect(encrypted).toMatch(/^v1:/);
    expect(decryptIntegrationSecret(encrypted, "local-secret")).toBe("ashby-key");
  });

  it("rejects the wrong secret key", () => {
    const encrypted = encryptIntegrationSecret("ashby-key", "local-secret");
    expect(() => decryptIntegrationSecret(encrypted, "other-secret")).toThrow();
  });

  it("requires a configured integration secret key", () => {
    expect(() => integrationSecretKeyFromEnv({})).toThrow(/PUDDLE_INTEGRATION_SECRET_KEY/);
    expect(integrationSecretKeyFromEnv({ PUDDLE_INTEGRATION_SECRET_KEY: "secret" })).toBe("secret");
  });
});
```

- [ ] **Step 4: Add repository statements**

Create `backend/src/ashby/repository.ts` with these exported functions:

```ts
import { randomUUID } from "node:crypto";
import type { SqlStatement } from "../consent/repository.js";
import type { CompanyIdentity, ScoreInput, SyncedAshbyApplication } from "./types.js";

export function normalizeEmailDomain(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmailDomain(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
    normalizeEmailDomain(value),
  );
}

export function integrationLookupStatement(identity: CompanyIdentity): SqlStatement {
  return {
    sql:
      "SELECT * FROM ashby_company_integrations " +
      "WHERE ($1::text IS NOT NULL AND organization_id = $1) OR email_domain = $2 " +
      "ORDER BY CASE WHEN organization_id = $1 THEN 0 ELSE 1 END LIMIT 1",
    params: [identity.organizationId ?? null, normalizeEmailDomain(identity.emailDomain)],
  };
}

export function integrationSetupUpsertStatement(input: {
  readonly organizationId?: string | null;
  readonly emailDomain: string;
  readonly ashbyApiKeyCiphertext: string;
  readonly selectedJobIds: readonly string[];
  readonly integrationId?: string;
}): SqlStatement {
  const integrationId = input.integrationId ?? randomUUID();
  return {
    sql:
      "INSERT INTO ashby_company_integrations " +
      "(integration_id, organization_id, email_domain, ashby_api_key_ciphertext, selected_job_ids) " +
      "VALUES ($1, $2, $3, $4, $5) " +
      "ON CONFLICT (email_domain) DO UPDATE SET " +
      "organization_id = COALESCE(EXCLUDED.organization_id, ashby_company_integrations.organization_id), " +
      "ashby_api_key_ciphertext = EXCLUDED.ashby_api_key_ciphertext, " +
      "selected_job_ids = EXCLUDED.selected_job_ids, updated_at = now() " +
      "RETURNING integration_id",
    params: [
      integrationId,
      input.organizationId ?? null,
      normalizeEmailDomain(input.emailDomain),
      input.ashbyApiKeyCiphertext,
      [...input.selectedJobIds],
    ],
  };
}

export function markIntegrationPingStatement(integrationId: string): SqlStatement {
  return {
    sql:
      "UPDATE ashby_company_integrations " +
      "SET connected_at = COALESCE(connected_at, now()), last_ping_at = now(), updated_at = now() " +
      "WHERE integration_id = $1",
    params: [integrationId],
  };
}

export function webhookEventInsertStatement(input: {
  readonly webhookActionId: string;
  readonly integrationId: string | null;
  readonly action: string;
  readonly payload: unknown;
}): SqlStatement {
  return {
    sql:
      "INSERT INTO ashby_webhook_events (webhook_action_id, integration_id, action, payload) " +
      "VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (webhook_action_id) DO NOTHING",
    params: [
      input.webhookActionId,
      input.integrationId,
      input.action,
      JSON.stringify(input.payload),
    ],
  };
}

export function webhookEventProcessedStatement(webhookActionId: string): SqlStatement {
  return {
    sql: "UPDATE ashby_webhook_events SET processed_at = now() WHERE webhook_action_id = $1",
    params: [webhookActionId],
  };
}

export function activeApplicationUpsertStatement(input: SyncedAshbyApplication): SqlStatement {
  return {
    sql:
      "INSERT INTO ashby_applications " +
      "(application_id, integration_id, candidate_id, candidate_name, candidate_email, job_id, current_stage, source, status, ashby_updated_at, raw_payload) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::jsonb) " +
      "ON CONFLICT (application_id) DO UPDATE SET " +
      "integration_id = EXCLUDED.integration_id, candidate_id = EXCLUDED.candidate_id, candidate_name = EXCLUDED.candidate_name, " +
      "candidate_email = EXCLUDED.candidate_email, job_id = EXCLUDED.job_id, current_stage = EXCLUDED.current_stage, source = EXCLUDED.source, " +
      "status = EXCLUDED.status, ashby_updated_at = EXCLUDED.ashby_updated_at, raw_payload = EXCLUDED.raw_payload, updated_at = now()",
    params: [
      input.applicationId,
      input.integrationId,
      input.candidateId,
      input.candidateName,
      input.candidateEmail,
      input.jobId,
      input.currentStage,
      input.source,
      input.status,
      input.ashbyUpdatedAt,
      JSON.stringify(input.rawPayload),
    ],
  };
}

export function inactiveCandidateApplicationsStatement(input: {
  readonly integrationId: string;
  readonly candidateId: string;
  readonly status: string;
}): SqlStatement {
  return {
    sql:
      "UPDATE ashby_applications SET status = $3, updated_at = now() " +
      "WHERE integration_id = $1 AND candidate_id = $2",
    params: [input.integrationId, input.candidateId, input.status],
  };
}

export function searchActiveApplicationsStatement(input: {
  readonly integrationId: string;
  readonly jobId?: string | null;
  readonly query: string;
  readonly limit: number;
}): SqlStatement {
  return {
    sql:
      "SELECT application_id, candidate_id, candidate_name, candidate_email, job_id, current_stage, source, status " +
      "FROM ashby_applications WHERE integration_id = $1 AND status = 'Active' " +
      "AND ($2::text IS NULL OR job_id = $2) " +
      "AND ($3::text = '' OR lower(candidate_name) LIKE '%' || lower($3) || '%' OR lower(COALESCE(candidate_email, '')) LIKE '%' || lower($3) || '%') " +
      "ORDER BY updated_at DESC LIMIT $4",
    params: [input.integrationId, input.jobId ?? null, input.query.trim(), input.limit],
  };
}

export function scoreUpsertStatement(input: ScoreInput & { readonly integrationId: string }): SqlStatement {
  const total = input.problemSolving + input.agency + input.competitiveness + input.curiosity;
  return {
    sql:
      "INSERT INTO ashby_candidate_scores " +
      "(score_id, integration_id, application_id, role_id, reviewer_email, problem_solving, agency, competitiveness, curiosity, total_score, comments) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) " +
      "ON CONFLICT (application_id, reviewer_email) DO UPDATE SET " +
      "role_id = EXCLUDED.role_id, problem_solving = EXCLUDED.problem_solving, agency = EXCLUDED.agency, " +
      "competitiveness = EXCLUDED.competitiveness, curiosity = EXCLUDED.curiosity, total_score = EXCLUDED.total_score, " +
      "comments = EXCLUDED.comments, updated_at = now() RETURNING score_id, total_score",
    params: [
      randomUUID(),
      input.integrationId,
      input.applicationId,
      input.roleId,
      input.reviewerEmail,
      input.problemSolving,
      input.agency,
      input.competitiveness,
      input.curiosity,
      total,
      input.comments,
    ],
  };
}

export function recentScreensStatement(input: { readonly integrationId: string; readonly limit: number }): SqlStatement {
  return {
    sql:
      "SELECT s.score_id, s.application_id, s.role_id, s.reviewer_email, s.problem_solving, s.agency, " +
      "s.competitiveness, s.curiosity, s.total_score, s.comments, s.updated_at, " +
      "a.candidate_name, a.candidate_email, a.job_id, a.current_stage, a.status " +
      "FROM ashby_candidate_scores s JOIN ashby_applications a ON a.application_id = s.application_id " +
      "WHERE s.integration_id = $1 ORDER BY s.updated_at DESC LIMIT $2",
    params: [input.integrationId, input.limit],
  };
}
```

- [ ] **Step 5: Add repository tests**

Create `backend/test/ashby-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  activeApplicationUpsertStatement,
  integrationLookupStatement,
  integrationSetupUpsertStatement,
  isValidEmailDomain,
  scoreUpsertStatement,
  searchActiveApplicationsStatement,
  webhookEventInsertStatement,
} from "../src/ashby/repository.js";

describe("Ashby repository statements", () => {
  it("normalizes company integration lookup by email domain", () => {
    const stmt = integrationLookupStatement({ organizationId: null, emailDomain: "UsePuddle.COM" });
    expect(stmt.sql).toContain("ashby_company_integrations");
    expect(stmt.params).toEqual([null, "usepuddle.com"]);
  });

  it("validates email domains", () => {
    expect(isValidEmailDomain("usepuddle.com")).toBe(true);
    expect(isValidEmailDomain("not-an-email-domain")).toBe(false);
  });

  it("builds setup upsert statement", () => {
    const stmt = integrationSetupUpsertStatement({
      emailDomain: "usepuddle.com",
      organizationId: "org_123",
      ashbyApiKeyCiphertext: "v1:encrypted",
      selectedJobIds: ["job_1"],
      integrationId: "int_1",
    });
    expect(stmt.sql).toContain("ON CONFLICT (email_domain)");
    expect(stmt.params).toEqual(["int_1", "org_123", "usepuddle.com", "v1:encrypted", ["job_1"]]);
  });

  it("deduplicates webhook events by Ashby webhookActionId", () => {
    const stmt = webhookEventInsertStatement({
      webhookActionId: "action_1",
      integrationId: "int_1",
      action: "applicationUpdate",
      payload: { action: "applicationUpdate" },
    });
    expect(stmt.sql).toContain("ON CONFLICT (webhook_action_id) DO NOTHING");
    expect(stmt.params[0]).toBe("action_1");
  });

  it("upserts active applications", () => {
    const stmt = activeApplicationUpsertStatement({
      applicationId: "app_1",
      integrationId: "int_1",
      candidateId: "cand_1",
      candidateName: "Maya Chen",
      candidateEmail: "maya@example.com",
      jobId: "job_1",
      currentStage: "Screen",
      source: "Ashby",
      status: "Active",
      ashbyUpdatedAt: "2026-06-10T12:00:00.000Z",
      rawPayload: { id: "app_1" },
    });
    expect(stmt.sql).toContain("INSERT INTO ashby_applications");
    expect(stmt.params[0]).toBe("app_1");
  });

  it("searches active applications by candidate name or email", () => {
    const stmt = searchActiveApplicationsStatement({
      integrationId: "int_1",
      jobId: "job_1",
      query: "maya",
      limit: 8,
    });
    expect(stmt.sql).toContain("status = 'Active'");
    expect(stmt.params).toEqual(["int_1", "job_1", "maya", 8]);
  });

  it("calculates total score in the score upsert params", () => {
    const stmt = scoreUpsertStatement({
      integrationId: "int_1",
      emailDomain: "usepuddle.com",
      applicationId: "app_1",
      roleId: "founding-engineer",
      reviewerEmail: "reviewer@usepuddle.com",
      problemSolving: 3,
      agency: 3.5,
      competitiveness: 2,
      curiosity: 4,
      comments: "Strong systems answer.",
    });
    expect(stmt.sql).toContain("ashby_candidate_scores");
    expect(stmt.params[9]).toBe(12.5);
  });
});
```

- [ ] **Step 6: Run backend unit tests**

Run:

```bash
cd backend && npm test -- test/ashby-crypto.test.ts test/ashby-repository.test.ts
```

Expected: exits `0`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/ashby/types.ts backend/src/ashby/crypto.ts backend/src/ashby/repository.ts backend/test/ashby-crypto.test.ts backend/test/ashby-repository.test.ts
git commit -m "feat: add ashby repository primitives"
```

---

### Task 4: Backend Ashby API Client and Sync Mapping

**Files:**
- Create: `backend/src/ashby/client.ts`
- Create: `backend/test/ashby-client.test.ts`

- [ ] **Step 1: Add Ashby client**

Create `backend/src/ashby/client.ts`:

```ts
import type { SyncedAshbyApplication } from "./types.js";

const ASHBY_API_BASE_URL = "https://api.ashbyhq.com";

interface AshbyListResponse {
  readonly success?: boolean;
  readonly results?: readonly Record<string, unknown>[];
  readonly moreDataAvailable?: boolean;
  readonly nextCursor?: string | null;
}

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function syncedApplicationFromAshby(input: {
  readonly integrationId: string;
  readonly application: Record<string, unknown>;
}): SyncedAshbyApplication | null {
  const candidate = objectValue(input.application.candidate);
  const job = objectValue(input.application.job);
  const currentStage = objectValue(input.application.currentInterviewStage) ?? objectValue(input.application.stage);
  const source = objectValue(input.application.source);
  const applicationId = stringValue(input.application.id);
  const candidateId = stringValue(candidate?.id);
  const candidateName =
    stringValue(candidate?.name) ??
    [stringValue(candidate?.firstName), stringValue(candidate?.lastName)].filter(Boolean).join(" ").trim();
  const jobId = stringValue(input.application.jobId) ?? stringValue(job?.id);

  if (!applicationId || !candidateId || !candidateName || !jobId) {
    return null;
  }

  return {
    applicationId,
    integrationId: input.integrationId,
    candidateId,
    candidateName,
    candidateEmail: stringValue(candidate?.primaryEmailAddress) ?? stringValue(candidate?.email),
    jobId,
    currentStage: stringValue(currentStage?.name),
    source: stringValue(source?.title) ?? stringValue(source?.name),
    status: stringValue(input.application.status) ?? "Active",
    ashbyUpdatedAt: stringValue(input.application.updatedAt),
    rawPayload: input.application,
  };
}

export async function listActiveApplicationsForJob(input: {
  readonly apiKey: string;
  readonly integrationId: string;
  readonly jobId: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<SyncedAshbyApplication[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const applications: SyncedAshbyApplication[] = [];
  let cursor: string | null = null;

  do {
    const response = await fetchImpl(`${ASHBY_API_BASE_URL}/application.list`, {
      method: "POST",
      headers: {
        accept: "application/json; version=1",
        authorization: authHeader(input.apiKey),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jobId: input.jobId,
        status: "Active",
        ...(cursor ? { cursor } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`Ashby application.list failed with ${response.status}`);
    }

    const payload = await response.json() as AshbyListResponse;
    for (const application of payload.results ?? []) {
      const synced = syncedApplicationFromAshby({
        integrationId: input.integrationId,
        application,
      });
      if (synced) {
        applications.push(synced);
      }
    }

    cursor = payload.moreDataAvailable && payload.nextCursor ? payload.nextCursor : null;
  } while (cursor);

  return applications;
}
```

- [ ] **Step 2: Add Ashby client tests**

Create `backend/test/ashby-client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  listActiveApplicationsForJob,
  syncedApplicationFromAshby,
} from "../src/ashby/client.js";

describe("Ashby API client", () => {
  it("maps Ashby applications into synced applications", () => {
    const synced = syncedApplicationFromAshby({
      integrationId: "int_1",
      application: {
        id: "app_1",
        status: "Active",
        updatedAt: "2026-06-10T12:00:00.000Z",
        candidate: {
          id: "cand_1",
          name: "Maya Chen",
          primaryEmailAddress: "maya@example.com",
        },
        job: { id: "job_1" },
        currentInterviewStage: { name: "Phone Screen" },
        source: { title: "Inbound" },
      },
    });

    expect(synced).toEqual({
      applicationId: "app_1",
      integrationId: "int_1",
      candidateId: "cand_1",
      candidateName: "Maya Chen",
      candidateEmail: "maya@example.com",
      jobId: "job_1",
      currentStage: "Phone Screen",
      source: "Inbound",
      status: "Active",
      ashbyUpdatedAt: "2026-06-10T12:00:00.000Z",
      rawPayload: expect.objectContaining({ id: "app_1" }),
    });
  });

  it("requests active applications with HTTP Basic auth", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        success: true,
        results: [
          {
            id: "app_1",
            status: "Active",
            candidate: { id: "cand_1", name: "Maya Chen" },
            jobId: "job_1",
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await listActiveApplicationsForJob({
      apiKey: "ashby-key",
      integrationId: "int_1",
      jobId: "job_1",
      fetchImpl: fakeFetch as typeof fetch,
    });

    expect(result).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.ashbyhq.com/application.list");
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from("ashby-key:").toString("base64")}`,
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ jobId: "job_1", status: "Active" });
  });
});
```

- [ ] **Step 3: Run backend client tests**

Run:

```bash
cd backend && npm test -- test/ashby-client.test.ts
```

Expected: exits `0`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/ashby/client.ts backend/test/ashby-client.test.ts
git commit -m "feat: add ashby active application client"
```

---

### Task 5: Backend Ashby Routes

**Files:**
- Create: `backend/src/ashby/routes.ts`
- Modify: `backend/src/server.ts`
- Create: `backend/test/ashby-routes.test.ts`

- [ ] **Step 1: Add route module**

Create `backend/src/ashby/routes.ts`. The module must export `registerAshbyRoutes(app: FastifyInstance): void` and register these routes:

```ts
import type { FastifyInstance } from "fastify";
import { getPool } from "../db/pool.js";
import { decryptIntegrationSecret, encryptIntegrationSecret, integrationSecretKeyFromEnv } from "./crypto.js";
import { listActiveApplicationsForJob, syncedApplicationFromAshby } from "./client.js";
import {
  activeApplicationUpsertStatement,
  inactiveCandidateApplicationsStatement,
  integrationLookupStatement,
  integrationSetupUpsertStatement,
  isValidEmailDomain,
  markIntegrationPingStatement,
  recentScreensStatement,
  scoreUpsertStatement,
  searchActiveApplicationsStatement,
  webhookEventInsertStatement,
  webhookEventProcessedStatement,
} from "./repository.js";
import type {
  AshbySetupRequest,
  AshbyWebhookEnvelope,
  AshbyWebhookPayload,
  CompanyIdentity,
  ScoreInput,
} from "./types.js";

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function selectedJobIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function companyIdentity(body: unknown): CompanyIdentity | null {
  const obj = objectValue(body);
  const emailDomain = stringValue(obj?.emailDomain);
  if (!emailDomain || !isValidEmailDomain(emailDomain)) {
    return null;
  }
  return {
    emailDomain,
    organizationId: stringValue(obj?.organizationId),
  };
}

function scoreValue(value: unknown): number | null {
  if (typeof value !== "number" || value < 0 || value > 4) {
    return null;
  }
  return Number.isInteger(value * 2) ? value : null;
}

async function integrationForIdentity(identity: CompanyIdentity) {
  const stmt = integrationLookupStatement(identity);
  const { rows } = await getPool().query(stmt.sql, [...stmt.params]);
  return rows[0] as Record<string, unknown> | undefined;
}

function integrationIdFrom(row: Record<string, unknown> | undefined): string | null {
  return stringValue(row?.integration_id);
}

export function registerAshbyRoutes(app: FastifyInstance): void {
  app.post<{ Body: AshbySetupRequest }>("/integrations/ashby/setup", async (request, reply) => {
    const identity = companyIdentity(request.body);
    const apiKey = stringValue(request.body?.ashbyApiKey);
    const jobs = selectedJobIds(request.body?.selectedJobIds);
    if (!identity || !apiKey || jobs.length === 0) {
      return reply.code(400).send({ error: "emailDomain, ashbyApiKey, and selectedJobIds are required" });
    }

    const encrypted = encryptIntegrationSecret(apiKey, integrationSecretKeyFromEnv());
    const stmt = integrationSetupUpsertStatement({
      organizationId: identity.organizationId,
      emailDomain: identity.emailDomain,
      ashbyApiKeyCiphertext: encrypted,
      selectedJobIds: jobs,
    });
    const { rows } = await getPool().query<{ integration_id: string }>(stmt.sql, [...stmt.params]);
    return reply.code(201).send({
      integrationId: rows[0]?.integration_id,
      emailDomain: identity.emailDomain.toLowerCase(),
      selectedJobIds: jobs,
    });
  });

  app.post("/integrations/ashby/company-state", async (request, reply) => {
    const identity = companyIdentity(request.body);
    if (!identity) {
      return reply.code(400).send({ error: "valid emailDomain is required" });
    }
    const integration = await integrationForIdentity(identity);
    return reply.send({
      connected: Boolean(integration?.connected_at),
      integrationId: integrationIdFrom(integration),
      emailDomain: stringValue(integration?.email_domain) ?? identity.emailDomain.toLowerCase(),
      selectedJobIds: Array.isArray(integration?.selected_job_ids) ? integration.selected_job_ids : [],
      lastPingAt: integration?.last_ping_at ?? null,
    });
  });

  app.post<{ Body: AshbyWebhookEnvelope }>("/integrations/ashby/webhook", async (request, reply) => {
    const envelope = objectValue(request.body);
    const payload = objectValue(envelope?.payload) as AshbyWebhookPayload | null;
    const action = stringValue(payload?.action);
    if (!payload || !action) {
      return reply.code(400).send({ error: "valid Ashby webhook payload is required" });
    }

    const integrationId = stringValue(envelope?.integrationId);
    const companyDomain = stringValue(envelope?.companyDomain);
    const integration = integrationId
      ? { integration_id: integrationId }
      : companyDomain
        ? await integrationForIdentity({ emailDomain: companyDomain, organizationId: null })
        : undefined;
    const resolvedIntegrationId = integrationIdFrom(integration);

    if (action === "ping") {
      if (resolvedIntegrationId) {
        const stmt = markIntegrationPingStatement(resolvedIntegrationId);
        await getPool().query(stmt.sql, [...stmt.params]);
      }
      return reply.send({ ok: true, action: "ping" });
    }

    const webhookActionId = stringValue(payload.webhookActionId);
    if (!webhookActionId) {
      return reply.code(400).send({ error: "webhookActionId is required" });
    }

    const insert = webhookEventInsertStatement({
      webhookActionId,
      integrationId: resolvedIntegrationId,
      action,
      payload,
    });
    const inserted = await getPool().query(insert.sql, [...insert.params]);
    if (inserted.rowCount === 0) {
      return reply.send({ ok: true, duplicate: true });
    }

    const application = objectValue(objectValue(payload.data)?.application);
    if (resolvedIntegrationId && application && (action === "applicationSubmit" || action === "applicationUpdate" || action === "candidateStageChange" || action === "candidateHire")) {
      const synced = syncedApplicationFromAshby({ integrationId: resolvedIntegrationId, application });
      if (synced) {
        const upsert = activeApplicationUpsertStatement({
          ...synced,
          status: action === "candidateHire" ? "Hired" : synced.status,
        });
        await getPool().query(upsert.sql, [...upsert.params]);
      }
    }

    const candidate = objectValue(objectValue(payload.data)?.candidate);
    const candidateId = stringValue(candidate?.id);
    if (resolvedIntegrationId && candidateId && (action === "candidateDelete" || action === "candidateMerge")) {
      const inactive = inactiveCandidateApplicationsStatement({
        integrationId: resolvedIntegrationId,
        candidateId,
        status: action,
      });
      await getPool().query(inactive.sql, [...inactive.params]);
    }

    const processed = webhookEventProcessedStatement(webhookActionId);
    await getPool().query(processed.sql, [...processed.params]);
    return reply.send({ ok: true, action });
  });

  app.post("/integrations/ashby/sync-active-applications", async (request, reply) => {
    const identity = companyIdentity(request.body);
    if (!identity) {
      return reply.code(400).send({ error: "valid emailDomain is required" });
    }
    const integration = await integrationForIdentity(identity);
    const integrationId = integrationIdFrom(integration);
    const encryptedApiKey = stringValue(integration?.ashby_api_key_ciphertext);
    const jobIds = Array.isArray(integration?.selected_job_ids) ? integration.selected_job_ids.filter((id): id is string => typeof id === "string") : [];
    if (!integrationId || !encryptedApiKey || jobIds.length === 0) {
      return reply.code(404).send({ error: "Ashby integration is not configured" });
    }

    const apiKey = decryptIntegrationSecret(encryptedApiKey, integrationSecretKeyFromEnv());
    let syncedCount = 0;
    for (const jobId of jobIds) {
      const applications = await listActiveApplicationsForJob({ apiKey, integrationId, jobId });
      for (const application of applications) {
        const stmt = activeApplicationUpsertStatement(application);
        await getPool().query(stmt.sql, [...stmt.params]);
        syncedCount += 1;
      }
    }
    return reply.send({ ok: true, syncedCount });
  });

  app.post("/integrations/ashby/applications/search", async (request, reply) => {
    const identity = companyIdentity(request.body);
    const body = objectValue(request.body);
    if (!identity) {
      return reply.code(400).send({ error: "valid emailDomain is required" });
    }
    const integration = await integrationForIdentity(identity);
    const integrationId = integrationIdFrom(integration);
    if (!integrationId) {
      return reply.code(404).send({ error: "Ashby integration is not configured" });
    }
    const stmt = searchActiveApplicationsStatement({
      integrationId,
      jobId: stringValue(body?.jobId),
      query: stringValue(body?.query) ?? "",
      limit: Math.min(Number(body?.limit ?? 8), 20),
    });
    const { rows } = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.send({ applications: rows });
  });

  app.post<{ Body: ScoreInput }>("/integrations/ashby/scores", async (request, reply) => {
    const identity = companyIdentity(request.body);
    const body = objectValue(request.body);
    const problemSolving = scoreValue(body?.problemSolving);
    const agency = scoreValue(body?.agency);
    const competitiveness = scoreValue(body?.competitiveness);
    const curiosity = scoreValue(body?.curiosity);
    const applicationId = stringValue(body?.applicationId);
    const roleId = stringValue(body?.roleId);
    const reviewerEmail = stringValue(body?.reviewerEmail);
    if (!identity || !applicationId || !roleId || !reviewerEmail || problemSolving === null || agency === null || competitiveness === null || curiosity === null) {
      return reply.code(400).send({ error: "valid score input is required" });
    }
    const integration = await integrationForIdentity(identity);
    const integrationId = integrationIdFrom(integration);
    if (!integrationId) {
      return reply.code(404).send({ error: "Ashby integration is not configured" });
    }
    const stmt = scoreUpsertStatement({
      integrationId,
      emailDomain: identity.emailDomain,
      organizationId: identity.organizationId,
      applicationId,
      roleId,
      reviewerEmail,
      problemSolving,
      agency,
      competitiveness,
      curiosity,
      comments: stringValue(body?.comments) ?? "",
    });
    const { rows } = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.code(201).send({ score: rows[0] });
  });

  app.post("/integrations/ashby/recent-screens", async (request, reply) => {
    const identity = companyIdentity(request.body);
    const body = objectValue(request.body);
    if (!identity) {
      return reply.code(400).send({ error: "valid emailDomain is required" });
    }
    const integration = await integrationForIdentity(identity);
    const integrationId = integrationIdFrom(integration);
    if (!integrationId) {
      return reply.code(404).send({ error: "Ashby integration is not configured" });
    }
    const stmt = recentScreensStatement({
      integrationId,
      limit: Math.min(Number(body?.limit ?? 20), 50),
    });
    const { rows } = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.send({ screens: rows });
  });
}
```

- [ ] **Step 2: Register routes**

Modify `backend/src/server.ts`:

```ts
import { registerAshbyRoutes } from "./ashby/routes.js";
```

Inside `buildServer`, add before `return app;`:

```ts
  registerAshbyRoutes(app);
```

- [ ] **Step 3: Add route tests**

Create `backend/test/ashby-routes.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";

const FAKE_LK = { host: "wss://example", apiKey: "key", apiSecret: "secret" };

describe("Ashby backend routes", () => {
  it("rejects invalid company state input", async () => {
    const app = buildServer(FAKE_LK);
    const res = await app.inject({
      method: "POST",
      url: "/integrations/ashby/company-state",
      headers: { "content-type": "application/json" },
      payload: { emailDomain: "bad-domain" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("rejects malformed webhook payloads", async () => {
    const app = buildServer(FAKE_LK);
    const res = await app.inject({
      method: "POST",
      url: "/integrations/ashby/webhook",
      headers: { "content-type": "application/json" },
      payload: { payload: { data: {} } },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("rejects invalid score values", async () => {
    const app = buildServer(FAKE_LK);
    const res = await app.inject({
      method: "POST",
      url: "/integrations/ashby/scores",
      headers: { "content-type": "application/json" },
      payload: {
        emailDomain: "usepuddle.com",
        applicationId: "app_1",
        roleId: "role_1",
        reviewerEmail: "reviewer@usepuddle.com",
        problemSolving: 4.25,
        agency: 3,
        competitiveness: 3,
        curiosity: 3,
      },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 4: Run backend route tests**

Run:

```bash
cd backend && npm test -- test/ashby-routes.test.ts test/server.test.ts
```

Expected: exits `0`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/ashby/routes.ts backend/src/server.ts backend/test/ashby-routes.test.ts
git commit -m "feat: add ashby backend routes"
```

---

### Task 6: Platform Backend Client and Authenticated API Proxies

**Files:**
- Create: `platform/lib/ashby/server.ts`
- Create: `platform/app/api/ashby/applications/search/route.ts`
- Create: `platform/app/api/ashby/scores/route.ts`

- [ ] **Step 1: Add platform Ashby server helper**

Create `platform/lib/ashby/server.ts`:

```ts
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";
import { emailDomain } from "@/lib/auth/email-domain";

export interface CompanyIdentityPayload {
  readonly organizationId: string | null;
  readonly emailDomain: string;
}

export interface AshbyCompanyState {
  readonly connected: boolean;
  readonly integrationId: string | null;
  readonly emailDomain: string;
  readonly selectedJobIds: readonly string[];
  readonly lastPingAt: string | null;
}

export interface RecentScreen {
  readonly score_id: string;
  readonly application_id: string;
  readonly role_id: string;
  readonly reviewer_email: string;
  readonly total_score: string | number;
  readonly comments: string;
  readonly updated_at: string;
  readonly candidate_name: string;
  readonly candidate_email: string | null;
  readonly job_id: string;
  readonly current_stage: string | null;
  readonly status: string;
}

export function companyIdentityFromUser(input: {
  readonly email: string;
  readonly organizationId?: string | null;
}): CompanyIdentityPayload {
  const domain = emailDomain(input.email);
  if (!domain) {
    throw new Error("Signed-in user does not have a valid email domain.");
  }
  return {
    organizationId: input.organizationId ?? null,
    emailDomain: domain,
  };
}

async function postBackend<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${backendBaseUrl()}${path}`, {
    method: "POST",
    headers: backendHeaders(),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Backend request failed.");
  }
  return payload as T;
}

export async function getAshbyCompanyState(identity: CompanyIdentityPayload): Promise<AshbyCompanyState> {
  return postBackend<AshbyCompanyState>("/integrations/ashby/company-state", identity);
}

export async function getRecentAshbyScreens(identity: CompanyIdentityPayload): Promise<readonly RecentScreen[]> {
  const payload = await postBackend<{ screens: RecentScreen[] }>("/integrations/ashby/recent-screens", {
    ...identity,
    limit: 20,
  });
  return payload.screens;
}
```

- [ ] **Step 2: Add authenticated application search proxy**

Create `platform/app/api/ashby/applications/search/route.ts`:

```ts
import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { isAllowedAuthEmail } from "@/lib/auth/allowed-domains";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";
import { companyIdentityFromUser } from "@/lib/ashby/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, organizationId } = await withAuth();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isAllowedAuthEmail(user.email)) return NextResponse.json({ error: "Email domain is not allowed." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const identity = companyIdentityFromUser({ email: user.email, organizationId });
  const response = await fetch(`${backendBaseUrl()}/integrations/ashby/applications/search`, {
    method: "POST",
    headers: backendHeaders(),
    body: JSON.stringify({
      ...identity,
      jobId: typeof body.jobId === "string" ? body.jobId : null,
      query: typeof body.query === "string" ? body.query : "",
      limit: 8,
    }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
```

- [ ] **Step 3: Add authenticated score save proxy**

Create `platform/app/api/ashby/scores/route.ts`:

```ts
import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { isAllowedAuthEmail } from "@/lib/auth/allowed-domains";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";
import { companyIdentityFromUser } from "@/lib/ashby/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, organizationId } = await withAuth();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isAllowedAuthEmail(user.email)) return NextResponse.json({ error: "Email domain is not allowed." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const identity = companyIdentityFromUser({ email: user.email, organizationId });
  const response = await fetch(`${backendBaseUrl()}/integrations/ashby/scores`, {
    method: "POST",
    headers: backendHeaders(),
    body: JSON.stringify({
      ...identity,
      ...body,
      reviewerEmail: user.email,
    }),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
```

- [ ] **Step 4: Run platform verification**

Run:

```bash
cd platform && npm run lint
```

Expected: exits `0`.

Run:

```bash
cd platform && npm run build
```

Expected: exits `0`.

- [ ] **Step 5: Commit**

```bash
git add platform/lib/ashby/server.ts platform/app/api/ashby/applications/search/route.ts platform/app/api/ashby/scores/route.ts
git commit -m "feat: proxy ashby dashboard requests"
```

---

### Task 7: Recent Screens Dashboard

**Files:**
- Modify: `platform/app/dashboard/page.tsx`
- Modify: `platform/app/dashboard/DashboardSections.tsx`

- [ ] **Step 1: Add dashboard panels**

Add this import near the top of `platform/app/dashboard/DashboardSections.tsx` with the existing imports:

```tsx
import type { AshbyCompanyState, RecentScreen } from "@/lib/ashby/server";
```

Append these exports to the bottom of `platform/app/dashboard/DashboardSections.tsx`:

```tsx
export function AshbySetupPanel({
  state,
  webhookUrl,
}: {
  readonly state: AshbyCompanyState;
  readonly webhookUrl: string;
}) {
  return (
    <SectionPanel title="Connect Ashby" eyebrow="Internal setup">
      <div className="grid gap-4">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="text-sm font-semibold text-slate-950">{state.emailDomain}</div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            One Ashby integration is shared by teammates on this company domain after setup is complete.
          </p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Webhook URL</div>
          <code className="mt-2 block break-all rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800">
            {webhookUrl}
          </code>
        </div>
        <div className="grid gap-2 text-sm text-slate-700">
          {["ping", "applicationSubmit", "applicationUpdate", "candidateStageChange", "candidateDelete", "candidateMerge", "candidateHire"].map((event) => (
            <div key={event} className="rounded-md border border-slate-200 bg-white px-3 py-2 font-medium">
              {event}
            </div>
          ))}
        </div>
      </div>
    </SectionPanel>
  );
}

export function RecentScreensTable({ screens }: { readonly screens: readonly RecentScreen[] }) {
  return (
    <SectionPanel title="Recent screens" eyebrow="Screens">
      {screens.length ? (
        <TableScroller>
          <table className="min-w-[900px] w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={`${tableHeaderClass} rounded-l-md px-3 py-2`}>Candidate</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Role</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Stage</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Score</th>
                <th className={`${tableHeaderClass} px-3 py-2`}>Reviewer</th>
                <th className={`${tableHeaderClass} rounded-r-md px-3 py-2`}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {screens.map((screen) => (
                <tr key={screen.score_id}>
                  <td className={`${tableCellClass} font-medium text-slate-950`}>
                    {screen.candidate_name}
                    <div className="mt-0.5 text-xs font-normal text-slate-500">{screen.candidate_email ?? "No email"}</div>
                  </td>
                  <td className={tableCellClass}>{screen.role_id}</td>
                  <td className={tableCellClass}>{screen.current_stage ?? screen.status}</td>
                  <td className={tableCellClass}>
                    <ScoreBadge score={Number(screen.total_score)} maxScore={16} />
                  </td>
                  <td className={tableCellClass}>{screen.reviewer_email}</td>
                  <td className={tableCellClass}>{formatDateTime(screen.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      ) : (
        <EmptyState title="No screens yet" detail="Saved scorecards for active Ashby candidates will appear here." />
      )}
    </SectionPanel>
  );
}
```

- [ ] **Step 2: Replace dashboard page with connected/setup state**

Replace `platform/app/dashboard/page.tsx` with:

```tsx
import { publicBaseUrl } from "@/lib/site-url";
import {
  companyIdentityFromUser,
  getAshbyCompanyState,
  getRecentAshbyScreens,
} from "@/lib/ashby/server";
import { AshbySetupPanel, RecentScreensTable } from "./DashboardSections";
import { requireDashboardUser } from "./auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, organizationId } = await requireDashboardUser();
  const identity = companyIdentityFromUser({ email: user.email, organizationId });
  const state = await getAshbyCompanyState(identity);
  const screens = state.connected ? await getRecentAshbyScreens(identity) : [];
  const webhookUrl = `${publicBaseUrl()}/api/ashby/webhook?companyDomain=${encodeURIComponent(identity.emailDomain)}`;

  return (
    <div className="mx-auto grid min-w-0 max-w-[1440px] gap-5">
      <header className="min-w-0 rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">Dashboard</div>
        <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">Recent screens</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          The dashboard shows the latest candidate screens and scorecards synced through the company Ashby integration.
        </p>
      </header>

      {state.connected ? <RecentScreensTable screens={screens} /> : <AshbySetupPanel state={state} webhookUrl={webhookUrl} />}
    </div>
  );
}
```

- [ ] **Step 3: Run platform verification**

Run:

```bash
cd platform && npm run lint
```

Expected: exits `0`.

Run:

```bash
cd platform && npm run build
```

Expected: exits `0`.

- [ ] **Step 4: Commit**

```bash
git add platform/app/dashboard/page.tsx platform/app/dashboard/DashboardSections.tsx
git commit -m "feat: show recent ashby screens on dashboard"
```

---

### Task 8: Role Score Tab

**Files:**
- Create: `platform/app/dashboard/roles/[roleId]/ScoreTab.tsx`
- Modify: `platform/app/dashboard/roles/[roleId]/RoleWorkspaceTabs.tsx`

- [ ] **Step 1: Create score tab client component**

Create `platform/app/dashboard/roles/[roleId]/ScoreTab.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { primaryButtonClass, secondaryButtonClass } from "../../dashboard-ui";

interface AshbyApplicationOption {
  readonly application_id: string;
  readonly candidate_name: string;
  readonly candidate_email: string | null;
  readonly job_id: string;
  readonly current_stage: string | null;
}

const scoreValues = Array.from({ length: 9 }, (_, index) => index / 2);

export function ScoreTab({ roleId, jobId }: { readonly roleId: string; readonly jobId?: string | null }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<AshbyApplicationOption[]>([]);
  const [selected, setSelected] = useState<AshbyApplicationOption | null>(null);
  const [problemSolving, setProblemSolving] = useState(3);
  const [agency, setAgency] = useState(3);
  const [competitiveness, setCompetitiveness] = useState(3);
  const [curiosity, setCuriosity] = useState(3);
  const [comments, setComments] = useState("");
  const [status, setStatus] = useState<"idle" | "searching" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const total = useMemo(
    () => problemSolving + agency + competitiveness + curiosity,
    [problemSolving, agency, competitiveness, curiosity],
  );

  async function searchCandidates(nextQuery: string) {
    setQuery(nextQuery);
    setSelected(null);
    if (nextQuery.trim().length < 2) {
      setOptions([]);
      return;
    }
    setStatus("searching");
    setMessage(null);
    try {
      const response = await fetch("/api/ashby/applications/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: nextQuery, jobId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus("error");
        setMessage(payload.error ?? "Could not search Ashby candidates.");
        return;
      }
      setOptions(payload.applications ?? []);
      setStatus("idle");
    } catch {
      setStatus("error");
      setMessage("Could not reach the Ashby search API.");
    }
  }

  async function saveScore() {
    if (!selected) {
      setStatus("error");
      setMessage("Select an active Ashby candidate before saving.");
      return;
    }
    setStatus("saving");
    setMessage(null);
    try {
      const response = await fetch("/api/ashby/scores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicationId: selected.application_id,
          roleId,
          problemSolving,
          agency,
          competitiveness,
          curiosity,
          comments,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus("error");
        setMessage(payload.error ?? "Could not save score.");
        return;
      }
      setStatus("saved");
      setMessage("Score saved.");
    } catch {
      setStatus("error");
      setMessage("Could not reach the score API.");
    }
  }

  function ScoreSelect({
    label,
    value,
    onChange,
  }: {
    readonly label: string;
    readonly value: number;
    readonly onChange: (value: number) => void;
  }) {
    return (
      <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
        {label}
        <select
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
        >
          {scoreValues.map((score) => (
            <option key={score} value={score}>
              {score}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
          Candidate
          <input
            value={query}
            onChange={(event) => searchCandidates(event.target.value)}
            className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
            placeholder="Search active Ashby candidates"
          />
        </label>
        {options.length ? (
          <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
            {options.map((option) => (
              <button
                key={option.application_id}
                type="button"
                onClick={() => {
                  setSelected(option);
                  setQuery(option.candidate_name);
                  setOptions([]);
                }}
                className={secondaryButtonClass}
              >
                {option.candidate_name} {option.candidate_email ? `- ${option.candidate_email}` : ""}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <ScoreSelect label="Problem Solving" value={problemSolving} onChange={setProblemSolving} />
        <ScoreSelect label="Agency" value={agency} onChange={setAgency} />
        <ScoreSelect label="Competitiveness" value={competitiveness} onChange={setCompetitiveness} />
        <ScoreSelect label="Curious" value={curiosity} onChange={setCuriosity} />
      </div>

      <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
        Comments
        <textarea
          value={comments}
          onChange={(event) => setComments(event.target.value)}
          className="min-h-28 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
          placeholder="Quick notes"
        />
      </label>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-700">
          Sum <span className="ml-2 text-xl font-semibold text-slate-950">{total}</span>
        </div>
        <button
          type="button"
          onClick={saveScore}
          disabled={status === "saving" || status === "searching"}
          className={primaryButtonClass}
        >
          {status === "saving" ? "Saving..." : "Save Candidate"}
        </button>
      </div>

      {message ? (
        <div className={status === "error" ? "text-sm font-medium text-rose-700" : "text-sm font-medium text-emerald-700"}>
          {message}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Add tab to role workspace**

Modify `platform/app/dashboard/roles/[roleId]/RoleWorkspaceTabs.tsx`:

```tsx
import { ScoreTab } from "./ScoreTab";
```

Change:

```ts
type RoleTab = "Pipeline" | "Rubric" | "Interviews" | "Reports";
const tabs: readonly RoleTab[] = ["Pipeline", "Rubric", "Interviews", "Reports"];
```

to:

```ts
type RoleTab = "Pipeline" | "Score" | "Rubric" | "Interviews" | "Reports";
const tabs: readonly RoleTab[] = ["Pipeline", "Score", "Rubric", "Interviews", "Reports"];
```

Add inside the tab body:

```tsx
        {activeTab === "Score" ? <ScoreTab roleId={role.id} jobId={role.id} /> : null}
```

The `jobId={role.id}` mapping works for demo role IDs only. During backend role integration, replace `role.id` with the selected Ashby job ID stored on the backend role model.

- [ ] **Step 3: Run platform verification**

Run:

```bash
cd platform && npm run lint
```

Expected: exits `0`.

Run:

```bash
cd platform && npm run build
```

Expected: exits `0`.

- [ ] **Step 4: Commit**

```bash
git add 'platform/app/dashboard/roles/[roleId]/ScoreTab.tsx' 'platform/app/dashboard/roles/[roleId]/RoleWorkspaceTabs.tsx'
git commit -m "feat: add ashby score tab"
```

---

### Task 9: Manual Ashby Setup Runbook

**Files:**
- Create: `platform/docs/ashby-internal-setup.md`
- Modify: `platform/.env.example`

- [ ] **Step 1: Add backend env vars to example**

Append to `platform/.env.example`:

```bash

# Backend integration secret encryption. Set on backend runtime too.
PUDDLE_INTEGRATION_SECRET_KEY=
```

- [ ] **Step 2: Create setup runbook**

Create `platform/docs/ashby-internal-setup.md`:

````md
# Internal Ashby Setup

## Backend config

Generate secret values with `openssl rand -hex 32`, then set these variables for the platform/backend deployment. The host values below match the production naming convention used in this plan:

```bash
PUDDLE_BACKEND_BASE_URL=https://api.usepuddle.com
PUDDLE_BACKEND_INTERNAL_TOKEN=local-dev-platform-backend-token-2026-06-10
PUDDLE_ASHBY_WEBHOOK_SECRET=local-dev-ashby-webhook-secret-2026-06-10
PUDDLE_INTEGRATION_SECRET_KEY=local-dev-integration-secret-2026-06-10
```

## Create the company integration

Run this against the backend. The Ashby API key needs `candidatesRead` for `application.list`.

```bash
export ASHBY_API_KEY=ashby-api-key-from-admin
export ASHBY_JOB_ID=ashby-job-id-for-the-role
curl -sS -X POST "$PUDDLE_BACKEND_BASE_URL/integrations/ashby/setup" \
  -H "Authorization: Bearer $PUDDLE_BACKEND_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  --data @- <<JSON
{
  "emailDomain": "usepuddle.com",
  "organizationId": null,
  "ashbyApiKey": "$ASHBY_API_KEY",
  "selectedJobIds": ["$ASHBY_JOB_ID"]
}
JSON
```

Save the returned `integrationId`.

## Create Ashby webhooks

In Ashby, create webhooks for these actions:

- `ping`
- `applicationSubmit`
- `applicationUpdate`
- `candidateStageChange`
- `candidateDelete`
- `candidateMerge`
- `candidateHire`

Use this request URL:

```text
https://platform.usepuddle.com/api/ashby/webhook?companyDomain=usepuddle.com
```

Use the exact value of `PUDDLE_ASHBY_WEBHOOK_SECRET` as the Ashby secret token.

## Run initial active application sync

```bash
curl -sS -X POST "$PUDDLE_BACKEND_BASE_URL/integrations/ashby/sync-active-applications" \
  -H "Authorization: Bearer $PUDDLE_BACKEND_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "emailDomain": "usepuddle.com", "organizationId": null }'
```

## Verify

1. Open `/dashboard`.
2. Confirm same-domain users see recent screens or an empty screens state instead of setup.
3. Open a role.
4. Open the `Score` tab.
5. Search for an active Ashby candidate.
6. Save a scorecard.
7. Refresh `/dashboard` and confirm the score appears under recent screens.
````

- [ ] **Step 3: Run markdown spell check manually**

Read the runbook once and verify it contains:

- Backend config variables.
- Setup curl command.
- Required webhook events.
- Initial sync curl command.
- Dashboard verification steps.

- [ ] **Step 4: Commit**

```bash
git add platform/docs/ashby-internal-setup.md platform/.env.example
git commit -m "docs: add ashby setup runbook"
```

---

### Task 10: Full Verification

**Files:**
- No source edits.

- [ ] **Step 1: Run backend tests**

Run:

```bash
cd backend && npm test
```

Expected: exits `0`.

- [ ] **Step 2: Build backend**

Run:

```bash
cd backend && npm run build
```

Expected: exits `0`.

- [ ] **Step 3: Lint platform**

Run:

```bash
cd platform && npm run lint
```

Expected: exits `0`.

- [ ] **Step 4: Build platform**

Run:

```bash
cd platform && npm run build
```

Expected: exits `0`.

- [ ] **Step 5: Verify migration ordering**

Run:

```bash
ls backend/migrations
```

Expected: includes `001_init.sql`, `002_candidate_invites.sql`, `003_interview_artifacts.sql`, `004_recording_artifact_fractional_duration.sql`, and `005_ashby_integrations.sql` in lexical order.

- [ ] **Step 6: Commit verification note if needed**

If any command required a source fix, run `git status --short`, stage the exact changed source files listed there, and commit the fix with:

```bash
git commit -m "fix: stabilize ashby integration checks"
```

If no source fix was needed, do not create a commit.

---

## Self-Review

Spec coverage:

- Recent screens dashboard: Task 7.
- Role-level score tab: Task 8.
- Internal Ashby webhook receiver: Task 1.
- Manual webhook setup: Task 9.
- Same-domain onboarding bypass: Tasks 5 and 6 through company-state lookup by organization ID or email domain.
- Backend-owned secrets and state: Tasks 2 through 5.
- Active application sync: Tasks 4 and 5.
- Webhook idempotency: Tasks 2, 3, and 5.

Placeholder scan:

- No `TBD`, `TODO`, `implement later`, or unstated file paths are present.

Type consistency:

- Platform identity payload uses `organizationId` and `emailDomain`.
- Backend `CompanyIdentity` uses the same fields.
- Score fields are consistently `problemSolving`, `agency`, `competitiveness`, and `curiosity`.
- Backend SQL stores `curiosity`, while the UI label remains `Curious`.
