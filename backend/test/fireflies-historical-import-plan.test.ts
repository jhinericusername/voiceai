import { describe, expect, it } from "vitest";
import {
  buildHistoricalImportPlan,
  type HistoricalImportPlanInput,
} from "../src/weave/fireflies/historicalImportPlan.js";

const orgId = "org_01KV4FF7KX24B76H7Q57QVB5CT";
const transcriptId = "01ABC";
const sourceOccurrenceId =
  "0444c421572bcea553229ae76b6bc1a135225a566f3fdf9d721b53874bd99095";
const sessionId = `hist_fireflies_${sourceOccurrenceId}`;

function planInput(overrides: Partial<HistoricalImportPlanInput> = {}): HistoricalImportPlanInput {
  const prefix =
    "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/";
  return {
    orgId,
    sourceBucket: "weave-fireflies-raw",
    targetBucket: "puddle-artifacts",
    recording: {
      transcriptId,
      ownerEmail: "owner@example.com",
      meetingDate: "2026-04-09",
      prefix,
      audioKey: `${prefix}audio.mp3`,
      videoKey: `${prefix}video.mp4`,
      transcriptKey: `${prefix}transcript.json`,
      metadataKey: `${prefix}metadata.json`,
      summaryKey: `${prefix}summary.json`,
      ingestionResultKey: `${prefix}ingestion-result.json`,
      objectCount: 6,
    },
    metadata: {
      targetEmail: "candidate@example.com",
      meetingStartedAt: "2026-04-09T15:30:00.000Z",
      durationSeconds: 1800,
    },
    transcript: {
      sentences: [
        {
          speaker_name: "Prakul Singh",
          text: "Tell me about your background.",
          start_time: 3,
        },
        {
          speaker_name: "Candidate",
          text: "I build developer tools.",
          start_time: 8.25,
        },
      ],
    },
    summary: { overview: "Useful interview." },
    ingestionResult: { status: "ok" },
    weaveMatch: {
      matchStatus: "matched",
      ashbyCandidateId: "cand_123",
      ashbyApplicationId: "app_123",
      ashbyJobId: "job_123",
      candidateEvaluationId: "eval_123",
      decisionSource: "manual",
      decisionReason: ["selected in reconciliation table"],
      decidedAt: "2026-04-10T12:00:00.000Z",
    },
    weaveMatchCandidates: [
      {
        rank: 2,
        score: 96,
        ashbyCandidateId: "cand_999",
        ashbyApplicationId: "app_999",
        ashbyJobId: "job_999",
        candidateEvaluationId: null,
        matchedEmail: "other@example.com",
        dateDeltaDays: 2,
        stageDeltaDays: 1,
        stageTitles: ["Phone Screen"],
        applicationActiveOnMeetingDate: true,
        activeApplicationCount: 2,
        reasons: ["secondary candidate"],
      },
      {
        rank: 1,
        score: 92,
        ashbyCandidateId: "cand_low_score",
        ashbyApplicationId: "app_low_score",
        ashbyJobId: null,
        candidateEvaluationId: null,
        matchedEmail: "candidate@example.com",
        dateDeltaDays: 0,
        stageDeltaDays: null,
        stageTitles: [],
        applicationActiveOnMeetingDate: false,
        activeApplicationCount: null,
        reasons: ["lower score at same rank"],
      },
      {
        rank: 1,
        score: 96,
        ashbyCandidateId: "cand_123",
        ashbyApplicationId: "app_123",
        ashbyJobId: "job_123",
        candidateEvaluationId: "eval_123",
        matchedEmail: "candidate@example.com",
        dateDeltaDays: 0,
        stageDeltaDays: 0,
        stageTitles: ["Technical Interview", "Final"],
        applicationActiveOnMeetingDate: true,
        activeApplicationCount: 1,
        reasons: ["email match", "meeting date aligned"],
      },
    ],
    ...overrides,
  };
}

describe("Fireflies historical import plan", () => {
  it("builds deterministic session, recording, artifact, copy, and transcript turn rows", () => {
    const plan = buildHistoricalImportPlan(planInput());

    expect(plan.session.sessionId).toBe(sessionId);
    expect(plan.session.orgId).toBe(orgId);
    expect(plan.session).toMatchObject({
      candidateEmail: "candidate@example.com",
      scriptVersion: "fireflies-historical-v1",
      status: "review_ready",
      scheduledAt: "2026-04-09T15:30:00.000Z",
      startedAt: "2026-04-09T15:30:00.000Z",
      endedAt: "2026-04-09T16:00:00.000Z",
      roomName: "fireflies-01ABC",
      externalSource: "fireflies",
      externalId: sourceOccurrenceId,
    });
    expect(plan.session.sourceMetadata).toMatchObject({
      fireflies: {
        transcriptId,
        sourceOccurrenceId,
        ownerEmail: "owner@example.com",
        meetingDate: "2026-04-09",
        sourceBucket: "weave-fireflies-raw",
        sourcePrefix:
          "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/",
        targetBucket: "puddle-artifacts",
        matchStatus: "matched",
        audioKey:
          "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/audio.mp3",
        videoKey:
          "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/video.mp4",
        transcriptKey:
          "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/transcript.json",
        metadataKey:
          "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/metadata.json",
        summaryKey:
          "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/summary.json",
        ingestionResultKey:
          "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/ingestion-result.json",
      },
      ashby: {
        selected: {
          candidateId: "cand_123",
          applicationId: "app_123",
          jobId: "job_123",
          candidateEvaluationId: "eval_123",
          decisionSource: "manual",
          decisionReason: ["selected in reconciliation table"],
          decidedAt: "2026-04-10T12:00:00.000Z",
        },
        matchCandidates: [
          {
            rank: 1,
            score: 96,
            candidateId: "cand_123",
            applicationId: "app_123",
            jobId: "job_123",
            candidateEvaluationId: "eval_123",
            matchedEmail: "candidate@example.com",
            dateDeltaDays: 0,
            stageDeltaDays: 0,
            stageTitles: ["Technical Interview", "Final"],
            applicationActiveOnMeetingDate: true,
            activeApplicationCount: 1,
            reasons: ["email match", "meeting date aligned"],
          },
          {
            rank: 1,
            score: 92,
            candidateId: "cand_low_score",
            applicationId: "app_low_score",
            jobId: null,
            candidateEvaluationId: null,
            matchedEmail: "candidate@example.com",
            dateDeltaDays: 0,
            stageDeltaDays: null,
            stageTitles: [],
            applicationActiveOnMeetingDate: false,
            activeApplicationCount: null,
            reasons: ["lower score at same rank"],
          },
          {
            rank: 2,
            score: 96,
            candidateId: "cand_999",
            applicationId: "app_999",
            jobId: "job_999",
            candidateEvaluationId: null,
            matchedEmail: "other@example.com",
            dateDeltaDays: 2,
            stageDeltaDays: 1,
            stageTitles: ["Phone Screen"],
            applicationActiveOnMeetingDate: true,
            activeApplicationCount: 2,
            reasons: ["secondary candidate"],
          },
        ],
      },
      summary: { overview: "Useful interview." },
      ingestion: { status: "ok" },
    });
    expect(plan.session.sourceMetadata.ashby.selected?.applicationId).toBe("app_123");
    expect(plan.session.sourceMetadata.ashby.matchCandidates[0]).toMatchObject({
      rank: 1,
      score: 96,
      applicationId: "app_123",
      candidateId: "cand_123",
    });
    expect(
      plan.session.sourceMetadata.ashby.matchCandidates.map((candidate) => [
        candidate.rank,
        candidate.score,
        candidate.applicationId,
      ]),
    ).toEqual([
      [1, 96, "app_123"],
      [1, 92, "app_low_score"],
      [2, 96, "app_999"],
    ]);

    expect(plan.recording).toEqual({
      sessionId,
      egressId: `fireflies:${sourceOccurrenceId}`,
      status: "complete",
      startedAt: "2026-04-09T15:30:00.000Z",
      endedAt: "2026-04-09T16:00:00.000Z",
      errorMessage: null,
    });

    expect(plan.artifacts).toHaveLength(3);
    expect(plan.artifacts.some((artifact) => artifact.kind === "composite_video")).toBe(true);
    expect(plan.artifacts.some((artifact) => artifact.kind === "candidate_audio")).toBe(true);
    expect(plan.artifacts.some((artifact) => artifact.kind === "transcript")).toBe(true);
    expect(plan.artifacts).toEqual([
      {
        artifactId: `${sessionId}_composite_video`,
        sessionId,
        kind: "composite_video",
        storagePath:
          `/${orgId}/interviews/${sessionId}/media/composite.mp4`,
        contentType: "video/mp4",
        status: "available",
        sizeBytes: null,
        durationSeconds: 1800,
      },
      {
        artifactId: `${sessionId}_candidate_audio`,
        sessionId,
        kind: "candidate_audio",
        storagePath:
          `/${orgId}/interviews/${sessionId}/media/candidate_audio.mp3`,
        contentType: "audio/mpeg",
        status: "available",
        sizeBytes: null,
        durationSeconds: 1800,
      },
      {
        artifactId: `${sessionId}_transcript`,
        sessionId,
        kind: "transcript",
        storagePath:
          `/${orgId}/interviews/${sessionId}/transcripts/transcript.v1.json`,
        contentType: "application/json",
        status: "available",
        sizeBytes: null,
        durationSeconds: null,
      },
    ]);

    expect(plan.copies).toEqual([
      {
        sourceBucket: "weave-fireflies-raw",
        sourceKey:
          "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/video.mp4",
        targetBucket: "puddle-artifacts",
        targetKey: `${orgId}/interviews/${sessionId}/media/composite.mp4`,
        artifactId: `${sessionId}_composite_video`,
      },
      {
        sourceBucket: "weave-fireflies-raw",
        sourceKey:
          "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/audio.mp3",
        targetBucket: "puddle-artifacts",
        targetKey: `${orgId}/interviews/${sessionId}/media/candidate_audio.mp3`,
        artifactId: `${sessionId}_candidate_audio`,
      },
      {
        sourceBucket: "weave-fireflies-raw",
        sourceKey:
          "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/transcript.json",
        targetBucket: "puddle-artifacts",
        targetKey: `${orgId}/interviews/${sessionId}/transcripts/transcript.v1.json`,
        artifactId: `${sessionId}_transcript`,
      },
      {
        sourceBucket: "weave-fireflies-raw",
        sourceKey:
          "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/metadata.json",
        targetBucket: "puddle-artifacts",
        targetKey: `${orgId}/interviews/${sessionId}/source/fireflies/metadata.json`,
        artifactId: null,
      },
      {
        sourceBucket: "weave-fireflies-raw",
        sourceKey:
          "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/summary.json",
        targetBucket: "puddle-artifacts",
        targetKey: `${orgId}/interviews/${sessionId}/source/fireflies/summary.json`,
        artifactId: null,
      },
      {
        sourceBucket: "weave-fireflies-raw",
        sourceKey:
          "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/ingestion-result.json",
        targetBucket: "puddle-artifacts",
        targetKey: `${orgId}/interviews/${sessionId}/source/fireflies/ingestion-result.json`,
        artifactId: null,
      },
    ]);

    expect(plan.transcriptTurns).toEqual([
      {
        sessionId,
        turnIndex: 0,
        speaker: "agent",
        questionId: null,
        text: "Tell me about your background.",
        occurredAt: "2026-04-09T15:30:03.000Z",
        offsetMs: 3000,
        source: "fireflies",
      },
      {
        sessionId,
        turnIndex: 1,
        speaker: "candidate",
        questionId: null,
        text: "I build developer tools.",
        occurredAt: "2026-04-09T15:30:08.250Z",
        offsetMs: 8250,
        source: "fireflies",
      },
    ]);
  });

  it("derives import identity from source bucket and recording prefix instead of transcript ID alone", () => {
    const duplicatePrefix =
      "raw/fireflies/owner=other@workweave.ai/year=2026/month=04/day=10/transcript_id=01ABC/";
    const duplicatePlan = buildHistoricalImportPlan(
      planInput({
        recording: {
          ...planInput().recording,
          ownerEmail: "other@example.com",
          meetingDate: "2026-04-10",
          prefix: duplicatePrefix,
          audioKey: `${duplicatePrefix}audio.m4a`,
          videoKey: null,
          transcriptKey: `${duplicatePrefix}transcript.json`,
          metadataKey: `${duplicatePrefix}metadata.json`,
          summaryKey: null,
          ingestionResultKey: null,
          objectCount: 3,
        },
      }),
    );

    expect(duplicatePlan.session.sessionId).toBe(
      "hist_fireflies_f839edac080938814b98631322ab2271d0790dede3c3e35d014b4afd9a6a60af",
    );
    expect(duplicatePlan.session.externalId).toBe(
      "f839edac080938814b98631322ab2271d0790dede3c3e35d014b4afd9a6a60af",
    );
    expect(duplicatePlan.recording.egressId).toBe(
      "fireflies:f839edac080938814b98631322ab2271d0790dede3c3e35d014b4afd9a6a60af",
    );
    expect(duplicatePlan.session.sourceMetadata.fireflies.transcriptId).toBe("01ABC");
    expect(duplicatePlan.artifacts.map((artifact) => artifact.artifactId)).toEqual([
      "hist_fireflies_f839edac080938814b98631322ab2271d0790dede3c3e35d014b4afd9a6a60af_candidate_audio",
      "hist_fireflies_f839edac080938814b98631322ab2271d0790dede3c3e35d014b4afd9a6a60af_transcript",
    ]);
    expect(duplicatePlan.artifacts[0]?.storagePath).toBe(
      "/org_01KV4FF7KX24B76H7Q57QVB5CT/interviews/hist_fireflies_f839edac080938814b98631322ab2271d0790dede3c3e35d014b4afd9a6a60af/media/candidate_audio.mp3",
    );

    const originalPlan = buildHistoricalImportPlan(planInput());
    expect(originalPlan.session.sessionId).not.toBe(duplicatePlan.session.sessionId);
    expect(originalPlan.session.externalId).not.toBe(duplicatePlan.session.externalId);
    expect(originalPlan.artifacts[0]?.storagePath).not.toBe(
      duplicatePlan.artifacts[0]?.storagePath,
    );
  });

  it("omits composite video artifact and copy when the recording has no video key", () => {
    const plan = buildHistoricalImportPlan(
      planInput({
        recording: {
          ...planInput().recording,
          videoKey: null,
        },
      }),
    );

    expect(plan.artifacts.some((artifact) => artifact.kind === "composite_video")).toBe(false);
    expect(plan.copies.some((copy) => copy.artifactId?.endsWith("_composite_video"))).toBe(false);
    expect(plan.artifacts.some((artifact) => artifact.kind === "candidate_audio")).toBe(true);
    expect(plan.artifacts.some((artifact) => artifact.kind === "transcript")).toBe(true);
  });

  it("uses a transcript attendee email when metadata targetEmail is missing", () => {
    const plan = buildHistoricalImportPlan(
      planInput({
        metadata: {
          meetingStartedAt: "2026-04-09T15:30:00.000Z",
          durationSeconds: 1800,
        },
        transcript: {
          attendees: [{ email: "attendee-candidate@example.com" }],
          sentences: [],
        },
      }),
    );

    expect(plan.session.candidateEmail).toBe("attendee-candidate@example.com");
  });

  it("falls back to the unknown placeholder instead of ownerEmail when candidate email is unavailable", () => {
    const plan = buildHistoricalImportPlan(
      planInput({
        metadata: {
          meetingStartedAt: "2026-04-09T15:30:00.000Z",
          durationSeconds: 1800,
        },
        transcript: {
          attendees: [],
          sentences: [],
        },
      }),
    );

    expect(plan.session.candidateEmail).toBe("unknown-fireflies-candidate@example.invalid");
    expect(plan.session.candidateEmail).not.toBe("owner@example.com");
  });

  it("marks metadata as unindexed when Weave reconciliation is unavailable", () => {
    const plan = buildHistoricalImportPlan(
      planInput({
        weaveMatch: null,
        weaveMatchCandidates: [],
      }),
    );

    expect(plan.session.sourceMetadata.fireflies.matchStatus).toBe("unindexed");
    expect(plan.session.sourceMetadata.ashby.selected).toBeNull();
    expect(plan.session.sourceMetadata.ashby.matchCandidates).toEqual([]);
  });

  it("preserves ranked Ashby candidates when there is no selected Weave match", () => {
    const plan = buildHistoricalImportPlan(
      planInput({
        weaveMatch: null,
      }),
    );

    expect(plan.session.sourceMetadata.fireflies.matchStatus).toBe("unindexed");
    expect(plan.session.sourceMetadata.ashby.selected).toBeNull();
    expect(
      plan.session.sourceMetadata.ashby.matchCandidates.map((candidate) => [
        candidate.rank,
        candidate.score,
        candidate.applicationId,
      ]),
    ).toEqual([
      [1, 96, "app_123"],
      [1, 92, "app_low_score"],
      [2, 96, "app_999"],
    ]);
    expect(plan.session.sourceMetadata.ashby.matchCandidates[0]).toMatchObject({
      rank: 1,
      score: 96,
      candidateId: "cand_123",
      applicationId: "app_123",
      jobId: "job_123",
      candidateEvaluationId: "eval_123",
      matchedEmail: "candidate@example.com",
      stageTitles: ["Technical Interview", "Final"],
      applicationActiveOnMeetingDate: true,
      activeApplicationCount: 1,
      reasons: ["email match", "meeting date aligned"],
    });
  });

  it("does not select Ashby metadata when the Weave match has no application id", () => {
    const plan = buildHistoricalImportPlan(
      planInput({
        weaveMatch: {
          matchStatus: "candidate_only",
          ashbyCandidateId: "cand_123",
          ashbyApplicationId: null,
          ashbyJobId: "job_123",
          candidateEvaluationId: "eval_123",
          decisionSource: "automatic",
          decisionReason: ["candidate id exists without application"],
          decidedAt: "2026-04-10T12:00:00.000Z",
        },
      }),
    );

    expect(plan.session.sourceMetadata.fireflies.matchStatus).toBe("candidate_only");
    expect(plan.session.sourceMetadata.ashby.selected).toBeNull();
  });
});
