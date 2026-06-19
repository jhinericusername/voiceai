import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

async function requiredSource(relativePath) {
  try {
    return await source(relativePath);
  } catch {
    assert.fail(`${relativePath} should exist`);
  }
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

test("interviewer platform routes fail closed on malformed backend success payloads", () => {
  assert.match(candidateInviteRoute, /Candidate invite response was malformed\./);
  assert.match(candidateInviteRoute, /isCandidateInviteResponse\(payload\)/);
  assert.match(candidateInviteRoute, /typeof \w+\.invitePath === "string"/);
  assert.match(candidateInviteRoute, /typeof \w+\.inviteExpiresAt === "string"/);

  assert.match(interviewerJoinRoute, /Interviewer join response was malformed\./);
  assert.match(interviewerJoinRoute, /isInterviewerJoinResponse\(payload\)/);
  assert.match(interviewerJoinRoute, /not_started/);
  assert.match(interviewerJoinRoute, /has\(value\.aiInterviewerState\)/);
  for (const field of ["sessionId", "room", "liveKitUrl", "token", "aiInterviewerState"]) {
    assert.match(interviewerJoinRoute, new RegExp(`typeof \\w+\\.${field} === "string"`));
  }

  assert.match(aiControlRoute, /AI interviewer control response was malformed\./);
  assert.match(aiControlRoute, /isAiControlResponse\(payload\)/);
  for (const field of ["sessionId", "aiInterviewerState", "requestedAt"]) {
    assert.match(aiControlRoute, new RegExp(`typeof \\w+\\.${field} === "string"`));
  }
});

test("interviewer join page is a full-screen dashboard-gated room entry", async () => {
  const pageSource = await requiredSource("../app/dashboard/interviews/[sessionId]/join/page.tsx");

  assert.match(pageSource, /requireDashboardUser/);
  assert.match(pageSource, /InterviewerJoinClient/);
  assert.match(pageSource, /fixed inset-0/);
});

test("interviewer join client exposes host invite, join, and AI controls without candidate notices", async () => {
  const clientSource = await requiredSource(
    "../app/dashboard/interviews/[sessionId]/join/InterviewerJoinClient.tsx",
  );

  for (const expectedSource of [
    "candidate-invite",
    "Copy candidate link",
    "interviewer-join",
    "Start AI",
    "Stop AI",
    "Resume AI",
  ]) {
    assert.match(clientSource, new RegExp(expectedSource));
  }

  assert.doesNotMatch(clientSource, /AI interview disclosure/);
  assert.doesNotMatch(clientSource, /Accept all required interview notices/);
});
