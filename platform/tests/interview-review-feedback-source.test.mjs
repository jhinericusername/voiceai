import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const interviewDetailSource = await readFile(
  new URL("../app/dashboard/interviews/[sessionId]/page.tsx", import.meta.url),
  "utf8",
);
const reviewEditorSource = await readFile(
  new URL("../app/dashboard/interviews/[sessionId]/HumanScoreReviewEditor.tsx", import.meta.url),
  "utf8",
);
const reviewModelSource = await readFile(
  new URL("../app/dashboard/interviews/[sessionId]/review-score-model.ts", import.meta.url),
  "utf8",
);
const feedbackRouteSource = await readFile(
  new URL("../app/api/grading/recommendations/[recommendationId]/feedback/route.ts", import.meta.url),
  "utf8",
);

test("interview detail keeps the generated scorecard separate from human review corrections", () => {
  assert.match(interviewDetailSource, /title="AI recommendation"/);
  assert.match(interviewDetailSource, /eyebrow="Generated scorecard"/);
  assert.match(interviewDetailSource, /title="Human review corrections"/);
  assert.match(interviewDetailSource, /eyebrow="Reviewer feedback"/);
  assert.match(reviewEditorSource, /Human review is stored separately from the generated scorecard/);
});

test("human review editor posts reviewer feedback to the grading recommendation proxy", () => {
  assert.match(reviewEditorSource, /\/api\/grading\/recommendations\/\$\{encodeURIComponent\(recommendationId\)\}\/feedback/);
  assert.match(reviewEditorSource, /method:\s*"POST"/);
  assert.match(reviewEditorSource, /sessionId/);
  assert.match(reviewEditorSource, /organizationId/);
  assert.match(reviewEditorSource, /reviewerEmail/);
  assert.match(reviewEditorSource, /reviewerDecision/);
  assert.match(reviewEditorSource, /overrideReason/);
  assert.match(reviewEditorSource, /dimensionFeedback/);
  assert.match(reviewEditorSource, /correctedScore:\s*draft\.problemSolving\.score/);
  assert.doesNotMatch(reviewEditorSource, /finalTotal:\s*total/);
  assert.doesNotMatch(reviewEditorSource, /maxTotal:\s*maxReviewTotal/);
  assert.match(reviewEditorSource, /router\.refresh\(\)/);
});

test("review feedback proxy authenticates dashboard users and overwrites scoped identity", () => {
  assert.match(feedbackRouteSource, /requireAshbyReadyDashboardApiAccess/);
  assert.match(feedbackRouteSource, /backendHeaders\(\)/);
  assert.match(feedbackRouteSource, /organizationId:\s*access\.organizationId/);
  assert.match(feedbackRouteSource, /reviewerEmail:\s*stringValue\(access\.user\.email\)/);
  assert.match(feedbackRouteSource, /sessionId/);
  assert.match(feedbackRouteSource, /reviewerDecision/);
  assert.match(feedbackRouteSource, /dimensionFeedback:\s*objectBody\(body\.dimensionFeedback\)/);
});


test("human review editor supports the required dimensions, decisions, and half-step scale", () => {
  assert.match(reviewModelSource, /problemSolving/);
  assert.match(reviewModelSource, /agency/);
  assert.match(reviewModelSource, /competitiveness/);
  assert.match(reviewModelSource, /curious/);
  assert.match(reviewModelSource, /Problem Solving/);
  assert.match(reviewModelSource, /Curious/);
  assert.match(reviewModelSource, /\[1,\s*1\.5,\s*2,\s*2\.5,\s*3,\s*3\.5,\s*4\]/);
  assert.match(reviewEditorSource, /advance/);
  assert.match(reviewEditorSource, /hold/);
  assert.match(reviewEditorSource, /pass/);
  assert.match(reviewEditorSource, /needs_more_review/);
});

test("interview detail preloads saved reviewer feedback before generated score data", () => {
  assert.match(interviewDetailSource, /latestReviewerFeedbackFromInterview/);
  assert.match(interviewDetailSource, /latestFeedback/);
  assert.match(interviewDetailSource, /latest_reviewer_feedback/);
  assert.match(interviewDetailSource, /dimension_feedback/);
  assert.match(interviewDetailSource, /correctedScore/);
  assert.match(interviewDetailSource, /corrected_score/);
  assert.match(interviewDetailSource, /savedDimensions\.get\(definition\.key\)/);
  assert.match(interviewDetailSource, /savedDimension\?\.score \?\? aiDimension\.score/);
  assert.match(interviewDetailSource, /scorecardJson/);
  assert.match(interviewDetailSource, /categoryScores/);
});
