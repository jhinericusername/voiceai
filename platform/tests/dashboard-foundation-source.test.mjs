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
const roleDetailSource = await source("../app/dashboard/roles/[roleId]/page.tsx");
const roleTabsSource = await source("../app/dashboard/roles/[roleId]/RoleWorkspaceTabs.tsx");
const roleCandidateSource = await source("../app/dashboard/roles/[roleId]/candidates/[candidateId]/page.tsx");
const roleRubricSource = await source("../app/dashboard/roles/[roleId]/rubric/page.tsx");
const scoreTabSource = await source("../app/dashboard/roles/[roleId]/ScoreTab.tsx");
const candidatesSource = await source("../app/dashboard/candidates/page.tsx");
const reviewQueueSource = await source("../app/dashboard/review-queue/page.tsx");
const ashbyFirstSectionsSource = await source("../app/dashboard/AshbyFirstDashboardSections.tsx");
const interviewDetailSource = await source("../app/dashboard/interviews/[sessionId]/page.tsx");
const backendDataSource = await source("../app/dashboard/backend-data.ts");
const dashboardRoutesSource = await source("../../backend/src/dashboard/routes.ts");
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

test("nested role workspace routes do not expose demo dashboard data", () => {
  for (const [name, pageSource] of [
    ["role detail", roleDetailSource],
    ["role tabs", roleTabsSource],
    ["candidate detail", roleCandidateSource],
    ["rubric detail", roleRubricSource],
  ]) {
    assert.doesNotMatch(pageSource, /demo-data/, `${name} should not import demo-data`);
    assert.doesNotMatch(pageSource, /demoRoles/, `${name} should not generate fake static params`);
    assert.doesNotMatch(pageSource, /DemoCandidate|DemoRole|DemoSession/, `${name} should not type against demo models`);
  }

  assert.match(roleDetailSource, /generateStaticParams\(\)\s*\{\s*return\s+\[\]/);
  assert.match(roleCandidateSource, /generateStaticParams\(\)\s*\{\s*return\s+\[\]/);
  assert.match(roleRubricSource, /generateStaticParams\(\)\s*\{\s*return\s+\[\]/);
});

test("roles, candidates, and review queue are explicit about role-scoped interviewing", () => {
  assert.match(rolesSource, /RolesPipelineFoundation/);
  assert.match(rolesSource, /selectedAshbyJobCount/);
  assert.match(candidatesSource, /CandidateApplicationsFoundation/);
  assert.match(reviewQueueSource, /ReviewRolePickerFoundation/);
  assert.match(ashbyFirstSectionsSource, /role picker/i);
  assert.match(ashbyFirstSectionsSource, /<select/);
  assert.doesNotMatch(ashbyFirstSectionsSource, /Role picker appears after role names sync/);
  assert.doesNotMatch(reviewQueueSource, /getRealInterviews/);
});

test("interview detail is Fireflies-like, real-only, and hides raw internal identifiers", () => {
  assert.match(interviewDetailSource, /getRealInterview/);
  assert.match(interviewDetailSource, /candidateAudioUrl/);
  assert.match(interviewDetailSource, /<audio/);
  assert.match(interviewDetailSource, /aria-label="Transcript"/);
  assert.match(interviewDetailSource, /xl:grid-cols-\[minmax\(0,1fr\)_minmax\(360px,420px\)\]/);
  assert.match(interviewDetailSource, /Historical Fireflies import/);
  assert.match(interviewDetailSource, /Fireflies historical import/);
  assert.doesNotMatch(interviewDetailSource, /dashboardDemoFallbackEnabled/);
  assert.doesNotMatch(interviewDetailSource, /demoSessions/);
  assert.doesNotMatch(interviewDetailSource, /getSession\(/);
  assert.doesNotMatch(interviewDetailSource, /PacketMetaRow label="Session"/);
  assert.doesNotMatch(interviewDetailSource, /PacketMetaRow label="Transcript ID"/);
  assert.doesNotMatch(interviewDetailSource, /PacketMetaRow label="Room"/);
  assert.doesNotMatch(interviewDetailSource, /Org \{/);
  assert.doesNotMatch(interviewDetailSource, /PacketMetaRow label="Script"/);
  assert.doesNotMatch(interviewDetailSource, /PacketMetaRow label="Storage"/);
  assert.doesNotMatch(interviewDetailSource, /<span[^>]*>\{turn\.questionId\}/);
});

test("dashboard backend signs audio fallback media for audio-only interviews", () => {
  assert.match(dashboardRoutesSource, /signedArtifactMediaUrl/);
  assert.match(dashboardRoutesSource, /candidate_audio/);
  assert.match(dashboardRoutesSource, /candidateAudioUrl/);
  assert.match(backendDataSource, /candidateAudioUrl: string \| null/);
});

test("visible dashboard controls use readable labels instead of raw Ashby identifiers", () => {
  assert.doesNotMatch(scoreTabSource, /Job \$\{index \+ 1\}: \$\{ashbyJobId\}/);
  assert.match(scoreTabSource, /Ashby job \${index \+ 1}/);
});

test("Ashby onboarding setup is friendly without exposing unreadable job identifiers", () => {
  assert.match(wizardSource, /puddle-mascot/);
  assert.doesNotMatch(wizardSource, /\$\{job\.status\} - \$\{job\.id\}/);
});
