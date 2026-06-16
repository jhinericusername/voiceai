# Ashby Secret Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Close the Ashby secret-handling launch blockers without adding browser-side encryption.

**Architecture:** Keep Ashby API keys and webhook secrets server-only. Add explicit backend log redaction and safe log metadata, wrap every decrypt call with a documented purpose, fail production URL config when public webhook URLs could become HTTP/localhost, audit reconnect/rotation actions, and document the internal HTTP-over-private-VPC decision.

**Tech Stack:** Fastify 5/Pino, TypeScript backend, Next.js 16 App Router route handlers, Vitest, Node source tests, CDK tests.

---

### Task 1: Logging Redaction And Safe Backend Errors

**Files:**
- Create: `../backend/src/logging/redaction.ts`
- Modify: `../backend/src/server.ts`
- Modify: `../backend/src/ashby/routes.ts`
- Modify: `lib/ashby/onboarding-route-behavior.mjs`
- Test: `../backend/test/server.test.ts`
- Test: `tests/ashby-onboarding-source.test.mjs`

- [x] Add tests asserting backend logger redacts auth/cookie/Ashby/webhook fields and platform proxy warnings omit backend response payloads.
- [x] Implement Fastify logger options with Pino `redact` paths and replace Ashby validation logs that currently include arbitrary `Error.message`.
- [x] Sanitize platform onboarding warning metadata to status/path only.
- [x] Run `cd ../backend && npx vitest run test/server.test.ts test/ashby-routes.test.ts` and `npm test -- tests/ashby-onboarding-source.test.mjs`.

### Task 2: Decryption Purpose Enforcement

**Files:**
- Create: `../backend/src/ashby/secret-use.ts`
- Modify: `../backend/src/ashby/routes.ts`
- Test: `../backend/test/ashby-secret-use.test.ts`

- [x] Add tests for the exact allowed decrypt purposes: selected-job API validation, webhook setup display, webhook signature verification, and active-application sync.
- [x] Replace direct route calls to `decryptIntegrationSecret` with purpose-specific wrappers.
- [x] Add a source guard so route code cannot grow new direct decrypt calls without updating the allowlist.
- [x] Run `cd ../backend && npx vitest run test/ashby-secret-use.test.ts test/ashby-routes.test.ts`.

### Task 3: HTTPS/Webhook URL Production Guardrails

**Files:**
- Modify: `lib/site-url.ts`
- Modify: `lib/backend-api.ts`
- Modify: `app/api/ashby/onboarding/jobs/route.ts`
- Modify: `app/dashboard/backend-data.ts`
- Modify: `../backend/src/ashby/routes.ts`
- Modify: `../infra/lib/infra-stack.ts`
- Test: `tests/ashby-onboarding-source.test.mjs`
- Test: `../backend/test/ashby-routes.test.ts`
- Test: `../infra/test/infra.test.ts`

- [x] Add tests that production public URLs must be HTTPS and non-localhost, while local dev still allows localhost.
- [x] Use the shared platform public URL helper in Ashby job onboarding instead of duplicating env fallback logic.
- [x] Fail CDK synthesis for prod platform containers without an HTTPS custom domain/certificate.
- [x] Keep current private-VPC backend HTTP explicit; do not claim all-hop TLS.

### Task 4: Rotation/Reconnect And Auditability

**Files:**
- Create: `../backend/migrations/009_ashby_integration_audit.sql`
- Modify: `../backend/src/ashby/repository.ts`
- Modify: `../backend/src/ashby/routes.ts`
- Modify: `app/dashboard/page.tsx`
- Modify: `app/dashboard/AshbyOnboardingWizard.tsx`
- Test: `../backend/test/ashby-routes.test.ts`
- Test: `../backend/test/migrations.test.ts`
- Test: `tests/ashby-onboarding-source.test.mjs`

- [x] Add tests proving API key replacement overwrites ciphertext, resets integration state, stales active applications, and writes an actor audit event.
- [x] Add tests proving selected job updates and sync requests write non-secret audit events.
- [x] Add a migration for append-only Ashby integration audit events.
- [x] Render the existing admin setup/reconnect panel for connected workspaces so admins can replace the key and reset integration state after launch.

### Task 5: Legacy Setup And Runbook

**Files:**
- Modify: `../backend/src/ashby/routes.ts`
- Modify: `../backend/test/ashby-routes.test.ts`
- Modify: `docs/ashby-internal-setup.md`

- [x] Disable legacy `/integrations/ashby/setup` with `410 Gone` so launch traffic cannot bypass webhook-secret onboarding.
- [x] Update tests that previously expected legacy setup writes.
- [x] Document allowed decrypt points, log redaction policy, rotation/reconnect path, production HTTPS requirements, and the current internal transport decision.

### Task 6: Review And Verification

**Files:**
- All modified files.

- [x] Run backend focused tests, platform source tests, infra tests, lint/build where feasible.
- [x] Dispatch a review subagent with the final diff and fix any important findings.
- [x] Report remaining manual gates: database migration must be applied separately; internal TLS/mTLS remains a future decision if all-hop encryption is required.
