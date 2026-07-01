import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const orgAccess = await import(new URL("../lib/auth/org-access.mjs", import.meta.url));
const dashboardApiReadiness = await import(
  new URL("../lib/ashby/dashboard-api-readiness.mjs", import.meta.url),
);
const dashboardAuthSource = await readFile(new URL("../app/dashboard/auth.ts", import.meta.url), "utf8");
const dashboardLayoutSource = await readFile(new URL("../app/dashboard/layout.tsx", import.meta.url), "utf8");
const notAuthorizedSource = await readFile(new URL("../app/not-authorized/page.tsx", import.meta.url), "utf8");
const ashbyAdminSource = await readFile(
  new URL("../lib/auth/ashby-onboarding-admin.ts", import.meta.url),
  "utf8",
);
const orgAccessSource = await readFile(new URL("../lib/auth/org-access.mjs", import.meta.url), "utf8");
const ashbyServerSource = await readFile(new URL("../lib/ashby/server.ts", import.meta.url), "utf8");
const dashboardApiReadinessSource = await readFile(
  new URL("../lib/ashby/dashboard-api-readiness.mjs", import.meta.url),
  "utf8",
);
const dashboardBackendSource = await readFile(
  new URL("../app/dashboard/backend-data.ts", import.meta.url),
  "utf8",
);
const interviewDetailPageSource = await readFile(
  new URL("../app/dashboard/interviews/[sessionId]/page.tsx", import.meta.url),
  "utf8",
);
const teamInvitationRouteSource = await readFile(
  new URL("../app/api/team-invitations/route.ts", import.meta.url),
  "utf8",
);
const teamPageSource = await readFile(new URL("../app/dashboard/team/page.tsx", import.meta.url), "utf8");
const dashboardActionRoutes = await Promise.all(
  [
    "../app/api/ashby/scores/route.ts",
    "../app/api/ashby/applications/search/route.ts",
    "../app/api/interviews/route.ts",
    "../app/api/dashboard/interviews/[sessionId]/candidate-invite/route.ts",
    "../app/api/dashboard/interviews/[sessionId]/interviewer-join/route.ts",
    "../app/api/dashboard/interviews/[sessionId]/interviewer-connected/route.ts",
    "../app/api/dashboard/interviews/[sessionId]/ai-control/route.ts",
    "../app/api/grading/company-state/route.ts",
    "../app/api/grading/profiles/[profileId]/draft/route.ts",
    "../app/api/grading/profiles/[profileId]/approve/route.ts",
  ].map(async (path) => ({
    path,
    source: await readFile(new URL(path, import.meta.url), "utf8"),
  })),
);

async function pathExists(relativePath) {
  try {
    await access(new URL(relativePath, import.meta.url));
    return true;
  } catch {
    return false;
  }
}

function orgSession(overrides = {}) {
  return {
    user: { id: "user_123", email: "admin@workweave.ai" },
    organizationId: "org_workweave",
    role: "member",
    roles: ["member"],
    permissions: ["dashboard:view"],
    ...overrides,
  };
}

test("org access helpers require WorkOS org membership for dashboard access", () => {
  assert.equal(orgAccess.sessionOrganizationId(orgSession()), "org_workweave");
  assert.equal(orgAccess.sessionOrganizationId(orgSession({ organizationId: "  " })), null);
  assert.equal(orgAccess.canViewDashboard(orgSession()), true);
  assert.equal(orgAccess.canViewDashboard(orgSession({ organizationId: undefined })), false);
  assert.equal(orgAccess.canViewDashboard(orgSession({ permissions: [], role: null, roles: [] })), false);
  assert.equal(orgAccess.hasOrgPermission(orgSession(), "dashboard:view"), true);
  assert.equal(orgAccess.hasOrgPermission(orgSession({ organizationId: null }), "dashboard:view"), false);
});

test("bootstrap Ashby admins are disabled unless explicitly enabled and still need an org", () => {
  const env = {
    PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS: "admin@workweave.ai",
    PUDDLE_ALLOW_BOOTSTRAP_ADMINS: "true",
  };
  const disabledEnv = {
    PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS: "admin@workweave.ai",
  };

  assert.equal(orgAccess.canUseBootstrapAdminEmail(orgSession(), env), true);
  assert.equal(orgAccess.canUseBootstrapAdminEmail(orgSession(), disabledEnv), false);
  assert.equal(
    orgAccess.canUseBootstrapAdminEmail(orgSession({ organizationId: undefined }), env),
    false,
  );
});

test("Ashby and team setup permissions are org-scoped actions", () => {
  assert.equal(
    orgAccess.canManageAshbyOnboardingAccess(
      orgSession({ permissions: ["dashboard:view", "ashby:onboarding:manage"] }),
    ),
    true,
  );
  assert.equal(
    orgAccess.canManageAshbyOnboardingAccess(
      orgSession({ organizationId: null, permissions: ["dashboard:view", "ashby:onboarding:manage"] }),
    ),
    false,
  );
  assert.equal(orgAccess.canInviteTeam(orgSession({ permissions: ["dashboard:view", "team:invite"] })), true);
  assert.equal(orgAccess.canInviteTeam(orgSession({ permissions: ["dashboard:view"] })), false);
});

test("dashboard auth is org-based, not allowed-domain based", () => {
  assert.match(dashboardAuthSource, /canViewDashboard/);
  assert.match(dashboardAuthSource, /sessionOrganizationId/);
  assert.match(dashboardAuthSource, /reason=invitation/);
  assert.doesNotMatch(dashboardAuthSource, /isAllowedAuthEmail/);

  assert.match(notAuthorizedSource, /You need an invitation/);
  assert.match(notAuthorizedSource, /searchParams/);
});

test("dashboard layout gates interview detail routes behind completed Ashby onboarding", () => {
  assert.match(dashboardLayoutSource, /requireDashboardUser/);
  assert.match(dashboardLayoutSource, /DashboardChrome/);
  assert.match(dashboardLayoutSource, /AshbySetupOnlyScreen/);
  assert.match(dashboardLayoutSource, /companyIdentityFromUser/);
  assert.match(dashboardLayoutSource, /getAshbyCompanyState/);
  assert.match(dashboardLayoutSource, /if\s*\(!onboardingComplete\)/);
});

test("backend tenant identity requires WorkOS organizationId", () => {
  assert.match(ashbyServerSource, /input\.organizationId\?\.trim\(\)/);
  assert.match(ashbyServerSource, /does not belong to a WorkOS organization/);
  assert.doesNotMatch(ashbyServerSource, /organizationId:\s*input\.organizationId\s*\?\?\s*null/);

  assert.match(dashboardBackendSource, /input\.organizationId\?\.trim\(\)/);
  assert.match(dashboardBackendSource, /WorkOS organization/);
  assert.doesNotMatch(dashboardBackendSource, /workos-user:/);
});

test("interview detail page displays Fireflies provenance without domain lookup access", () => {
  assert.match(interviewDetailPageSource, /Historical Fireflies import/);
  assert.match(interviewDetailPageSource, /Fireflies historical import/);
  assert.match(interviewDetailPageSource, /external_source\s*===\s*"fireflies"/);
  assert.doesNotMatch(interviewDetailPageSource, /Transcript ID/);
  assert.doesNotMatch(interviewDetailPageSource, /isAllowedAuthEmail/);
  assert.doesNotMatch(interviewDetailPageSource, /allowedAuthDomains/);
});

test("Ashby setup helper is WorkOS permission-first with opt-in bootstrap", () => {
  assert.match(ashbyAdminSource, /canManageAshbyOnboardingAccess/);
  assert.match(orgAccessSource, /PUDDLE_ALLOW_BOOTSTRAP_ADMINS/);
  assert.match(orgAccessSource, /PUDDLE_ASHBY_ONBOARDING_ADMIN_EMAILS/);
});

test("state-changing dashboard API routes require completed Ashby onboarding", () => {
  assert.match(dashboardApiReadinessSource, /canViewDashboard/);
  assert.match(dashboardApiReadinessSource, /getAshbyCompanyState/);
  assert.match(dashboardApiReadinessSource, /isAshbyDashboardReady/);
  assert.match(dashboardApiReadinessSource, /Complete Ashby onboarding/);

  for (const { path, source } of dashboardActionRoutes) {
    assert.match(source, /requireAshbyReadyDashboardApiAccess/, `${path} should use the shared readiness guard`);
    assert.doesNotMatch(source, /canViewDashboard/, `${path} should not hand-roll dashboard readiness`);
    assert.doesNotMatch(source, /isAllowedAuthEmail/, `${path} should not authorize by domain`);
    assert.doesNotMatch(source, /workos-user:/, `${path} should not fall back to per-user org ids`);
  }
});

test("dashboard API readiness guard denies setup-incomplete org members before downstream work", async () => {
  let companyStateLookups = 0;

  const result = await dashboardApiReadiness.requireAshbyReadyDashboardApiAccess({
    withAuth: async () => orgSession(),
    canViewDashboard: () => true,
    sessionOrganizationId: (session) => session.organizationId,
    companyIdentityFromUser: ({ email, organizationId }) => ({
      emailDomain: email.split("@")[1],
      organizationId,
    }),
    getAshbyCompanyState: async () => {
      companyStateLookups += 1;
      return {
        connected: true,
        setupStatus: "pending_jobs",
        integrationId: "int_123",
        emailDomain: "workweave.ai",
        selectedJobIds: [],
        lastPingAt: null,
        lastSyncAt: null,
      };
    },
    isAshbyDashboardReady: () => false,
    responseJson: (payload, status) => ({ payload, status }),
  });

  assert.equal(companyStateLookups, 1);
  assert.equal(result.response.status, 409);
  assert.match(result.response.payload.error, /Complete Ashby onboarding/);
});

test("dashboard API readiness guard returns identity for ready org members", async () => {
  const result = await dashboardApiReadiness.requireAshbyReadyDashboardApiAccess({
    withAuth: async () => orgSession(),
    canViewDashboard: () => true,
    sessionOrganizationId: (session) => session.organizationId,
    companyIdentityFromUser: ({ email, organizationId }) => ({
      emailDomain: email.split("@")[1],
      organizationId,
    }),
    getAshbyCompanyState: async () => ({
      connected: true,
      setupStatus: "connected",
      integrationId: "int_123",
      emailDomain: "workweave.ai",
      selectedJobIds: ["job_123"],
      lastPingAt: "2026-06-15T12:00:00.000Z",
      lastSyncAt: "2026-06-15T12:00:00.000Z",
    }),
    isAshbyDashboardReady: () => true,
    responseJson: (payload, status) => ({ payload, status }),
  });

  assert.equal(result.response, null);
  assert.equal(result.organizationId, "org_workweave");
  assert.deepEqual(result.identity, {
    emailDomain: "workweave.ai",
    organizationId: "org_workweave",
  });
});

test("team invitations require current org and team invite permission", () => {
  assert.match(teamInvitationRouteSource, /sessionOrganizationId/);
  assert.match(teamInvitationRouteSource, /canInviteTeam/);
  assert.match(teamInvitationRouteSource, /organizationId/);
  assert.match(teamInvitationRouteSource, /You need an invitation/);
  assert.doesNotMatch(teamInvitationRouteSource, /isAllowedAuthEmail\(user\.email\)/);
  assert.doesNotMatch(teamInvitationRouteSource, /\?\.\.\(organizationId/);

  assert.match(teamPageSource, /redirect\("\/dashboard\/settings"\)/);
  assert.doesNotMatch(teamPageSource, /DashboardActionButton/);
  assert.doesNotMatch(teamPageSource, /allowedAuthDomains/);
  assert.doesNotMatch(teamPageSource, /approved pilot domains/);
});

test("legacy dashboard action event components are removed", async () => {
  assert.equal(await pathExists("../app/dashboard/DashboardActionButton.tsx"), false);
});
