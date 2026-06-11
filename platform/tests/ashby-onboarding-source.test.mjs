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
const onboardingBehaviorSource = await readFile(
  new URL("../lib/ashby/onboarding-route-behavior.mjs", import.meta.url),
  "utf8",
).catch(() => "");
const adminHelperSource = await readFile(
  new URL("../lib/auth/ashby-onboarding-admin.ts", import.meta.url),
  "utf8",
).catch(() => "");
const webhookRoute = await readFile(new URL("../app/api/ashby/webhook/route.ts", import.meta.url), "utf8");
const wizardSource = await readFile(
  new URL("../app/dashboard/AshbyOnboardingWizard.tsx", import.meta.url),
  "utf8",
).catch(() => "");
const dashboardSource = await readFile(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
const deployPlatformScript = await readFile(
  new URL("../../scripts/deploy-platform.sh", import.meta.url),
  "utf8",
).catch(() => "");
const onboardingBehavior = await import(
  new URL("../lib/ashby/onboarding-route-behavior.mjs", import.meta.url)
);

function jsonRequest(body) {
  return new Request("http://localhost/api/ashby/onboarding/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function behaviorHarness({
  session = {
    user: { email: "admin@usepuddle.com" },
    organizationId: "org_server",
    canManage: true,
  },
  backendResponse = Response.json({ ok: true }, { status: 200 }),
} = {}) {
  const fetchCalls = [];
  const warnCalls = [];
  return {
    fetchCalls,
    warnCalls,
    context: {
      session,
      backendBaseUrl: () => "https://backend.example",
      backendHeaders: () => ({ authorization: "Bearer internal" }),
      companyIdentityFromUser: ({ email, organizationId }) => ({
        emailDomain: String(email).split("@").at(-1).toLowerCase(),
        organizationId: organizationId ?? null,
      }),
      isAllowedAuthEmail: (email) => String(email).toLowerCase().endsWith("@usepuddle.com"),
      canManageAshbyOnboarding: (candidateSession) => Boolean(candidateSession?.canManage),
      fetchImpl: async (...args) => {
        fetchCalls.push(args);
        return backendResponse;
      },
      logger: {
        warn: (...args) => warnCalls.push(args),
      },
      publicBaseUrl: "https://app.usepuddle.com",
    },
  };
}

const onboardingHandlers = [
  {
    name: "api key",
    handler: onboardingBehavior.handleAshbyApiKeyOnboarding,
    request: () =>
      jsonRequest({
        ashbyApiKey: "ashby_key",
        emailDomain: "attacker.example",
        organizationId: "org_attacker",
      }),
    expectedBackendPath: "/integrations/ashby/onboarding/api-key",
    expectedBody: {
      emailDomain: "usepuddle.com",
      organizationId: "org_server",
      reviewerEmail: "admin@usepuddle.com",
      ashbyApiKey: "ashby_key",
    },
    expectedError: "Ashby onboarding request failed.",
  },
  {
    name: "jobs",
    handler: onboardingBehavior.handleAshbyJobsOnboarding,
    request: () =>
      jsonRequest({
        selectedJobIds: ["job_1", 42, "job_2"],
        emailDomain: "attacker.example",
        organizationId: "org_attacker",
      }),
    expectedBackendPath: "/integrations/ashby/onboarding/jobs",
    expectedBody: {
      emailDomain: "usepuddle.com",
      organizationId: "org_server",
      reviewerEmail: "admin@usepuddle.com",
      selectedJobIds: ["job_1", "job_2"],
      publicBaseUrl: "https://app.usepuddle.com",
    },
    expectedError: "Ashby onboarding request failed.",
  },
  {
    name: "sync",
    handler: onboardingBehavior.handleAshbySyncOnboarding,
    request: () =>
      jsonRequest({
        emailDomain: "attacker.example",
        organizationId: "org_attacker",
      }),
    expectedBackendPath: "/integrations/ashby/sync-active-applications",
    expectedBody: {
      emailDomain: "usepuddle.com",
      organizationId: "org_server",
      reviewerEmail: "admin@usepuddle.com",
    },
    expectedError: "Ashby sync request failed.",
  },
];

for (const routeCase of onboardingHandlers) {
  test(`Ashby onboarding ${routeCase.name} denies non-admin users before backend fetch`, async () => {
    const harness = behaviorHarness({
      session: {
        user: { email: "member@usepuddle.com" },
        organizationId: "org_server",
        canManage: false,
      },
    });

    const response = await routeCase.handler(routeCase.request(), harness.context);

    assert.equal(response.status, 403);
    assert.equal(harness.fetchCalls.length, 0);
    assert.deepEqual(await response.json(), {
      error: "Ashby onboarding setup requires a workspace admin or owner.",
    });
  });

  test(`Ashby onboarding ${routeCase.name} sends server-derived identity to backend`, async () => {
    const harness = behaviorHarness();

    const response = await routeCase.handler(routeCase.request(), harness.context);

    assert.equal(response.status, 200);
    assert.equal(harness.fetchCalls.length, 1);
    const [url, init] = harness.fetchCalls[0];
    assert.equal(url, `https://backend.example${routeCase.expectedBackendPath}`);
    assert.deepEqual(JSON.parse(init.body), routeCase.expectedBody);
  });

  test(`Ashby onboarding ${routeCase.name} sanitizes non-OK backend responses`, async () => {
    const harness = behaviorHarness({
      backendResponse: Response.json(
        { error: "Leaked backend detail", stack: "secret stack" },
        { status: 418 },
      ),
    });

    const response = await routeCase.handler(routeCase.request(), harness.context);

    assert.equal(response.status, 418);
    assert.equal(harness.fetchCalls.length, 1);
    assert.deepEqual(await response.json(), { error: routeCase.expectedError });
    assert.equal(harness.warnCalls.length, 1);
  });
}

test("Ashby onboarding API routes are authenticated and derive company identity server-side", () => {
  for (const source of [apiKeyRoute, jobsRoute, syncRoute]) {
    assert.match(source, /withAuth/);
    assert.match(source, /isAllowedAuthEmail/);
    assert.match(source, /canManageAshbyOnboarding/);
    assert.match(source, /companyIdentityFromUser/);
    assert.match(source, /handleAshby.*Onboarding/);
    assert.match(source, /PUDDLE_BACKEND_BASE_URL|backendBaseUrl/);
    assert.doesNotMatch(source, /emailDomain:\s*body\.emailDomain/);
    assert.doesNotMatch(source, /organizationId:\s*body\.organizationId/);
  }
  assert.match(onboardingBehaviorSource, /companyIdentityFromUser/);
  assert.doesNotMatch(onboardingBehaviorSource, /emailDomain:\s*body\.emailDomain/);
  assert.doesNotMatch(onboardingBehaviorSource, /organizationId:\s*body\.organizationId/);
});

test("Ashby onboarding setup management requires WorkOS privilege or bootstrap admin email", () => {
  assert.match(adminHelperSource, /PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS/);
  assert.match(adminHelperSource, /Ashby onboarding setup requires a workspace admin or owner\./);
  for (const role of ["admin", "owner", "organization_admin", "org_admin"]) {
    assert.match(adminHelperSource, new RegExp(role));
  }
  for (const permission of [
    "integrations:manage",
    "ashby:onboarding:manage",
    "ashby:manage",
    "organization:admin",
  ]) {
    assert.ok(adminHelperSource.includes(`"${permission}"`));
  }
  assert.match(adminHelperSource, /toLowerCase\(\)/);
  assert.match(adminHelperSource, /trim\(\)/);

  const adminGateIndex = onboardingBehaviorSource.indexOf("canManageAshbyOnboarding");
  const fetchIndex = onboardingBehaviorSource.indexOf("fetchImpl(");
  assert.notEqual(adminGateIndex, -1);
  assert.notEqual(fetchIndex, -1);
  assert.ok(adminGateIndex < fetchIndex);

  for (const source of [apiKeyRoute, jobsRoute, syncRoute]) {
    assert.match(source, /ASHBY_ONBOARDING_ADMIN_DENIED_ERROR/);
  }
});

test("deploy-platform forwards Ashby onboarding admin emails through environment only", () => {
  assert.match(
    deployPlatformScript,
    /export PLATFORM_ASHBY_ONBOARDING_ADMIN_EMAILS=.*PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS/,
  );
  assert.doesNotMatch(
    deployPlatformScript,
    /CDK_CONTEXT_ARGS\+=\([\s\S]*platformAshbyOnboardingAdminEmails/,
  );
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
  assert.match(onboardingBehaviorSource, /\/integrations\/ashby\/sync-active-applications/);
  assert.doesNotMatch(onboardingBehaviorSource, /\/integrations\/ashby\/onboarding\/sync/);
});

test("Ashby onboarding proxy routes sanitize non-OK backend responses", () => {
  assert.match(onboardingBehaviorSource, /response\.ok/);
  assert.match(onboardingBehaviorSource, /"Ashby onboarding request failed\."/);
  assert.match(onboardingBehaviorSource, /"Ashby sync request failed\."/);
  assert.doesNotMatch(onboardingBehaviorSource, /payload\.error\s*\?\?/);
  assert.doesNotMatch(onboardingBehaviorSource, /stack/);
  assert.doesNotMatch(onboardingBehaviorSource, /details/);
  assert.doesNotMatch(syncRoute, /request\.json\(\)/);
});

test("Ashby webhook proxy sanitizes rejected backend responses", () => {
  assert.match(webhookRoute, /backendResponse\.ok/);
  assert.match(webhookRoute, /"Ashby webhook was rejected\."/);
  assert.match(webhookRoute, /status:\s*400/);
  assert.doesNotMatch(webhookRoute, /responsePayload\.error/);
  assert.doesNotMatch(webhookRoute, /status:\s*backendResponse\.status/);
  assert.doesNotMatch(webhookRoute, /message/);
  assert.doesNotMatch(webhookRoute, /stack/);
  assert.doesNotMatch(webhookRoute, /details/);
});

test("dashboard uses the Ashby onboarding wizard for non-connected companies", () => {
  assert.match(dashboardSource, /AshbyOnboardingWizard/);
  assert.match(dashboardSource, /state\.setupStatus === "connected" && state\.connected && Boolean\(state\.lastSyncAt\)/);
  assert.match(dashboardSource, /onboardingComplete \? await getRecentAshbyScreens/);
  assert.match(dashboardSource, /canManageAshbyOnboarding/);
  assert.match(dashboardSource, /canManageSetup=\{canManageSetup\}/);
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
  assert.match(wizardSource, /canManageSetup/);
  assert.match(wizardSource, /Ask a workspace admin or owner to finish Ashby setup\./);
  assert.doesNotMatch(wizardSource, /state\.setupStatus\.replaceAll/);
});

test("wizard hides setup controls from non-admin users before rendering setup actions", () => {
  const guardIndex = wizardSource.indexOf("if (!canManageSetup)");
  const apiKeyControlIndex = wizardSource.indexOf("<input");
  const syncControlIndex = wizardSource.indexOf("Sync active candidates");

  assert.notEqual(guardIndex, -1);
  assert.notEqual(apiKeyControlIndex, -1);
  assert.notEqual(syncControlIndex, -1);
  assert.ok(guardIndex < apiKeyControlIndex);
  assert.ok(guardIndex < syncControlIndex);
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
