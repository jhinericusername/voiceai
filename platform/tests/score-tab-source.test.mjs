import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scoreTabSource = await readFile(new URL("../app/dashboard/roles/[roleId]/ScoreTab.tsx", import.meta.url), "utf8");

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
  assert.match(scoreTabSource, /disabled=\{isSaving\}/);
  assert.match(scoreTabSource, /disabled=\{isSaving \|\| isSearching\}/);
});

test("score tab status feedback is announced and action copy matches score saving", () => {
  assert.match(scoreTabSource, /role="status"/);
  assert.match(scoreTabSource, /aria-live="polite"/);
  assert.match(scoreTabSource, /Save Score/);
  assert.doesNotMatch(scoreTabSource, /Save Candidate/);
});
