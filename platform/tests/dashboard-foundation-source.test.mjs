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
const rubricsSource = await optionalSource("../app/dashboard/rubrics/page.tsx");
const rubricRoleSource = await optionalSource("../app/dashboard/rubrics/[roleId]/page.tsx");
const activePipelineSource = await source("../app/dashboard/roles/ActivePipelineDashboard.tsx");
const roleDetailSource = await source("../app/dashboard/roles/[roleId]/page.tsx");
const roleTabsSource = await source("../app/dashboard/roles/[roleId]/RoleWorkspaceTabs.tsx");
const roleCandidateSource = await source("../app/dashboard/roles/[roleId]/candidates/[candidateId]/page.tsx");
const roleRubricSource = await source("../app/dashboard/roles/[roleId]/rubric/page.tsx");
const scoreTabSource = await source("../app/dashboard/roles/[roleId]/ScoreTab.tsx");
const candidatesSource = await source("../app/dashboard/candidates/page.tsx");
const reviewQueueSource = await source("../app/dashboard/review-queue/page.tsx");
const recordingsSource = await source("../app/dashboard/recordings/page.tsx");
const recordingsListSource = await optionalSource("../app/dashboard/recordings/RecordingsList.tsx");
const recordingsApiSource = await optionalSource("../app/api/dashboard/recordings/route.ts");
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
  for (const label of ["Pipeline", "Rubrics", "Review Queue", "Recordings", "Analytics", "Settings"]) {
    assert.match(chromeSource, new RegExp(label));
  }

  assert.match(chromeSource, /href: "\/dashboard\/roles", label: "Pipeline"/);
  assert.match(chromeSource, /href: "\/dashboard\/rubrics", label: "Rubrics"/);
  assert.match(chromeSource, /match: "rubrics"/);
  assert.match(chromeSource, /pathname\.startsWith\(`\/dashboard\/\$\{match\}`\)/);
  assert.doesNotMatch(chromeSource, /label: "Roles"/);
  assert.doesNotMatch(chromeSource, /label: "Candidates"/);
  assert.match(chromeSource, /DashboardCandidateSearch/);
  assert.match(chromeSource, /Cmd\+K/);
  assert.match(chromeSource, /priority: "primary"/);
  assert.match(chromeSource, /priority: "secondary"/);
  assert.match(chromeSource, /Soon/);
  assert.match(chromeSource, /label: "Analytics"[\s\S]*priority: "secondary"/);
  assert.match(chromeSource, /label: "Settings"[\s\S]*priority: "secondary"/);
  assert.doesNotMatch(chromeSource, /label: "Rubrics"[\s\S]{0,120}status: "Soon"/);
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

test("active pipeline candidate rows link to candidate detail pages", () => {
  assert.match(activePipelineSource, /import Link from "next\/link"/);
  assert.match(activePipelineSource, /function candidateHref\(candidate: ActivePipelineCandidate\): string/);
  assert.match(activePipelineSource, /\/dashboard\/roles\/\$\{encodeURIComponent\(candidate\.jobId\)\}\/candidates\/\$\{encodeURIComponent\(candidateRouteId\(candidate\)\)\}/);
  assert.match(activePipelineSource, /href=\{candidateHref\(candidate\)\}/);
  assert.match(activePipelineSource, /prefetch=\{false\}/);
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
  assert.match(recordingsListSource, /Historical Fireflies/);
  assert.match(recordingsListSource, /Fireflies recording/);
  assert.match(recordingsListSource, /firefliesRecordingTitle/);
  assert.match(recordingsListSource, /firefliesMetadataTitle\(recording\.source_metadata\)/);
  assert.match(recordingsListSource, /isSyntheticFirefliesRoomName/);
  assert.match(recordingsListSource, /recordings\.map/);
  assert.match(recordingsListSource, /href=\{`\/dashboard\/interviews\/\$\{encodeURIComponent\(recording\.session_id\)\}`\}/);
  assert.match(recordingsListSource, /recording\.composite_video_status/);
  assert.match(recordingsListSource, /recording\.external_source === "fireflies"/);
  assert.match(recordingsListSource, /data-recordings-scroll-region/);
  assert.match(recordingsListSource, /overflow-y-auto/);
  assert.doesNotMatch(recordingsSource, /OperationalPlaceholderPage/);
});

test("recordings page uses Fireflies meeting titles as the primary row label", () => {
  assert.match(recordingsListSource, /recordingPrimaryLabel\(recording\)/);
  assert.match(recordingsListSource, /recordingSecondaryLabel\(recording\)/);
  assert.match(recordingsListSource, /firefliesMetadataTitle\(recording\.source_metadata\)/);
  assert.match(recordingsListSource, /sourceMetadataDisplayTitle\(value,\s*\[\s*"fireflies",\s*"title"\s*\]\)/);
  assert.match(recordingsListSource, /sourceMetadataDisplayTitle\(value,\s*\[\s*"fireflies",\s*"eventTitle"\s*\]\)/);
  assert.match(recordingsListSource, /sourceMetadataDisplayTitle\(value,\s*\[\s*"fireflies",\s*"meetingTitle"\s*\]\)/);
  assert.match(recordingsListSource, /sourceMetadataEventTitle\(value,\s*\[\s*"fireflies",\s*"event"\s*\]\)/);
  assert.match(recordingsListSource, /sourceMetadataDisplayTitle\(value,\s*\[\s*"metadata",\s*"eventTitle"\s*\]\)/);
  assert.match(recordingsListSource, /sourceMetadataEventTitle\(value,\s*\[\s*"metadata",\s*"event"\s*\]\)/);
  assert.match(recordingsListSource, /sourceMetadataDisplayTitle\(value,\s*\[\s*"transcript",\s*"title"\s*\]\)/);
  assert.match(recordingsListSource, /sourceMetadataDisplayTitle\(value,\s*\[\s*"title"\s*\]\)/);
  assert.match(recordingsListSource, /function sourceMetadataDisplayTitle/);
  assert.match(recordingsListSource, /function sourceMetadataEventTitle/);
  assert.match(
    recordingsListSource,
    /function recordingPrimaryLabel\([^)]*recording[^)]*\)[^{]*{\s*return isHistoricalFirefliesRecording\(recording\)\s*\?\s*roomLabel\(recording\)\s*:\s*candidateLabel\(recording\);/s,
  );
  assert.match(
    recordingsListSource,
    /function recordingSecondaryLabel\([^)]*recording[^)]*\)[^{]*{\s*const candidate = candidateLabel\(recording\);/s,
  );
});

test("recordings page uses persisted Fireflies start metadata before date-only fallbacks", () => {
  assert.match(recordingsListSource, /formatRecordingStartedAt\(recording\)/);
  assert.match(recordingsListSource, /function formatRecordingStartedAt\(recording: RealRoomRecordingListItem\): string/);
  assert.match(recordingsListSource, /function recordingStartedAt\(recording: RealRoomRecordingListItem\): string \| null/);
  assert.match(recordingsListSource, /sourceMetadataString\(recording\.source_metadata,\s*\[\s*"fireflies",\s*"meetingStartedAt"\s*\]\)/);
  assert.match(recordingsListSource, /sourceMetadataString\(recording\.source_metadata,\s*\[\s*"fireflies",\s*"meeting_start"\s*\]\)/);
  assert.match(recordingsListSource, /sourceMetadataString\(recording\.source_metadata,\s*\[\s*"fireflies",\s*"startTime"\s*\]\)/);
  assert.match(recordingsListSource, /sourceMetadataString\(recording\.source_metadata,\s*\[\s*"meetingStartedAt"\s*\]\)/);
  assert.match(recordingsListSource, /sourceMetadataString\(recording\.source_metadata,\s*\[\s*"metadata",\s*"meetingStartedAt"\s*\]\)/);
  assert.match(recordingsListSource, /sourceMetadataString\(recording\.source_metadata,\s*\[\s*"transcript",\s*"date"\s*\]\)/);
  assert.match(recordingsListSource, /sourceMetadataString\(recording\.source_metadata,\s*\[\s*"transcript",\s*"meetingStartTime"\s*\]\)/);
  assert.match(recordingsListSource, /recording\.recording_started_at\s*\?\?\s*recording\.started_at\s*\?\?\s*recording\.scheduled_at/);
  assert.doesNotMatch(recordingsListSource, /formatNullableDate\(recording\.started_at \?\? recording\.recording_started_at\)/);
});

test("recordings page does not show fake local times for Fireflies date-only metadata", () => {
  assert.match(recordingsListSource, /function dateOnlyFirefliesStartedAt\(recording: RealRoomRecordingListItem, startedAt: string\): string/);
  assert.match(recordingsListSource, /sourceMetadataString\(recording\.source_metadata,\s*\[\s*"fireflies",\s*"dateOnlyStartedAt",?\s*\]\)/);
  assert.match(recordingsListSource, /sourceMetadataString\(recording\.source_metadata,\s*\[\s*"fireflies",\s*"meetingDate"\s*\]\)/);
  assert.match(recordingsListSource, /function formatDateOnlyLabel\(value: string\): string/);
  assert.match(recordingsListSource, /timeZone: "UTC"/);
  assert.match(recordingsListSource, /const exactStartedAt = exactFirefliesMetadataStartedAt\(recording\)/);
  assert.match(recordingsListSource, /dateOnlyStartedAt \? formatDateOnlyLabel\(dateOnlyStartedAt\) : formatDateTime\(startedAt\)/);
});

test("recordings page fetches the first page and scroll-loads more rows", () => {
  assert.match(recordingsSource, /RECORDINGS_PAGE_SIZE/);
  assert.match(recordingsSource, /getRoomRecordingsPage\(\{\s*orgId,\s*limit: RECORDINGS_PAGE_SIZE,\s*offset: 0\s*\}\)/s);
  assert.match(recordingsSource, /<RecordingsList/);
  assert.match(recordingsSource, /initialRecordings=\{recordings\}/);
  assert.match(recordingsSource, /initialHasMore=\{recordingPage\.hasMore\}/);
  assert.ok(recordingsListSource, "RecordingsList.tsx should exist");
  assert.match(recordingsListSource, /"use client"/);
  assert.match(recordingsListSource, /IntersectionObserver/);
  assert.match(recordingsListSource, /\/api\/dashboard\/recordings\?limit=\$\{RECORDINGS_PAGE_SIZE\}&offset=\$\{nextOffset\}/);
  assert.match(recordingsListSource, /setRecordings\(\(currentRecordings\) =>/);
});

test("recordings pagination is enforced by the platform and backend", () => {
  assert.ok(recordingsApiSource, "recordings API route should exist");
  assert.match(recordingsApiSource, /requireAshbyReadyDashboardApiAccess/);
  assert.match(recordingsApiSource, /getRoomRecordingsPage\(\{\s*orgId: access\.identity\.organizationId,\s*limit,\s*offset,\s*\}\)/s);
  assert.match(backendDataSource, /limit: number/);
  assert.match(backendDataSource, /offset: number/);
  assert.match(backendDataSource, /params\.set\("limit", String\(input\.limit\)\)/);
  assert.match(backendDataSource, /params\.set\("offset", String\(input\.offset\)\)/);
  assert.match(dashboardRoutesSource, /limitFromQuery\(request\.query\)/);
  assert.match(dashboardRoutesSource, /offsetFromQuery\(request\.query\)/);
  assert.match(dashboardRoutesSource, /roomRecordingListStatement\(\{\s*limit,\s*offset,\s*orgId\s*\}\)/s);
  assert.match(backendDashboardInterviewsSource, /OFFSET \$3/);
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

test("recordings page keeps native Puddle sessions collapsed above completed interviews", () => {
  assert.match(recordingsSource, /<details[\s\S]*data-native-interviews-collapsible/);
  assert.match(recordingsSource, /<summary[\s\S]*data-native-interviews-summary/);
  assert.match(recordingsSource, /Show native interviews/);
  assert.match(recordingsSource, /SectionPanel title="Recordings" eyebrow="Completed interviews"/);
  assert.ok(
    recordingsSource.indexOf("data-native-interviews-collapsible") <
      recordingsSource.indexOf('SectionPanel title="Recordings" eyebrow="Completed interviews"'),
  );
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

test("legacy candidates dashboard route redirects to the unified pipeline", () => {
  assert.match(candidatesSource, /from "next\/navigation"/);
  assert.match(candidatesSource, /redirect\("\/dashboard\/roles"\)/);
  assert.doesNotMatch(candidatesSource, /getAshbyActivePipeline/);
  assert.doesNotMatch(candidatesSource, /ActivePipelineDashboard/);
});

test("top-level operational pages do not import demo dashboard data", () => {
  for (const [name, pageSource] of [
    ["roles", rolesSource],
    ["rubrics", rubricsSource],
    ["role rubric editor", rubricRoleSource],
    ["candidates", candidatesSource],
    ["review queue", reviewQueueSource],
  ]) {
    assert.ok(pageSource, `${name} page should exist`);
    assert.doesNotMatch(pageSource, /demo-data/, `${name} page should not import demo-data`);
    assert.doesNotMatch(
      pageSource,
      /from\s+["']\.\.\/DashboardSections["']/,
      `${name} page should not import demo dashboard sections`,
    );
    assert.doesNotMatch(pageSource, /dashboardDemoFallbackEnabled/, `${name} page should not enable demo fallback`);
  }
});

test("rubrics dashboard lists every Ashby role as cards and links to role rubric editors", () => {
  assert.ok(rubricsSource, "rubrics index page should exist");
  assert.match(rubricsSource, /requireDashboardUser\("\/dashboard\/rubrics"\)/);
  assert.match(rubricsSource, /getAshbyJobs/);
  assert.match(rubricsSource, /getGradingCompanyState/);
  assert.match(rubricsSource, /jobs\.map/);
  assert.match(rubricsSource, /href=\{`\/dashboard\/rubrics\/\$\{encodeURIComponent\(role\.id\)\}`\}/);
  assert.match(rubricsSource, /Role rubrics/);
  assert.match(rubricsSource, /Choose dimensions/);
  assert.match(rubricsSource, /Ashby roles/);
  assert.match(rubricsSource, /active_rubric_version_id/);
  assert.match(rubricsSource, /draft_rubric_version_id/);
  assert.doesNotMatch(rubricsSource, /getAshbyActivePipeline/);
  assert.doesNotMatch(rubricsSource, /pipeline\.roles/);
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
  assert.match(activePipelineSource, /role\.stageOptions\.map/);
  assert.match(activePipelineSource, /readonly canManagePipelineStages: boolean/);
  assert.match(activePipelineSource, /data-role-phase-counts/);
  assert.match(activePipelineSource, /data-role-stage-button/);
  assert.match(activePipelineSource, /toggleStage\(role\.jobId, stage\.name\)/);
  assert.match(activePipelineSource, /candidateRowsTruncated/);
  assert.match(chromeSource, /DashboardCreateInterviewLauncher/);
  assert.doesNotMatch(activePipelineSource, /Stage filters are read-only for members\./);
  assert.doesNotMatch(activePipelineSource, /data-active-candidate-scroll-region/);
  assert.doesNotMatch(activePipelineSource, /disabled=\{!canManagePipelineStages/);
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

test("pipeline dashboard uses Ashby-style role phase rows with expandable candidate strips", () => {
  assert.match(activePipelineSource, /data-role-phase-counts/);
  assert.match(activePipelineSource, /Role Phase Counts/);
  assert.match(activePipelineSource, /data-role-pipeline-row/);
  assert.match(activePipelineSource, /data-role-stage-tile-list/);
  assert.match(activePipelineSource, /data-role-stage-button/);
  assert.match(activePipelineSource, /aria-expanded=\{selected\}/);
  assert.match(activePipelineSource, /data-stage-candidate-strip/);
  assert.match(activePipelineSource, /data-candidate-mini-card/);
  assert.match(activePipelineSource, /candidate\.linkedInUrl/);
  assert.match(activePipelineSource, /candidate\.ashbyUrl/);
  assert.match(activePipelineSource, /candidate\.resumeUrl/);
  assert.match(activePipelineSource, /target="_blank"/);
  assert.match(activePipelineSource, /rel="noreferrer"/);
  assert.doesNotMatch(activePipelineSource, /data-role-stage-filter-list/);
  assert.doesNotMatch(activePipelineSource, /type="checkbox"/);
  assert.doesNotMatch(activePipelineSource, /StatusPill status=\{candidate\.currentStage\}/);
  assert.doesNotMatch(activePipelineSource, /mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3/);
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
  assert.match(roleDetailSource, /getGradingCompanyState/);
  assert.match(roleDetailSource, /selectedGradingProfile/);
  assert.match(roleTabsSource, /RoleRubricEditor/);
  assert.match(roleTabsSource, /gradingProfile/);
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
  assert.match(interviewDetailSource, /<Link href="\/dashboard\/roles"[\s\S]*Pipeline[\s\S]*<\/Link>/);
  assert.doesNotMatch(interviewDetailSource, />\s*Roles\s*<\/Link>/);
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
  assert.match(interviewPlaybackReviewSource, /<span className="sr-only">Jump playback to <\/span>/);
});

test("interview transcript seek target covers the full turn", () => {
  assert.match(interviewPlaybackReviewSource, /<button[\s\S]*className=\{transcriptTurnClassName\}[\s\S]*onClick=\{\(\) => seekToTurn\(turn\)\}[\s\S]*\{transcriptTurnContent\}[\s\S]*<\/button>/);
  assert.match(interviewPlaybackReviewSource, /w-full text-left/);
  assert.doesNotMatch(interviewPlaybackReviewSource, /<button[\s\S]{0,500}\{timestampLabel\}\s*<\/button>/);
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
