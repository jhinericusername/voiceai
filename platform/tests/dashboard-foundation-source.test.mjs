import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

async function optionalSource(relativePath) {
  try {
    return await source(relativePath);
  } catch {
    return "";
  }
}

async function pathExists(relativePath) {
  try {
    await access(new URL(relativePath, import.meta.url));
    return true;
  } catch {
    return false;
  }
}

const layoutSource = await source("../app/dashboard/layout.tsx");
const chromeSource = await source("../app/dashboard/DashboardChrome.tsx");
const candidateSearchSource = await optionalSource("../app/dashboard/DashboardCandidateSearch.tsx");
const overviewSource = await source("../app/dashboard/page.tsx");
const rolesSource = await source("../app/dashboard/roles/page.tsx");
const activePipelineSource = await source("../app/dashboard/roles/ActivePipelineDashboard.tsx");
const roleDetailSource = await source("../app/dashboard/roles/[roleId]/page.tsx");
const roleTabsSource = await source("../app/dashboard/roles/[roleId]/RoleWorkspaceTabs.tsx");
const roleCandidateSource = await source("../app/dashboard/roles/[roleId]/candidates/[candidateId]/page.tsx");
const roleRubricSource = await source("../app/dashboard/roles/[roleId]/rubric/page.tsx");
const scoreTabSource = await source("../app/dashboard/roles/[roleId]/ScoreTab.tsx");
const candidatesSource = await source("../app/dashboard/candidates/page.tsx");
const reviewQueueSource = await source("../app/dashboard/review-queue/page.tsx");
const recordingsSource = await source("../app/dashboard/recordings/page.tsx");
const ashbyFirstSectionsSource = await source("../app/dashboard/AshbyFirstDashboardSections.tsx");
const interviewDetailSource = await source("../app/dashboard/interviews/[sessionId]/page.tsx");
const interviewPlaybackReviewSource = await source("../app/dashboard/interviews/[sessionId]/InterviewPlaybackReview.tsx");
const backendDataSource = await source("../app/dashboard/backend-data.ts");
const backendDashboardInterviewsSource = await source("../../backend/src/dashboard/interviews.ts");
const dashboardRoutesSource = await source("../../backend/src/dashboard/routes.ts");
const wizardSource = await source("../app/dashboard/AshbyOnboardingWizard.tsx");
const createInterviewLauncherSource = await source("../app/dashboard/DashboardCreateInterviewLauncher.tsx");
const globalsSource = await source("../app/globals.css");

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

  assert.match(chromeSource, /DashboardCandidateSearch/);
  assert.match(chromeSource, /Cmd\+K/);
  assert.match(chromeSource, /priority: "primary"/);
  assert.match(chromeSource, /priority: "secondary"/);
  assert.match(chromeSource, /Soon/);
  assert.match(chromeSource, /label: "Analytics"[\s\S]*priority: "secondary"/);
  assert.match(chromeSource, /label: "Settings"[\s\S]*priority: "secondary"/);
  assert.doesNotMatch(chromeSource, /CreateInterviewCard/);
  assert.doesNotMatch(chromeSource, /CreateTeamInvitationCard/);
  assert.doesNotMatch(chromeSource, /Active role/);
  assert.doesNotMatch(chromeSource, /roles:/);
  assert.doesNotMatch(chromeSource, /demoRoles/);
});

test("dashboard candidate search opens with Cmd+K and searches Ashby candidates", () => {
  assert.ok(candidateSearchSource, "DashboardCandidateSearch.tsx should exist");
  assert.match(candidateSearchSource, /"use client"/);
  assert.match(candidateSearchSource, /CandidateSearchResult/);
  assert.match(candidateSearchSource, /document\.addEventListener\("keydown"/);
  assert.match(candidateSearchSource, /metaKey \|\| event\.ctrlKey/);
  assert.match(candidateSearchSource, /\/api\/ashby\/applications\/search/);
  assert.match(candidateSearchSource, /jobId:\s*null/);
  assert.match(candidateSearchSource, /AbortController/);
  assert.match(candidateSearchSource, /setTimeout/);
  assert.match(candidateSearchSource, /href=\{candidateResultHref\(result\)\}/);
  assert.match(candidateSearchSource, /\/dashboard\/roles\/\$\{encodeURIComponent\(result\.jobId\)\}\/candidates\/\$\{encodeURIComponent\(candidateResultId\(result\)\)\}/);
  assert.match(candidateSearchSource, /role="dialog"/);
  assert.match(candidateSearchSource, /aria-modal="true"/);
});

test("dashboard app content region scrolls while chrome stays fixed", () => {
  assert.match(chromeSource, /<main className="[^"]*flex-1[^"]*overflow-y-auto[^"]*overflow-x-hidden/);
  assert.doesNotMatch(chromeSource, /<main className="[^"]*flex-1 overflow-hidden/);
});

test("create interview launcher keeps the topbar action label unclipped", () => {
  assert.match(createInterviewLauncherSource, /sm:min-w-max/);
  assert.match(createInterviewLauncherSource, /sm:shrink-0/);
  assert.match(createInterviewLauncherSource, /whitespace-nowrap/);
});

test("recordings page lists historical Fireflies and room recordings with links to detail", () => {
  assert.match(recordingsSource, /getRoomRecordings/);
  assert.match(recordingsSource, /Historical Fireflies/);
  assert.match(recordingsSource, /Fireflies recording/);
  assert.match(recordingsSource, /firefliesRecordingTitle/);
  assert.match(recordingsSource, /sourceMetadataString\(recording\.source_metadata,\s*\[\s*"fireflies",\s*"title"\s*\]\)/);
  assert.match(recordingsSource, /isSyntheticFirefliesRoomName/);
  assert.match(recordingsSource, /recordings\.map/);
  assert.match(recordingsSource, /href=\{`\/dashboard\/interviews\/\$\{encodeURIComponent\(recording\.session_id\)\}`\}/);
  assert.match(recordingsSource, /recording\.composite_video_status/);
  assert.match(recordingsSource, /recording\.external_source === "fireflies"/);
  assert.match(recordingsSource, /data-recordings-scroll-region/);
  assert.match(recordingsSource, /overflow-y-auto/);
  assert.doesNotMatch(recordingsSource, /OperationalPlaceholderPage/);
});

test("recordings page uses Fireflies meeting titles as the primary row label", () => {
  assert.match(recordingsSource, /recordingPrimaryLabel\(recording\)/);
  assert.match(recordingsSource, /recordingSecondaryLabel\(recording\)/);
  assert.match(
    recordingsSource,
    /function recordingPrimaryLabel\([^)]*recording[^)]*\)[^{]*{\s*return isHistoricalFirefliesRecording\(recording\)\s*\?\s*roomLabel\(recording\)\s*:\s*candidateLabel\(recording\);/s,
  );
  assert.match(
    recordingsSource,
    /function recordingSecondaryLabel\([^)]*recording[^)]*\)[^{]*{\s*const candidate = candidateLabel\(recording\);/s,
  );
});

test("recordings page surfaces native Puddle session records even before full finalization", () => {
  assert.match(recordingsSource, /getRealInterviews/);
  assert.match(recordingsSource, /Puddle platform sessions/);
  assert.match(recordingsSource, /nativeSessionRows/);
  assert.match(recordingsSource, /nativeRecordedSessionRows/);
  assert.match(recordingsSource, /hasNativeRecordingSignal/);
  assert.match(recordingsSource, /\.\.\.nativeRecordedSessionRows,\s*\.\.\.nativePendingSessionRows/s);
  assert.match(recordingsSource, /Math\.max\(recordings\.length,\s*nativeRecordedSessionRows\.length\)/);
  assert.match(recordingsSource, /recordingBySessionId/);
  assert.match(recordingsSource, /composite_video_status/);
  assert.match(recordingsSource, /sessionVideoStatus\(session,\s*recording\)/);
  assert.match(recordingsSource, /href=\{`\/dashboard\/interviews\/\$\{encodeURIComponent\(session\.session_id\)\}`\}/);
});

test("recordings data tolerates older connected-dev backends without room-recordings", () => {
  assert.match(backendDataSource, /response\.status === 404/);
  assert.match(backendDataSource, /return \[\];/);
  assert.match(backendDataSource, /backend returned \$\{response\.status\}/);
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

test("legacy dashboard demo data files are removed", async () => {
  assert.equal(await pathExists("../app/dashboard/demo-data.ts"), false);
  assert.equal(await pathExists("../app/dashboard/DashboardSections.tsx"), false);
  assert.equal(await pathExists("../app/dashboard/CreateInterviewCard.tsx"), false);
  assert.equal(await pathExists("../app/dashboard/CreateTeamInvitationCard.tsx"), false);
  assert.doesNotMatch(backendDataSource, /dashboardDemoFallbackEnabled/);
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
  assert.doesNotMatch(roleDetailSource, /CreateAndJoinInterviewForm/);
  assert.match(chromeSource, /DashboardCreateInterviewLauncher/);
  assert.match(roleCandidateSource, /generateStaticParams\(\)\s*\{\s*return\s+\[\]/);
  assert.match(roleRubricSource, /generateStaticParams\(\)\s*\{\s*return\s+\[\]/);
});

test("roles, candidates, and review queue are explicit about role-scoped interviewing", () => {
  assert.match(rolesSource, /getAshbyActivePipeline/);
  assert.match(rolesSource, /ActivePipelineDashboard/);
  assert.match(rolesSource, /canManageAshbyOnboarding\(session\)/);
  assert.match(rolesSource, /canManagePipelineStages/);
  assert.match(candidatesSource, /getAshbyActivePipeline/);
  assert.match(candidatesSource, /ActivePipelineDashboard/);
  assert.match(candidatesSource, /canManageAshbyOnboarding\(session\)/);
  assert.match(candidatesSource, /canManagePipelineStages/);
  assert.match(activePipelineSource, /selectedRole\.stageOptions\.map/);
  assert.match(activePipelineSource, /readonly canManagePipelineStages: boolean/);
  assert.match(activePipelineSource, /if \(!canManagePipelineStages\)/);
  assert.match(activePipelineSource, /disabled=\{!canManagePipelineStages \|\| pendingStageKey !== null\}/);
  assert.match(activePipelineSource, /candidateRowsTruncated/);
  assert.match(activePipelineSource, /DashboardCreateInterviewLauncher/);
  assert.match(activePipelineSource, /Stage filters are read-only for members\./);
  assert.match(activePipelineSource, /data-active-candidate-scroll-region/);
  assert.match(activePipelineSource, /overflow-y-auto/);
  assert.match(activePipelineSource, /<section className="min-h-0 min-w-0 overflow-hidden/);
  assert.match(activePipelineSource, /"min-h-16 w-full min-w-0 overflow-hidden rounded-md/);
  assert.match(reviewQueueSource, /getAshbyActivePipeline/);
  assert.match(reviewQueueSource, /getRealInterviews/);
  assert.match(reviewQueueSource, /ReviewRolePickerFoundation/);
  assert.match(reviewQueueSource, /roles=\{ashbyJobReferences\(pipeline\.roles\)\}/);
  assert.match(reviewQueueSource, /needsHumanReview/);
  assert.match(reviewQueueSource, /needs_human_review/);
  assert.match(reviewQueueSource, /has_recommendation_packet/);
  assert.match(reviewQueueSource, /Review score/);
  assert.match(reviewQueueSource, /href=\{`\/dashboard\/interviews\/\$\{encodeURIComponent\(session\.session_id\)\}`\}/);
  assert.match(ashbyFirstSectionsSource, /role picker/i);
  assert.match(ashbyFirstSectionsSource, /<select/);
  assert.match(ashbyFirstSectionsSource, /roles\.map/);
  assert.match(ashbyFirstSectionsSource, /role\.name/);
  assert.doesNotMatch(ashbyFirstSectionsSource, /Role picker appears after role names sync/);
  assert.doesNotMatch(ashbyFirstSectionsSource, /Selected role \$\{index \+ 1\}/);
});

test("role-scoped dashboard pages use real Ashby role names instead of ordinal placeholders", () => {
  for (const [name, pageSource] of [
    ["role detail", roleDetailSource],
    ["candidate detail", roleCandidateSource],
    ["rubric detail", roleRubricSource],
  ]) {
    assert.match(pageSource, /getAshbyActivePipeline/, `${name} should load active pipeline role names`);
    assert.match(pageSource, /selectedRole\.name/, `${name} should render the selected role name`);
    assert.doesNotMatch(pageSource, /Selected role \$\{selectedIndex \+ 1\}/, `${name} should not render ordinal role labels`);
    assert.doesNotMatch(pageSource, /state\.selectedJobIds/, `${name} should not rely on ID-only company state`);
  }

  assert.match(roleTabsSource, /readonly selectedRole: AshbyJobReference/);
  assert.match(roleTabsSource, /selectedRole\.name/);
  assert.match(scoreTabSource, /availableJobs/);
  assert.match(scoreTabSource, /ashbyJob\.name/);
  assert.doesNotMatch(scoreTabSource, /Ashby job \$\{index \+ 1\}/);
});

test("candidate detail page renders the synced Ashby application record", () => {
  assert.match(roleCandidateSource, /const \{ roleId, candidateId \} = await params/);
  assert.match(roleCandidateSource, /selectedRole\.candidates\.find/);
  assert.match(roleCandidateSource, /candidateMatchesRoute/);
  assert.match(roleCandidateSource, /selectedCandidate\.candidateName/);
  assert.match(roleCandidateSource, /selectedCandidate\.candidateEmail/);
  assert.match(roleCandidateSource, /selectedCandidate\.currentStage/);
  assert.match(roleCandidateSource, /selectedCandidate\.applicationId/);
  assert.match(roleCandidateSource, /selectedCandidate\.source/);
  assert.match(roleCandidateSource, /selectedCandidate\.updatedAt/);
  assert.match(roleCandidateSource, /interviewContext=\{\{/);
  assert.doesNotMatch(roleCandidateSource, /No synced application record yet/);
  assert.doesNotMatch(roleCandidateSource, /will populate from the selected role's real Ashby applications/);
});

test("review queue prefers explicit backend review flags over score-shape inference", () => {
  assert.match(backendDataSource, /readonly has_recommendation_packet: boolean/);
  assert.match(backendDataSource, /readonly needs_human_review: boolean/);
  assert.match(reviewQueueSource, /session\.needs_human_review === true/);
  assert.match(reviewQueueSource, /hasRecommendationPacket/);
  assert.match(backendDashboardInterviewsSource, /has_recommendation_packet/);
  assert.match(backendDashboardInterviewsSource, /needs_human_review/);
});

test("interview detail is Fireflies-like, real-only, and hides raw internal identifiers", () => {
  assert.match(interviewDetailSource, /getRealInterview/);
  assert.match(interviewDetailSource, /candidateAudioUrl/);
  assert.match(interviewDetailSource, /InterviewPlaybackReview/);
  assert.match(interviewPlaybackReviewSource, /<audio/);
  assert.match(interviewPlaybackReviewSource, /aria-label="Transcript"/);
  assert.match(interviewPlaybackReviewSource, /xl:grid-cols-\[minmax\(0,1fr\)_minmax\(360px,420px\)\]/);
  assert.match(interviewDetailSource, /Historical Fireflies import/);
  assert.match(interviewDetailSource, /Fireflies historical import/);
  assert.match(backendDataSource, /recommendation_packet/);
  assert.match(backendDataSource, /scorecardJson/);
  assert.match(interviewDetailSource, /AI recommendation/);
  assert.match(interviewDetailSource, /formatRecommendationPacketStatus/);
  assert.match(interviewDetailSource, /formatRecommendationPacketConfidence/);
  assert.match(interviewDetailSource, /scorecardRowsFromRecommendationPacket/);
  assert.match(interviewDetailSource, /ScorecardDimensionRow/);
  assert.match(interviewDetailSource, /recommendation_packet\?\.categoryScores/);
  assert.match(interviewDetailSource, /recommendation_packet\?\.scorecardJson/);
  assert.match(interviewDetailSource, /Missing questions/);
  assert.match(interviewDetailSource, /Scripted answer detection/);
  assert.match(interviewDetailSource, /Final scores/);
  assert.match(interviewDetailSource, /Overall comment/);
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

test("interview transcript timestamps seek media playback", () => {
  assert.match(interviewPlaybackReviewSource, /"use client"/);
  assert.match(interviewPlaybackReviewSource, /useRef<HTMLVideoElement/);
  assert.match(interviewPlaybackReviewSource, /useRef<HTMLAudioElement/);
  assert.match(interviewPlaybackReviewSource, /playbackOffsetSeconds/);
  assert.match(interviewPlaybackReviewSource, /turn\.offsetMs/);
  assert.match(interviewPlaybackReviewSource, /Date\.parse\(turn\.occurredAt\)/);
  assert.match(interviewPlaybackReviewSource, /currentTime\s*=/);
  assert.match(interviewPlaybackReviewSource, /\.play\(\)/);
  assert.match(interviewPlaybackReviewSource, /aria-label=\{`Jump playback to/);
});

test("dashboard backend signs audio fallback media for audio-only interviews", () => {
  assert.match(dashboardRoutesSource, /signedArtifactMediaUrl/);
  assert.match(dashboardRoutesSource, /candidate_audio/);
  assert.match(dashboardRoutesSource, /candidateAudioUrl/);
  assert.match(backendDataSource, /candidateAudioUrl: string \| null/);
});

test("visible dashboard controls use readable labels instead of raw Ashby identifiers", () => {
  assert.doesNotMatch(scoreTabSource, /Job \$\{index \+ 1\}: \$\{ashbyJobId\}/);
  assert.match(scoreTabSource, /ashbyJob\.name/);
  assert.doesNotMatch(scoreTabSource, /Ashby job \${index \+ 1}/);
});

test("passive dashboard cards do not use generic hover lift effects", () => {
  assert.doesNotMatch(globalsSource, /\.puddle-panel:hover,\s*\.puddle-dashboard-card:hover,\s*\.puddle-metric-card:hover/s);
  assert.doesNotMatch(globalsSource, /\.puddle-empty-state:hover/);
  assert.doesNotMatch(globalsSource, /\.puddle-dashboard-hero-card:hover/);
  assert.match(globalsSource, /\.puddle-interactive-card:hover/);
  assert.match(globalsSource, /\.puddle-search-affordance:hover/);
});

test("Ashby onboarding setup is friendly without exposing unreadable job identifiers", () => {
  assert.match(wizardSource, /puddle-mascot/);
  assert.doesNotMatch(wizardSource, /\$\{job\.status\} - \$\{job\.id\}/);
});
