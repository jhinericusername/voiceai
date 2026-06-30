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
const dashboardChrome = await source("../app/dashboard/DashboardChrome.tsx");
const liveKitParticipantTilesSource = await source("../lib/livekit-participant-tiles.ts");

const interviewerConnectedRoutePath = "../app/api/dashboard/interviews/[sessionId]/interviewer-connected/route.ts";
const dashboardCreateInterviewLauncherPath = "../app/dashboard/DashboardCreateInterviewLauncher.tsx";

test("create interview API returns an interviewer join URL for host launch", () => {
  assert.match(createInterviewRoute, /interviewerJoinUrl/);
  assert.match(createInterviewRoute, /sourceMetadata/);
  assert.match(createInterviewRoute, /ashby/);
  assert.match(createInterviewRoute, /selected/);
  assert.match(createInterviewRoute, /applicationId/);
  assert.match(createInterviewRoute, /jobId/);
  assert.match(
    createInterviewRoute,
    /\/dashboard\/interviews\/\$\{encodeURIComponent\(createdSession\.sessionId\)\}\/join/,
  );
});

test("interviewer platform routes require completed dashboard access", async () => {
  const interviewerConnectedRoute = await requiredSource(interviewerConnectedRoutePath);

  for (const routeSource of [candidateInviteRoute, interviewerJoinRoute, interviewerConnectedRoute, aiControlRoute]) {
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

test("interviewer join, connected acknowledgement, and AI control routes call the role-specific backend surfaces", async () => {
  const interviewerConnectedRoute = await requiredSource(interviewerConnectedRoutePath);

  assert.match(interviewerJoinRoute, /interviewer\/join/);
  assert.match(interviewerConnectedRoute, /interviewer\/connected/);
  assert.match(aiControlRoute, /ai-control/);
  assert.match(aiControlRoute, /action/);
});

test("interviewer platform routes fail closed on malformed backend success payloads", async () => {
  const interviewerConnectedRoute = await requiredSource(interviewerConnectedRoutePath);

  assert.match(candidateInviteRoute, /Candidate invite response was malformed\./);
  assert.match(candidateInviteRoute, /isCandidateInviteResponse\(payload\)/);
  assert.match(candidateInviteRoute, /typeof \w+\.invitePath === "string"/);
  assert.match(candidateInviteRoute, /typeof \w+\.inviteExpiresAt === "string"/);

  assert.match(interviewerJoinRoute, /Interviewer join response was malformed\./);
  assert.match(interviewerJoinRoute, /isInterviewerJoinResponse\(payload\)/);
  assert.match(interviewerJoinRoute, /not_started/);
  assert.match(interviewerJoinRoute, /running/);
  assert.match(interviewerJoinRoute, /stopped/);
  assert.match(interviewerJoinRoute, /ended/);
  assert.match(interviewerJoinRoute, /has\(value\.aiInterviewerState\)/);
  for (const field of ["sessionId", "room", "liveKitUrl", "token", "aiInterviewerState"]) {
    assert.match(interviewerJoinRoute, new RegExp(`typeof \\w+\\.${field} === "string"`));
  }

  assert.match(interviewerConnectedRoute, /Interviewer connected response was malformed\./);
  assert.match(interviewerConnectedRoute, /isInterviewerConnectedResponse\(payload\)/);
  for (const field of ["sessionId", "room"]) {
    assert.match(interviewerConnectedRoute, new RegExp(`typeof \\w+\\.${field} === "string"`));
  }

  assert.match(aiControlRoute, /AI interviewer control response was malformed\./);
  assert.match(aiControlRoute, /isAiControlResponse\(payload\)/);
  assert.match(aiControlRoute, /end/);
  assert.match(aiControlRoute, /ended/);
  assert.match(aiControlRoute, /Choose start, stop, resume, or end\./);
  for (const field of ["sessionId", "aiInterviewerState", "requestedAt"]) {
    assert.match(aiControlRoute, new RegExp(`typeof \\w+\\.${field} === "string"`));
  }
});

test("interviewer join page is a full-screen dashboard-gated room entry", async () => {
  const pageSource = await requiredSource("../app/dashboard/interviews/[sessionId]/join/page.tsx");

  assert.match(pageSource, /dynamic = "force-dynamic"/);
  assert.match(pageSource, /metadata: Metadata = noindexMetadata/);
  assert.match(pageSource, /readonly params: Promise/);
  assert.match(pageSource, /const \{ sessionId \} = await params/);
  assert.match(pageSource, /requireDashboardUser/);
  assert.match(
    pageSource,
    /requireDashboardUser\(`\/dashboard\/interviews\/\$\{encodeURIComponent\(sessionId\)\}\/join`\)/,
  );
  assert.match(pageSource, /InterviewerJoinClient/);
  assert.match(pageSource, /fixed inset-0/);
  assert.match(pageSource, /z-\[\d+\]/);
  assert.match(pageSource, /<InterviewerJoinClient sessionId=\{sessionId\} \/>/);
});

test("role workspace does not own generic room creation", async () => {
  const rolePageSource = await requiredSource("../app/dashboard/roles/[roleId]/page.tsx");

  assert.doesNotMatch(rolePageSource, /CreateAndJoinInterviewForm/);
  assert.doesNotMatch(rolePageSource, /Create and join interview/);
});

test("dashboard topbar exposes a generic create-and-join room launcher", async () => {
  const launcherSource = await requiredSource(dashboardCreateInterviewLauncherPath);

  assert.match(dashboardChrome, /DashboardCreateInterviewLauncher/);
  assert.match(launcherSource, /Create and join interview/);
  assert.match(launcherSource, /fetch\("\/api\/interviews"/);
  assert.match(launcherSource, /interviewerJoinUrl/);
  assert.match(launcherSource, /router\.push\(interviewerJoinUrl\)/);
  assert.doesNotMatch(launcherSource, /roleLabel/);
  assert.doesNotMatch(launcherSource, /candidateEmail/);
});

test("interviewer join client exposes host invite, join, and AI controls without candidate notices", async () => {
  const clientSource = await requiredSource(
    "../app/dashboard/interviews/[sessionId]/join/InterviewerJoinClient.tsx",
  );

  for (const expectedSource of [
    "livekit-client",
    "candidate-invite",
    "Copy candidate link",
    "Create new link",
    "Retry",
    "interviewer-join",
    "interviewer-connected",
    "Start AI",
    "Stop AI",
    "Resume AI",
    "End AI",
  ]) {
    assert.match(clientSource, new RegExp(expectedSource));
  }

  assert.match(clientSource, /const inviteRequestedRef = useRef\(false\)/);
  assert.match(clientSource, /if \(inviteRequestedRef\.current\)/);
  assert.match(clientSource, /inviteRequestedRef\.current = true/);
  assert.match(clientSource, /void createCandidateInvite\(\)/);

  assert.match(clientSource, /new Room\(/);
  assert.match(clientSource, /room\.connect\(payload\.liveKitUrl, payload\.token\)/);
  assert.match(clientSource, /createLocalAudioTrack/);
  assert.match(clientSource, /createLocalVideoTrack/);
  assert.doesNotMatch(clientSource, /const \[audioTrack, videoTrack\] = await Promise\.all/);
  const mediaAcquisitionSource = clientSource.slice(
    clientSource.indexOf("const audioTrack = await createLocalAudioTrack"),
    clientSource.indexOf("await Promise.all([\n        room.localParticipant.publishTrack"),
  );
  assert.ok(
    mediaAcquisitionSource.indexOf("localAudioTrackRef.current = audioTrack") <
      mediaAcquisitionSource.indexOf("const videoTrack = await createLocalVideoTrack"),
    "audio track should be assigned to its cleanup ref before video acquisition can throw",
  );
  assert.ok(
    mediaAcquisitionSource.indexOf("localVideoTrackRef.current = videoTrack") <
      mediaAcquisitionSource.indexOf("setLocalVideoTrack(videoTrack)"),
    "video track should be assigned to its cleanup ref before later publishing/setup can throw",
  );
  assert.match(clientSource, /room\.localParticipant\.publishTrack\(audioTrack\)/);
  assert.match(clientSource, /room\.localParticipant\.publishTrack\(videoTrack\)/);
  const publishIndex = clientSource.indexOf("await Promise.all([\n        room.localParticipant.publishTrack");
  const liveStageIndex = clientSource.indexOf("setStage(\"live\")", publishIndex);
  const postPublishSource = clientSource.slice(
    publishIndex,
    liveStageIndex + "setStage(\"live\")".length,
  );
  assert.match(postPublishSource, /interviewer-connected/);
  assert.match(postPublishSource, /isInterviewerConnectedResponse\(\w+\)/);
  assert.ok(
    postPublishSource.indexOf("interviewer-connected") <
      postPublishSource.indexOf("setStage(\"live\")"),
    "connected acknowledgement should happen before the live stage is set",
  );
  assert.match(clientSource, /\.attach\(video\)/);
  assert.match(clientSource, /\.detach\(video\)/);
  assert.match(clientSource, /track\.attach\(\)/);
  assert.match(clientSource, /track\.detach\(\)/);
  assert.match(clientSource, /replaceChildren\(\)/);
  assert.match(clientSource, /localAudioTrackRef\.current\?\.stop\(\)/);
  assert.match(clientSource, /localVideoTrackRef\.current\?\.stop\(\)/);
  assert.match(clientSource, /liveKitRoomRef\.current\?\.disconnect\(\)/);

  assert.match(clientSource, /body: JSON\.stringify\(\{ action: control\.action \}\)/);
  assert.match(clientSource, /publishData/);
  assert.match(clientSource, /TextEncoder/);
  assert.match(clientSource, /puddle_ai_control/);
  assert.match(clientSource, /command: "pause"/);
  assert.match(clientSource, /command: "resume"/);
  assert.match(clientSource, /command: "end"/);
  assert.match(clientSource, /action: "end"/);
  assert.match(clientSource, /AI interviewer ended/);
  const requestAiControlSource = clientSource.slice(
    clientSource.indexOf("const requestAiControl = useCallback"),
    clientSource.indexOf("const endCall = useCallback"),
  );
  assert.match(requestAiControlSource, /const commandRequired = control\.command && control\.action !== "end"/);
  assert.match(requestAiControlSource, /const commandDelivered = await publishAiControlCommand\(control\.command\)/);
  assert.match(requestAiControlSource, /AI interviewer command could not be delivered\./);
  assert.match(requestAiControlSource, /void publishAiControlCommand\(control\.command\)/);
  assert.doesNotMatch(requestAiControlSource, /AI interviewer state was saved/);
  assert.ok(
    requestAiControlSource.indexOf("const commandDelivered = await publishAiControlCommand(control.command)") <
      requestAiControlSource.indexOf("const response = await fetch"),
    "stop and resume commands should be delivered before persisting backend state",
  );
  assert.ok(
    requestAiControlSource.indexOf("AI interviewer command could not be delivered.") <
      requestAiControlSource.indexOf("const response = await fetch"),
    "command delivery failure should return before the backend state is persisted",
  );
  assert.ok(
    requestAiControlSource.indexOf("void publishAiControlCommand(control.command)") <
      requestAiControlSource.indexOf("const response = await fetch"),
    "end should publish best-effort before the authoritative backend end request",
  );
  assert.match(clientSource, /setAiInterviewerState\(payload\.aiInterviewerState\)/);
  assert.match(clientSource, /parseJsonResponse\(response\)/);
  assert.match(clientSource, /return await response\.json\(\)/);
  assert.match(clientSource, /catch \{\s+return null;\s+\}/);
  assert.match(clientSource, /errorFromPayload\(payload, "AI interviewer control request failed\."\)/);

  assert.doesNotMatch(clientSource, /AI interview disclosure/);
  assert.doesNotMatch(clientSource, /Accept all required interview notices/);
});

test("candidate join client assigns media cleanup refs during sequential acquisition", async () => {
  const clientSource = await requiredSource("../app/interview/[token]/InterviewJoinClient.tsx");

  assert.match(clientSource, /createLocalAudioTrack/);
  assert.match(clientSource, /createLocalVideoTrack/);
  assert.doesNotMatch(clientSource, /const \[audioTrack, videoTrack\] = await Promise\.all/);

  const audioCreateIndex = clientSource.indexOf("const audioTrack = await createLocalAudioTrack");
  const audioRefIndex = clientSource.indexOf("localAudioTrackRef.current = audioTrack", audioCreateIndex);
  const videoCreateIndex = clientSource.indexOf("const videoTrack = await createLocalVideoTrack", audioCreateIndex);
  const videoRefIndex = clientSource.indexOf("localVideoTrackRef.current = videoTrack", videoCreateIndex);
  const setupIndex = clientSource.indexOf("await Promise.all([\n        setLocalTrackEnabled", videoCreateIndex);

  assert.notEqual(audioCreateIndex, -1, "candidate audio track should be created before video acquisition");
  assert.notEqual(audioRefIndex, -1, "candidate audio track should be assigned to cleanup ref");
  assert.notEqual(videoCreateIndex, -1, "candidate video track should be created after audio ref assignment");
  assert.notEqual(videoRefIndex, -1, "candidate video track should be assigned to cleanup ref");
  assert.notEqual(setupIndex, -1, "candidate local track setup should happen after refs are assigned");
  assert.ok(
    audioCreateIndex < audioRefIndex && audioRefIndex < videoCreateIndex,
    "candidate audio track should be assigned to its cleanup ref before video acquisition can throw",
  );
  assert.ok(
    videoCreateIndex < videoRefIndex && videoRefIndex < setupIndex,
    "candidate video track should be assigned to its cleanup ref before later setup can throw",
  );
});

test("host and candidate clients model the AI interviewer as a visible LiveKit participant tile", async () => {
  const hostClientSource = await requiredSource(
    "../app/dashboard/interviews/[sessionId]/join/InterviewerJoinClient.tsx",
  );
  const candidateClientSource = await requiredSource("../app/interview/[token]/InterviewJoinClient.tsx");

  assert.match(liveKitParticipantTilesSource, /AI_INTERVIEWER_IDENTITY_PREFIX = "puddle-interviewer-"/);
  assert.match(liveKitParticipantTilesSource, /aiInterviewerParticipantIdentity\(sessionId: string\)/);
  assert.match(liveKitParticipantTilesSource, /participant\.isAgent/);
  assert.match(liveKitParticipantTilesSource, /participant_kind/);
  assert.match(liveKitParticipantTilesSource, /puddle\.role/);
  assert.match(liveKitParticipantTilesSource, /syncParticipantTiles/);
  assert.match(liveKitParticipantTilesSource, /setParticipantVideoTrack/);

  for (const clientSource of [hostClientSource, candidateClientSource]) {
    assert.match(clientSource, /RemoteParticipantTileCard/);
    assert.match(clientSource, /remoteParticipantTiles/);
    assert.match(clientSource, /syncParticipantTiles/);
    assert.match(clientSource, /setParticipantVideoTrack/);
    assert.match(clientSource, /RemoteParticipant/);
    assert.match(clientSource, /RemoteTrackPublication/);
    assert.match(clientSource, /participant: RemoteParticipant/);
  }

  assert.match(hostClientSource, /findParticipantTile\(remoteParticipantTiles, "ai_interviewer"\)/);
  assert.match(hostClientSource, /aiInterviewerPlaceholderTile/);
  assert.match(hostClientSource, /label=\{tile\.label\}/);

  assert.match(candidateClientSource, /aiInterviewerParticipantIdentity\(join\?\.sessionId/);
  assert.match(candidateClientSource, /findParticipantTile\(remoteParticipantTiles, "ai_interviewer"\)/);
  assert.match(candidateClientSource, /aiInterviewerTile/);
  assert.match(candidateClientSource, /Puddle AI interviewer/);
  assert.doesNotMatch(candidateClientSource, /setRemoteVideoTrack/);
});
