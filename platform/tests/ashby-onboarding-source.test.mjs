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
const wizardSource = await readFile(
  new URL("../app/dashboard/AshbyOnboardingWizard.tsx", import.meta.url),
  "utf8",
).catch(() => "");
const dashboardSource = await readFile(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");

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

test("dashboard uses the Ashby onboarding wizard for non-connected companies", () => {
  assert.match(dashboardSource, /AshbyOnboardingWizard/);
  assert.match(dashboardSource, /state\.connected && Boolean\(state\.lastSyncAt\)/);
  assert.match(dashboardSource, /onboardingComplete \? await getRecentAshbyScreens/);
  assert.match(wizardSource, /\/api\/ashby\/onboarding\/api-key/);
  assert.match(wizardSource, /\/api\/ashby\/onboarding\/jobs/);
  assert.match(wizardSource, /\/api\/ashby\/onboarding\/sync/);
  assert.match(wizardSource, /webhookSecret/);
  assert.match(wizardSource, /requiredEvents/);
  assert.match(wizardSource, /navigator\.clipboard\?\.writeText/);
  assert.match(wizardSource, /state\.setupStatus \?\? "job_selection_pending"/);
  assert.match(wizardSource, /setApiKey\(""\)/);
  assert.match(wizardSource, /visibleSelectedJobIds/);
  assert.match(wizardSource, /No Ashby jobs were returned/);
  assert.match(wizardSource, /const submittedApiKey = apiKey/);
  assert.match(wizardSource, /body: JSON\.stringify\(\{ ashbyApiKey: submittedApiKey \}\)/);
  assert.match(wizardSource, /useRouter/);
  assert.match(wizardSource, /router\.refresh\(\)/);
  assert.match(wizardSource, /hasVerifiedWebhook/);
  assert.match(wizardSource, /Check webhook connection/);
  assert.match(wizardSource, /Sync active candidates/);
  assert.doesNotMatch(wizardSource, /state\.setupStatus\.replaceAll/);
});

test("wizard clears submitted Ashby API keys before awaiting validation", () => {
  const captureIndex = wizardSource.indexOf("const submittedApiKey = apiKey");
  const clearIndex = wizardSource.indexOf('setApiKey("")');
  const fetchIndex = wizardSource.indexOf('fetch("/api/ashby/onboarding/api-key"');

  assert.notEqual(captureIndex, -1);
  assert.notEqual(clearIndex, -1);
  assert.notEqual(fetchIndex, -1);
  assert.ok(captureIndex < clearIndex);
  assert.ok(clearIndex < fetchIndex);
  assert.match(wizardSource, /body: JSON\.stringify\(\{ ashbyApiKey: submittedApiKey \}\)/);
});

test("wizard can resume pending webhook setup after a fresh page load", () => {
  const pendingFlagIndex = wizardSource.indexOf(
    'const hasPendingWebhookSetup = !setup && !hasVerifiedWebhook && setupStatus === "pending_webhook"',
  );
  const pendingPanelIndex = wizardSource.indexOf("Webhook setup pending");
  const setupBlockIndex = wizardSource.indexOf("{setup ? (");

  assert.notEqual(pendingFlagIndex, -1);
  assert.notEqual(pendingPanelIndex, -1);
  assert.notEqual(setupBlockIndex, -1);
  assert.ok(pendingFlagIndex < pendingPanelIndex);
  assert.ok(pendingPanelIndex < setupBlockIndex);
  assert.match(wizardSource, /state\.webhookUrlPath/);
  assert.match(wizardSource, /hasPendingWebhookSetup \? \(/);
  assert.match(wizardSource, /onClick=\{checkWebhookConnection\}/);
});
