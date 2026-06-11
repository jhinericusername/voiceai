import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scoreTabSource = await readFile(new URL("../app/dashboard/roles/[roleId]/ScoreTab.tsx", import.meta.url), "utf8");
const roleWorkspaceSource = await readFile(
  new URL("../app/dashboard/roles/[roleId]/RoleWorkspaceTabs.tsx", import.meta.url),
  "utf8",
);
const rolePageSource = await readFile(new URL("../app/dashboard/roles/[roleId]/page.tsx", import.meta.url), "utf8");

test("score tab debounces and aborts superseded candidate searches", () => {
  assert.match(scoreTabSource, /SEARCH_DEBOUNCE_MS/);
  assert.match(scoreTabSource, /setTimeout/);
  assert.match(scoreTabSource, /clearTimeout/);
  assert.match(scoreTabSource, /AbortController/);
  assert.match(scoreTabSource, /\.abort\(\)/);
  assert.match(scoreTabSource, /signal:\s*abortController\.signal/);
});

test("score tab clears saved feedback when the score form changes", () => {
  assert.match(scoreTabSource, /function markFormDirty/);
  assert.match(scoreTabSource, /markFormDirty\(\);\s*setProblemSolving/);
  assert.match(scoreTabSource, /markFormDirty\(\);\s*setAgency/);
  assert.match(scoreTabSource, /markFormDirty\(\);\s*setCompetitiveness/);
  assert.match(scoreTabSource, /markFormDirty\(\);\s*setCuriosity/);
  assert.match(scoreTabSource, /markFormDirty\(\);\s*setComments/);
});

test("score tab locks form-changing controls while a save is in flight", () => {
  assert.match(scoreTabSource, /readonly disabled: boolean/);
  assert.match(scoreTabSource, /disabled=\{disabled\}/);
  assert.match(scoreTabSource, /isSaving \|\| !hasAshbyJob/);
  assert.match(scoreTabSource, /disabled=\{formDisabled\}/);
  assert.match(scoreTabSource, /disabled=\{isSaving \|\| isSearching \|\| !hasAshbyJob\}/);
});

test("score tab requires a concrete Ashby job before search or save", () => {
  assert.match(scoreTabSource, /normalizedJobId/);
  assert.match(scoreTabSource, /hasAshbyJob/);
  assert.match(scoreTabSource, /!hasAshbyJob/);
  assert.match(scoreTabSource, /availableJobIds/);
  assert.match(scoreTabSource, /selectedJobId/);
  assert.match(scoreTabSource, /jobId:\s*normalizedJobId/);
  assert.match(scoreTabSource, /roleId:\s*normalizedJobId/);
  assert.doesNotMatch(scoreTabSource, /jobId:\s*jobId \?\? null/);
});

test("role page supplies selected Ashby jobs to the score tab only after onboarding is complete", () => {
  assert.match(rolePageSource, /getAshbyCompanyState/);
  assert.match(rolePageSource, /state\?\.setupStatus === "connected" && state\.connected && Boolean\(state\.lastSyncAt\)/);
  assert.match(rolePageSource, /state\.selectedJobIds/);
  assert.match(rolePageSource, /ashbyJobIds=\{ashbyJobIds\}/);
  assert.doesNotMatch(rolePageSource, /state\?\.connected \? state\.selectedJobIds : \[\]/);
  assert.match(roleWorkspaceSource, /readonly ashbyJobIds: readonly string\[\]/);
  assert.match(roleWorkspaceSource, /availableJobIds=\{ashbyJobIds\}/);
});

test("score tab status feedback is announced and action copy matches score saving", () => {
  assert.match(scoreTabSource, /role="status"/);
  assert.match(scoreTabSource, /aria-live="polite"/);
  assert.match(scoreTabSource, /Save Score/);
  assert.doesNotMatch(scoreTabSource, /Save Candidate/);
});
