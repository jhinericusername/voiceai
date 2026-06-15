import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

const layoutSource = await source("../app/dashboard/layout.tsx");
const chromeSource = await source("../app/dashboard/DashboardChrome.tsx");
const overviewSource = await source("../app/dashboard/page.tsx");
const rolesSource = await source("../app/dashboard/roles/page.tsx");
const candidatesSource = await source("../app/dashboard/candidates/page.tsx");
const reviewQueueSource = await source("../app/dashboard/review-queue/page.tsx");
const ashbyFirstSectionsSource = await source("../app/dashboard/AshbyFirstDashboardSections.tsx");
const interviewDetailSource = await source("../app/dashboard/interviews/[sessionId]/page.tsx");
const wizardSource = await source("../app/dashboard/AshbyOnboardingWizard.tsx");

test("dashboard layout gates operational routes behind completed Ashby onboarding", () => {
  assert.match(layoutSource, /requireDashboardUser/);
  assert.match(layoutSource, /companyIdentityFromUser/);
  assert.match(layoutSource, /getAshbyCompanyState/);
  assert.match(layoutSource, /isAshbyDashboardReady/);
  assert.match(layoutSource, /AshbySetupOnlyScreen/);
  assert.match(layoutSource, /if\s*\(!onboardingComplete\)/);
  assert.match(layoutSource, /return\s*\(\s*<AshbySetupOnlyScreen/);
  assert.match(layoutSource, /DashboardChrome/);
  assert.doesNotMatch(layoutSource, /demoRoles/);
  assert.doesNotMatch(layoutSource, /demo-data/);
  assert.doesNotMatch(layoutSource, /allowedAuthDomains/);
});

test("dashboard chrome uses Ashby-first navigation without fake role controls", () => {
  for (const label of ["Roles", "Candidates", "Review Queue", "Recordings", "Analytics", "Settings"]) {
    assert.match(chromeSource, new RegExp(label));
  }

  assert.match(chromeSource, /Search candidates/);
  assert.match(chromeSource, /Cmd\+K/);
  assert.doesNotMatch(chromeSource, /CreateInterviewCard/);
  assert.doesNotMatch(chromeSource, /CreateTeamInvitationCard/);
  assert.doesNotMatch(chromeSource, /Active role/);
  assert.doesNotMatch(chromeSource, /roles:/);
  assert.doesNotMatch(chromeSource, /demoRoles/);
});

test("dashboard default route redirects to roles after onboarding", () => {
  assert.match(overviewSource, /redirect\("\/dashboard\/roles"\)/);
  assert.doesNotMatch(overviewSource, /AshbyOnboardingWizard/);
  assert.doesNotMatch(overviewSource, /DashboardSections/);
  assert.doesNotMatch(overviewSource, /NeedsReviewQueue/);
  assert.doesNotMatch(overviewSource, /dashboardDemoFallbackEnabled/);
});

test("top-level operational pages do not import demo dashboard data", () => {
  for (const [name, pageSource] of [
    ["roles", rolesSource],
    ["candidates", candidatesSource],
    ["review queue", reviewQueueSource],
  ]) {
    assert.doesNotMatch(pageSource, /demo-data/, `${name} page should not import demo-data`);
    assert.doesNotMatch(
      pageSource,
      /from\s+["']\.\.\/DashboardSections["']/,
      `${name} page should not import demo dashboard sections`,
    );
    assert.doesNotMatch(pageSource, /dashboardDemoFallbackEnabled/, `${name} page should not enable demo fallback`);
  }
});

test("roles, candidates, and review queue are explicit about role-scoped interviewing", () => {
  assert.match(rolesSource, /RolesPipelineFoundation/);
  assert.match(rolesSource, /selectedAshbyJobCount/);
  assert.match(candidatesSource, /CandidateApplicationsFoundation/);
  assert.match(reviewQueueSource, /ReviewRolePickerFoundation/);
  assert.match(ashbyFirstSectionsSource, /role picker/i);
  assert.doesNotMatch(reviewQueueSource, /getRealInterviews/);
});

test("interview detail is real-only and hides raw internal identifiers", () => {
  assert.match(interviewDetailSource, /getRealInterview/);
  assert.match(interviewDetailSource, /Historical Fireflies import/);
  assert.match(interviewDetailSource, /Fireflies historical import/);
  assert.doesNotMatch(interviewDetailSource, /dashboardDemoFallbackEnabled/);
  assert.doesNotMatch(interviewDetailSource, /demoSessions/);
  assert.doesNotMatch(interviewDetailSource, /getSession\(/);
  assert.doesNotMatch(interviewDetailSource, /PacketMetaRow label="Session"/);
  assert.doesNotMatch(interviewDetailSource, /PacketMetaRow label="Transcript ID"/);
  assert.doesNotMatch(interviewDetailSource, /Org \{/);
  assert.doesNotMatch(interviewDetailSource, /PacketMetaRow label="Script"/);
  assert.doesNotMatch(interviewDetailSource, /PacketMetaRow label="Storage"/);
  assert.doesNotMatch(interviewDetailSource, /<span[^>]*>\{turn\.questionId\}/);
});

test("Ashby onboarding setup is friendly without exposing unreadable job identifiers", () => {
  assert.match(wizardSource, /puddle-mascot/);
  assert.doesNotMatch(wizardSource, /\$\{job\.status\} - \$\{job\.id\}/);
});
