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

test("Ashby onboarding sync proxies to the existing backend sync route", () => {
  assert.match(syncRoute, /\/integrations\/ashby\/sync-active-applications/);
  assert.doesNotMatch(syncRoute, /\/integrations\/ashby\/onboarding\/sync/);
});

test("Ashby onboarding proxy routes sanitize non-OK backend responses", () => {
  for (const source of [apiKeyRoute, jobsRoute]) {
    assert.match(source, /response\.ok/);
    assert.match(source, /payload\.error \?\? "Ashby onboarding request failed\."/);
    assert.doesNotMatch(source, /message/);
    assert.doesNotMatch(source, /stack/);
    assert.doesNotMatch(source, /details/);
  }

  assert.match(syncRoute, /response\.ok/);
  assert.match(syncRoute, /payload\.error \?\? "Ashby sync request failed\."/);
  assert.doesNotMatch(syncRoute, /request\.json\(\)/);
  assert.doesNotMatch(syncRoute, /message/);
  assert.doesNotMatch(syncRoute, /stack/);
  assert.doesNotMatch(syncRoute, /details/);
});

test("Ashby webhook proxy sanitizes rejected backend responses", () => {
  assert.match(webhookRoute, /backendResponse\.ok/);
  assert.match(webhookRoute, /responsePayload\.error \?\? "Ashby webhook was rejected\."/);
  assert.doesNotMatch(webhookRoute, /message/);
  assert.doesNotMatch(webhookRoute, /stack/);
  assert.doesNotMatch(webhookRoute, /details/);
});
