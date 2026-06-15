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
const siteUrlSource = await readFile(new URL("../lib/site-url.ts", import.meta.url), "utf8").catch(() => "");
const backendApiSource = await readFile(new URL("../lib/backend-api.ts", import.meta.url), "utf8").catch(() => "");
const adminHelperSource = await readFile(
  new URL("../lib/auth/ashby-onboarding-admin.ts", import.meta.url),
  "utf8",
).catch(() => "");
const orgAccessSource = await readFile(new URL("../lib/auth/org-access.mjs", import.meta.url), "utf8").catch(() => "");
const webhookRoute = await readFile(new URL("../app/api/ashby/webhook/route.ts", import.meta.url), "utf8");
const wizardSource = await readFile(
  new URL("../app/dashboard/AshbyOnboardingWizard.tsx", import.meta.url),
  "utf8",
).catch(() => "");
const dashboardLayoutSource = await readFile(new URL("../app/dashboard/layout.tsx", import.meta.url), "utf8");
const dashboardSource = await readFile(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
const deployPlatformScript = await readFile(
  new URL("../../scripts/deploy-platform.sh", import.meta.url),
  "utf8",
).catch(() => "");
const ashbySetupDocsSource = await readFile(
  new URL("../docs/ashby-internal-setup.md", import.meta.url),
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
        organizationId,
      }),
      canViewDashboard: (candidateSession) => Boolean(candidateSession?.organizationId),
      canManageAshbyOnboarding: (candidateSession) => Boolean(candidateSession?.canManage),
      sessionOrganizationId: (candidateSession) => candidateSession?.organizationId ?? null,
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

  test(`Ashby onboarding ${routeCase.name} denies org-less users before backend fetch`, async () => {
    const harness = behaviorHarness({
      session: {
        user: { email: "admin@usepuddle.com" },
        canManage: true,
      },
    });

    const response = await routeCase.handler(routeCase.request(), harness.context);

    assert.equal(response.status, 403);
    assert.equal(harness.fetchCalls.length, 0);
    assert.deepEqual(await response.json(), {
      error: "You need an invitation to access this workspace.",
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
    assert.doesNotMatch(JSON.stringify(harness.warnCalls), /Leaked backend detail/);
    assert.doesNotMatch(JSON.stringify(harness.warnCalls), /secret stack/);
  });
}

test("Ashby onboarding API routes are authenticated and derive company identity server-side", () => {
  for (const source of [apiKeyRoute, jobsRoute, syncRoute]) {
    assert.match(source, /withAuth/);
    assert.match(source, /canViewDashboard/);
    assert.match(source, /canManageAshbyOnboarding/);
    assert.match(source, /sessionOrganizationId/);
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
  assert.match(adminHelperSource, /canManageAshbyOnboardingAccess/);
  assert.match(orgAccessSource, /PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS/);
  assert.match(orgAccessSource, /PUDDLE_ALLOW_BOOTSTRAP_ADMINS/);
  assert.match(adminHelperSource, /Ashby onboarding setup requires a workspace admin or owner\./);
  for (const role of ["admin", "owner", "organization_admin", "org_admin"]) {
    assert.match(orgAccessSource, new RegExp(role));
  }
  for (const permission of [
    "integrations:manage",
    "ashby:onboarding:manage",
    "ashby:manage",
    "organization:admin",
  ]) {
    assert.ok(orgAccessSource.includes(`"${permission}"`));
  }
  assert.match(orgAccessSource, /toLowerCase\(\)/);
  assert.match(orgAccessSource, /trim\(\)/);

  const adminGateIndex = onboardingBehaviorSource.indexOf("canManageAshbyOnboarding");
  const fetchIndex = onboardingBehaviorSource.indexOf("fetchImpl(");
  assert.notEqual(adminGateIndex, -1);
  assert.notEqual(fetchIndex, -1);
  assert.ok(adminGateIndex < fetchIndex);

  for (const source of [apiKeyRoute, jobsRoute, syncRoute]) {
    assert.match(source, /ASHBY_ONBOARDING_ADMIN_DENIED_ERROR/);
  }
});

test("Ashby onboarding URL helpers fail closed for production public URLs and backend auth", () => {
  assert.match(siteUrlSource, /function isProduction/);
  assert.match(siteUrlSource, /PUDDLE_PUBLIC_BASE_URL/);
  assert.match(siteUrlSource, /NEXT_PUBLIC_SITE_URL/);
  assert.match(siteUrlSource, /protocol !== "https:"/);
  assert.match(siteUrlSource, /localhost|127\.0\.0\.1/);
  assert.match(siteUrlSource, /NODE_ENV/);

  assert.match(backendApiSource, /NODE_ENV/);
  assert.match(backendApiSource, /PUDDLE_BACKEND_INTERNAL_TOKEN/);
  assert.match(backendApiSource, /throw new Error\("PUDDLE_BACKEND_INTERNAL_TOKEN must be set in production"\)/);

  assert.match(jobsRoute, /publicBaseUrl\(\)/);
  assert.doesNotMatch(jobsRoute, /http:\/\/localhost:3000/);
});

test("deploy-platform forwards Ashby onboarding admin emails through environment only", () => {
  const contextKey = "platformAshbyOnboardingAdminEmails";
  const adminEnvVars = [
    "PLATFORM_ASHBY_ONBOARDING_ADMIN_EMAILS",
    "PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS",
  ];
  const adminEnvVarPattern = adminEnvVars.join("|");
  const allowedConfiguredUnsetCheck = new RegExp(
    `\\$\\(\\s*\\[\\[\\s+-n\\s+"?\\$\\{?(?:${adminEnvVarPattern})\\}?"?\\s+\\]\\]\\s+&&\\s+echo\\s+configured\\s+\\|\\|\\s+echo\\s+unset\\s*\\)`,
    "g",
  );

  function assertAshbyAdminEmailsStayOutOfDeployScript(source) {
    assert.match(
      source,
      /export PLATFORM_ASHBY_ONBOARDING_ADMIN_EMAILS=.*PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS/,
    );
    assert.doesNotMatch(source, new RegExp(`\\b${contextKey}\\b`));

    const logCommands = source.match(/^\s*(?:echo|printf)\b.*$/gm) ?? [];
    for (const line of logCommands) {
      const lineWithoutAllowedStatusChecks = line.replace(allowedConfiguredUnsetCheck, "");
      for (const adminEnvVar of adminEnvVars) {
        assert.ok(
          !lineWithoutAllowedStatusChecks.includes(adminEnvVar),
          `deploy-platform must not directly echo/log ${adminEnvVar}: ${line}`,
        );
      }
    }
  }

  assertAshbyAdminEmailsStayOutOfDeployScript(deployPlatformScript);

  for (const source of [
    'export PLATFORM_ASHBY_ONBOARDING_ADMIN_EMAILS="${PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS:-}"\nCDK_CONTEXT_ARGS=(-c platformAshbyOnboardingAdminEmails="$PLATFORM_ASHBY_ONBOARDING_ADMIN_EMAILS")',
    'export PLATFORM_ASHBY_ONBOARDING_ADMIN_EMAILS="${PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS:-}"\nCDK_CONTEXT_ARGS+=(-c platformAshbyOnboardingAdminEmails="$PLATFORM_ASHBY_ONBOARDING_ADMIN_EMAILS")',
    'export PLATFORM_ASHBY_ONBOARDING_ADMIN_EMAILS="${PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS:-}"\nnpm run cdk -- deploy -c platformAshbyOnboardingAdminEmails="$PLATFORM_ASHBY_ONBOARDING_ADMIN_EMAILS"',
  ]) {
    assert.throws(() => assertAshbyAdminEmailsStayOutOfDeployScript(source), new RegExp(contextKey));
  }

  for (const adminEnvVar of adminEnvVars) {
    assert.throws(
      () =>
        assertAshbyAdminEmailsStayOutOfDeployScript(
          `export PLATFORM_ASHBY_ONBOARDING_ADMIN_EMAILS="\${PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS:-}"\necho "ashby admins: $${adminEnvVar}"`,
        ),
      /must not directly echo\/log/,
    );
  }
});

test("Ashby webhook proxy forwards raw body and signature to backend", () => {
  assert.match(webhookRoute, /request\.text\(\)/);
  assert.match(webhookRoute, /request\.headers\.get\("ashby-signature"\)/);
  assert.match(webhookRoute, /rawBody/);
  assert.match(webhookRoute, /signature/);
  assert.match(webhookRoute, /integrationId/);
  assert.doesNotMatch(webhookRoute, /companyDomain/);
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
  assert.match(onboardingBehaviorSource, /status: response\.status/);
  assert.match(onboardingBehaviorSource, /backendPath: config\.backendPath/);
  assert.doesNotMatch(onboardingBehaviorSource, /payload\s*}/);
  assert.doesNotMatch(onboardingBehaviorSource, /payload\.error\s*\?\?/);
  assert.doesNotMatch(onboardingBehaviorSource, /stack/);
  assert.doesNotMatch(onboardingBehaviorSource, /details/);
  assert.doesNotMatch(syncRoute, /request\.json\(\)/);
});

test("Ashby setup docs list the backend decryption allowlist", () => {
  assert.match(ashbySetupDocsSource, /Secret decryption allowlist/);
  assert.match(ashbySetupDocsSource, /selected-job-validation/);
  assert.match(ashbySetupDocsSource, /active-application-sync/);
  assert.match(ashbySetupDocsSource, /webhook-setup-display/);
  assert.match(ashbySetupDocsSource, /webhook-signature-verification/);
  assert.match(ashbySetupDocsSource, /Do not add new decrypt points/);
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

test("dashboard layout gates the entire dashboard subtree until Ashby onboarding is complete", () => {
  assert.match(dashboardLayoutSource, /companyIdentityFromUser/);
  assert.match(dashboardLayoutSource, /getAshbyCompanyState/);
  assert.match(dashboardLayoutSource, /state\.setupStatus === "connected" && state\.connected && Boolean\(state\.lastSyncAt\)/);
  assert.match(dashboardLayoutSource, /canManageAshbyOnboarding/);
  assert.match(dashboardLayoutSource, /AshbyOnboardingWizard/);
  assert.match(dashboardLayoutSource, /if \(!onboardingComplete\)/);
  assert.match(dashboardLayoutSource, /canManageSetup=\{canManageSetup\}/);

  const incompleteGateIndex = dashboardLayoutSource.indexOf("if (!onboardingComplete)");
  const wizardIndex = dashboardLayoutSource.indexOf("<AshbyOnboardingWizard");
  const dashboardChromeIndex = dashboardLayoutSource.indexOf("<DashboardChrome");
  const childRenderIndex = dashboardLayoutSource.indexOf("{children}", dashboardChromeIndex);

  assert.notEqual(incompleteGateIndex, -1);
  assert.notEqual(wizardIndex, -1);
  assert.notEqual(dashboardChromeIndex, -1);
  assert.notEqual(childRenderIndex, -1);
  assert.ok(incompleteGateIndex < wizardIndex);
  assert.ok(wizardIndex < dashboardChromeIndex);
  assert.ok(dashboardChromeIndex < childRenderIndex);
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

test("dashboard keeps an admin reconnect path after Ashby onboarding is complete", () => {
  assert.match(dashboardSource, /canManageSetup && onboardingComplete/);
  assert.match(dashboardSource, /AshbyOnboardingWizard state=\{state\} canManageSetup=\{canManageSetup\}/);
  assert.match(wizardSource, /Replace Ashby key|Reconnect Ashby/);
  assert.match(wizardSource, /Replacing the key resets webhook verification/);
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
