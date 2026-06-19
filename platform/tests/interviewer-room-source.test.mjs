import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

const createInterviewRoute = await source("../app/api/interviews/route.ts");
const candidateInviteRoute = await source(
  "../app/api/dashboard/interviews/[sessionId]/candidate-invite/route.ts",
);
const interviewerJoinRoute = await source(
  "../app/api/dashboard/interviews/[sessionId]/interviewer-join/route.ts",
);
const aiControlRoute = await source("../app/api/dashboard/interviews/[sessionId]/ai-control/route.ts");

test("create interview API returns an interviewer join URL for host launch", () => {
  assert.match(createInterviewRoute, /interviewerJoinUrl/);
  assert.match(
    createInterviewRoute,
    /\/dashboard\/interviews\/\$\{encodeURIComponent\(createdSession\.sessionId\)\}\/join/,
  );
});

test("interviewer platform routes require completed dashboard access", () => {
  for (const routeSource of [candidateInviteRoute, interviewerJoinRoute, aiControlRoute]) {
    assert.match(routeSource, /requireAshbyReadyDashboardApiAccess/);
    assert.match(routeSource, /dashboardApiReadinessContext/);
    assert.match(routeSource, /backendHeaders\(\)/);
    assert.match(routeSource, /organizationId/);
    assert.match(routeSource, /access\.user\.email/);
    assert.match(routeSource, /access\.user\.id/);
    assert.doesNotMatch(routeSource, /isAllowedAuthEmail/);
  }
});

test("candidate invite route mints a candidate URL through the backend", () => {
  assert.match(candidateInviteRoute, /candidate-invites/);
  assert.match(candidateInviteRoute, /invitePath/);
  assert.match(candidateInviteRoute, /candidateInviteUrl/);
});

test("interviewer join and AI control routes call the role-specific backend surfaces", () => {
  assert.match(interviewerJoinRoute, /interviewer\/join/);
  assert.match(aiControlRoute, /ai-control/);
  assert.match(aiControlRoute, /action/);
});
