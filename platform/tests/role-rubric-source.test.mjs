import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modelSource = await readFile(
  new URL("../app/dashboard/roles/[roleId]/role-rubric-model.ts", import.meta.url),
  "utf8",
).catch(() => "");
const editorSource = await readFile(
  new URL("../app/dashboard/roles/[roleId]/RoleRubricEditor.tsx", import.meta.url),
  "utf8",
).catch(() => "");
const roleTabsSource = await readFile(
  new URL("../app/dashboard/roles/[roleId]/RoleWorkspaceTabs.tsx", import.meta.url),
  "utf8",
);
const rolePageSource = await readFile(new URL("../app/dashboard/roles/[roleId]/page.tsx", import.meta.url), "utf8");
const directRubricPageSource = await readFile(
  new URL("../app/dashboard/roles/[roleId]/rubric/page.tsx", import.meta.url),
  "utf8",
);
const rubricsIndexSource = await readFile(
  new URL("../app/dashboard/rubrics/page.tsx", import.meta.url),
  "utf8",
).catch(() => "");
const platformRubricPageSource = await readFile(
  new URL("../app/dashboard/rubrics/[roleId]/page.tsx", import.meta.url),
  "utf8",
).catch(() => "");
const dashboardUiSource = await readFile(new URL("../app/dashboard/dashboard-ui.tsx", import.meta.url), "utf8");

test("role rubric model contains the six Weave dimensions without accent scoring", () => {
  assert.match(modelSource, /weaveDimensionLibrary/);
  for (const key of [
    "problem_solving",
    "agency",
    "competitiveness",
    "curious",
    "communication",
    "passion_for_sales",
  ]) {
    assert.match(modelSource, new RegExp(key));
  }
  assert.match(modelSource, /Choppy, incomprehensible, or hard to follow/);
  assert.match(modelSource, /reason_for_getting_into_sales/);
  assert.match(modelSource, /professional_sales_background/);
  assert.match(modelSource, /performance_as_salesperson/);
  assert.doesNotMatch(modelSource, /heavy accent/i);
});

test("role rubric editor saves drafts and approves stored draft versions", () => {
  assert.match(editorSource, /"use client"/);
  assert.match(editorSource, /\/api\/grading\/profiles\/\$\{encodeURIComponent\(profile\.profile_id\)\}\/draft/);
  assert.match(editorSource, /\/api\/grading\/profiles\/\$\{encodeURIComponent\(profile\.profile_id\)\}\/approve/);
  assert.match(editorSource, /selectedDimensionKeys/);
  assert.match(editorSource, /Passion for Sales/);
  assert.match(editorSource, /sub_dimensions/);
  assert.match(editorSource, /role="status"/);
  assert.match(editorSource, /aria-live="polite"/);
});

test("role rubric status pills use active and missing rubric tones", () => {
  assert.match(dashboardUiSource, /case "Active Rubric":[\s\S]*border-emerald-200 bg-emerald-50 text-emerald-800/);
  assert.match(dashboardUiSource, /case "Needs Rubric":[\s\S]*border-rose-200 bg-rose-50 text-rose-800/);
  assert.match(rubricsIndexSource, /return "Active Rubric"/);
  assert.match(rubricsIndexSource, /return "Needs Rubric"/);
  assert.match(editorSource, /activeVersionId \? "Active Rubric"/);
});

test("role rubric editor shows an explicit approval confirmation card", () => {
  assert.match(editorSource, /approvalConfirmation/);
  assert.match(editorSource, /setApprovalConfirmation\(true\)/);
  assert.match(editorSource, /role="alert"/);
  assert.match(editorSource, /Draft approved/);
  assert.match(editorSource, /This rubric is now active for future grading on this role/);
  assert.match(editorSource, /Dismiss approval confirmation/);
  assert.doesNotMatch(editorSource, /setApprovalConfirmation\(true\);\s*router\.refresh\(\)/);
});

test("role workspace loads and renders the persisted grading profile for the selected role", () => {
  assert.match(rolePageSource, /getGradingCompanyState/);
  assert.match(rolePageSource, /gradingProfiles/);
  assert.match(rolePageSource, /selectedGradingProfile/);
  assert.match(roleTabsSource, /RoleRubricEditor/);
  assert.match(roleTabsSource, /gradingProfile/);
  assert.doesNotMatch(roleTabsSource, /rubric is not configured in Puddle yet/);
});

test("role rubric editor state is scoped to the selected role and profile versions", () => {
  assert.match(roleTabsSource, /rubricEditorKey/);
  assert.match(roleTabsSource, /selectedRole\.jobId/);
  assert.match(roleTabsSource, /gradingProfile\?\.profile_id/);
  assert.match(roleTabsSource, /gradingProfile\?\.draft_rubric_version_id/);
  assert.match(roleTabsSource, /gradingProfile\?\.active_rubric_version_id/);
  assert.match(roleTabsSource, /key=\{rubricEditorKey\}/);
});

test("role rubric editor promotes approved drafts into local active state", () => {
  assert.match(editorSource, /activeVersionId/);
  assert.match(editorSource, /setActiveVersionId\(versionId\)/);
  assert.match(editorSource, /setDraftVersionId\(null\)/);
  assert.doesNotMatch(editorSource, /profile\.draft_rubric_version_id \? "Draft ready"/);
});

test("role rubric editor refreshes server profile state after persisted mutations", () => {
  assert.match(editorSource, /useRouter/);
  assert.match(editorSource, /router\.refresh\(\)/);
  assert.match(editorSource, /saveDraft\(rubric,\s*\{\s*refresh:\s*false\s*\}\)/);
});

test("direct role rubric route renders the real rubric editor", () => {
  assert.match(directRubricPageSource, /getGradingCompanyState/);
  assert.match(directRubricPageSource, /selectedGradingProfile/);
  assert.match(directRubricPageSource, /RoleRubricEditor/);
  assert.match(directRubricPageSource, /rubricEditorKey/);
  assert.match(directRubricPageSource, /selectedRole\.jobId/);
  assert.match(directRubricPageSource, /selectedGradingProfile\?\.profile_id/);
  assert.match(directRubricPageSource, /selectedGradingProfile\?\.draft_rubric_version_id/);
  assert.match(directRubricPageSource, /selectedGradingProfile\?\.active_rubric_version_id/);
  assert.match(directRubricPageSource, /key=\{rubricEditorKey\}/);
  assert.match(directRubricPageSource, /profile=\{selectedGradingProfile\}/);
  assert.doesNotMatch(directRubricPageSource, /Real role-specific criteria will appear here once configured/);
  assert.doesNotMatch(directRubricPageSource, /No role rubric configured yet/);
});

test("platform rubrics route is the top-level role rubric workspace", () => {
  assert.match(rubricsIndexSource, /getAshbyJobs/);
  assert.match(rubricsIndexSource, /getGradingCompanyState/);
  assert.match(rubricsIndexSource, /jobs\.map/);
  assert.match(rubricsIndexSource, /\/dashboard\/rubrics\/\$\{encodeURIComponent\(role\.id\)\}/);
  assert.match(rubricsIndexSource, /active_rubric_version_id/);
  assert.match(rubricsIndexSource, /draft_rubric_version_id/);
  assert.doesNotMatch(rubricsIndexSource, /ActivePipelineDashboard/);
  assert.doesNotMatch(rubricsIndexSource, /getAshbyActivePipeline/);
});

test("platform role rubric route renders the persisted profile editor for the selected role", () => {
  assert.match(platformRubricPageSource, /requireDashboardUser\(`\/dashboard\/rubrics\/\$\{roleId\}`\)/);
  assert.match(platformRubricPageSource, /getAshbyJobs/);
  assert.match(platformRubricPageSource, /getGradingCompanyState/);
  assert.match(platformRubricPageSource, /selectedGradingProfile/);
  assert.match(platformRubricPageSource, /RoleRubricEditor/);
  assert.match(platformRubricPageSource, /rubricEditorKey/);
  assert.match(platformRubricPageSource, /selectedRole\.jobId/);
  assert.match(platformRubricPageSource, /profile=\{selectedGradingProfile\}/);
  assert.doesNotMatch(platformRubricPageSource, /getAshbyActivePipeline/);
});
