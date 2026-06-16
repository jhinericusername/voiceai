import { createHash } from "node:crypto";
import type { HistoricalFirefliesRecording } from "./historicalInventory.js";
import { historicalTranscriptTurns } from "./historicalTranscript.js";
import type { HistoricalTranscriptTurn } from "./historicalTranscript.js";

type JsonRecord = Record<string, unknown>;

export interface HistoricalImportPlanInput {
  readonly orgId: string;
  readonly sourceBucket: string;
  readonly targetBucket: string;
  readonly recording: HistoricalFirefliesRecording;
  readonly metadata: unknown;
  readonly transcript: unknown;
  readonly summary: unknown;
  readonly ingestionResult: unknown;
  readonly weaveMatch: HistoricalWeaveMatch | null;
  readonly weaveMatchCandidates: readonly HistoricalWeaveMatchCandidate[];
}

export interface HistoricalWeaveMatch {
  readonly matchStatus: string | null;
  readonly ashbyCandidateId: string | null;
  readonly ashbyApplicationId: string | null;
  readonly ashbyJobId: string | null;
  readonly candidateEvaluationId: string | null;
  readonly decisionSource: string | null;
  readonly decisionReason: readonly string[];
  readonly decidedAt: string | null;
}

export interface HistoricalWeaveMatchCandidate {
  readonly rank: number;
  readonly score: number;
  readonly ashbyCandidateId: string;
  readonly ashbyApplicationId: string;
  readonly ashbyJobId: string | null;
  readonly candidateEvaluationId: string | null;
  readonly matchedEmail: string | null;
  readonly dateDeltaDays: number | null;
  readonly stageDeltaDays: number | null;
  readonly stageTitles: readonly string[];
  readonly applicationActiveOnMeetingDate: boolean;
  readonly activeApplicationCount: number | null;
  readonly reasons: readonly string[];
}

export interface HistoricalImportPlan {
  readonly session: HistoricalImportSessionRow;
  readonly recording: HistoricalImportRecordingRow;
  readonly artifacts: readonly HistoricalImportArtifactRow[];
  readonly transcriptTurns: readonly HistoricalImportTranscriptTurnRow[];
  readonly copies: readonly HistoricalImportCopy[];
}

export interface HistoricalImportSessionRow {
  readonly sessionId: string;
  readonly orgId: string;
  readonly candidateEmail: string;
  readonly scriptVersion: "fireflies-historical-v1";
  readonly status: "review_ready";
  readonly scheduledAt: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly roomName: string;
  readonly externalSource: "fireflies";
  readonly externalId: string;
  readonly sourceMetadata: HistoricalImportSourceMetadata;
}

export interface HistoricalImportRecordingRow {
  readonly sessionId: string;
  readonly egressId: string;
  readonly status: "complete";
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly errorMessage: null;
}

export type HistoricalImportArtifactKind =
  | "composite_video"
  | "candidate_audio"
  | "transcript";

export interface HistoricalImportArtifactRow {
  readonly artifactId: string;
  readonly sessionId: string;
  readonly kind: HistoricalImportArtifactKind;
  readonly storagePath: string;
  readonly contentType: string;
  readonly status: "available";
  readonly sizeBytes: number | null;
  readonly durationSeconds: number | null;
}

export interface HistoricalImportTranscriptTurnRow extends HistoricalTranscriptTurn {
  readonly sessionId: string;
  readonly occurredAt: string | null;
  readonly source: "fireflies";
}

export interface HistoricalImportCopy {
  readonly sourceBucket: string;
  readonly sourceKey: string;
  readonly targetBucket: string;
  readonly targetKey: string;
  readonly artifactId: string | null;
}

export interface HistoricalImportSourceMetadata {
  readonly fireflies: {
    readonly transcriptId: string;
    readonly sourceOccurrenceId: string;
    readonly ownerEmail: string | null;
    readonly meetingDate: string | null;
    readonly sourceBucket: string;
    readonly sourcePrefix: string;
    readonly targetBucket: string;
    readonly matchStatus: string | null;
    readonly audioKey: string | null;
    readonly videoKey: string | null;
    readonly transcriptKey: string | null;
    readonly metadataKey: string | null;
    readonly summaryKey: string | null;
    readonly ingestionResultKey: string | null;
  };
  readonly ashby: {
    readonly selected: HistoricalImportSelectedAshby | null;
    readonly matchCandidates: readonly HistoricalImportAshbyMatchCandidate[];
  };
  readonly summary: unknown;
  readonly ingestion: unknown;
}

export interface HistoricalImportSelectedAshby {
  readonly candidateId: string | null;
  readonly applicationId: string;
  readonly jobId: string | null;
  readonly candidateEvaluationId: string | null;
  readonly decisionSource: string | null;
  readonly decisionReason: readonly string[];
  readonly decidedAt: string | null;
}

export interface HistoricalImportAshbyMatchCandidate {
  readonly rank: number;
  readonly score: number;
  readonly candidateId: string;
  readonly applicationId: string;
  readonly jobId: string | null;
  readonly candidateEvaluationId: string | null;
  readonly matchedEmail: string | null;
  readonly dateDeltaDays: number | null;
  readonly stageDeltaDays: number | null;
  readonly stageTitles: readonly string[];
  readonly applicationActiveOnMeetingDate: boolean;
  readonly activeApplicationCount: number | null;
  readonly reasons: readonly string[];
}

interface PlannedArtifactSource {
  readonly kind: HistoricalImportArtifactKind;
  readonly sourceKey: string;
  readonly storagePath: string;
  readonly contentType: string;
  readonly durationSeconds: number | null;
}

interface PlannedSourceJsonCopy {
  readonly sourceKey: string;
  readonly storagePath: string;
}

export function buildHistoricalImportPlan(
  input: HistoricalImportPlanInput,
): HistoricalImportPlan {
  const sourceOccurrenceId = historicalFirefliesSourceOccurrenceId(
    input.sourceBucket,
    input.recording.prefix,
  );
  const sessionId = `hist_fireflies_${sourceOccurrenceId}`;
  const root = `/${input.orgId}/interviews/${sessionId}/`;
  const metadata = asRecord(input.metadata);
  const transcript = asRecord(input.transcript);
  const meetingStartedAt = meetingStartedAtFrom(input.recording, metadata, transcript);
  const durationSeconds = durationSecondsFrom(metadata, transcript);
  const endedAt = endedAtFromDuration(meetingStartedAt, durationSeconds);
  const candidateEmail = candidateEmailFrom(metadata, transcript);
  const artifacts = plannedArtifactSources(input.recording, root, durationSeconds);
  const sourceJsonCopies = plannedSourceJsonCopies(input.recording, root);

  return {
    session: {
      sessionId,
      orgId: input.orgId,
      candidateEmail,
      scriptVersion: "fireflies-historical-v1",
      status: "review_ready",
      scheduledAt: meetingStartedAt,
      startedAt: meetingStartedAt,
      endedAt,
      roomName: `fireflies-${input.recording.transcriptId}`,
      externalSource: "fireflies",
      externalId: sourceOccurrenceId,
      sourceMetadata: sourceMetadata(input),
    },
    recording: {
      sessionId,
      egressId: `fireflies:${sourceOccurrenceId}`,
      status: "complete",
      startedAt: meetingStartedAt,
      endedAt,
      errorMessage: null,
    },
    artifacts: artifacts.map((artifact) => ({
      artifactId: artifactId(sourceOccurrenceId, artifact.kind),
      sessionId,
      kind: artifact.kind,
      storagePath: artifact.storagePath,
      contentType: artifact.contentType,
      status: "available",
      sizeBytes: null,
      durationSeconds: artifact.durationSeconds,
    })),
    transcriptTurns: historicalTranscriptTurns(input.transcript).map((turn) => ({
      sessionId,
      ...turn,
      occurredAt: occurredAtFromOffset(meetingStartedAt, turn.offsetMs),
      source: "fireflies",
    })),
    copies: [
      ...artifacts.map((artifact): HistoricalImportCopy => ({
        sourceBucket: input.sourceBucket,
        sourceKey: artifact.sourceKey,
        targetBucket: input.targetBucket,
        targetKey: storagePathToTargetKey(artifact.storagePath),
        artifactId: artifactId(sourceOccurrenceId, artifact.kind),
      })),
      ...sourceJsonCopies.map((copy): HistoricalImportCopy => ({
        sourceBucket: input.sourceBucket,
        sourceKey: copy.sourceKey,
        targetBucket: input.targetBucket,
        targetKey: storagePathToTargetKey(copy.storagePath),
        artifactId: null,
      })),
    ],
  };
}

export function historicalFirefliesSourceOccurrenceId(
  sourceBucket: string,
  recordingPrefix: string,
): string {
  return createHash("sha256").update(`${sourceBucket}/${recordingPrefix}`).digest("hex");
}

function plannedArtifactSources(
  recording: HistoricalFirefliesRecording,
  root: string,
  durationSeconds: number | null,
): PlannedArtifactSource[] {
  const artifacts: PlannedArtifactSource[] = [];
  if (recording.videoKey) {
    artifacts.push({
      kind: "composite_video",
      sourceKey: recording.videoKey,
      storagePath: `${root}media/composite.mp4`,
      contentType: "video/mp4",
      durationSeconds,
    });
  }
  if (recording.audioKey) {
    artifacts.push({
      kind: "candidate_audio",
      sourceKey: recording.audioKey,
      storagePath: `${root}media/candidate_audio.mp3`,
      contentType: "audio/mpeg",
      durationSeconds,
    });
  }
  if (recording.transcriptKey) {
    artifacts.push({
      kind: "transcript",
      sourceKey: recording.transcriptKey,
      storagePath: `${root}transcripts/transcript.v1.json`,
      contentType: "application/json",
      durationSeconds: null,
    });
  }
  return artifacts;
}

function plannedSourceJsonCopies(
  recording: HistoricalFirefliesRecording,
  root: string,
): PlannedSourceJsonCopy[] {
  const copies: PlannedSourceJsonCopy[] = [];
  if (recording.metadataKey) {
    copies.push({
      sourceKey: recording.metadataKey,
      storagePath: `${root}source/fireflies/metadata.json`,
    });
  }
  if (recording.summaryKey) {
    copies.push({
      sourceKey: recording.summaryKey,
      storagePath: `${root}source/fireflies/summary.json`,
    });
  }
  if (recording.ingestionResultKey) {
    copies.push({
      sourceKey: recording.ingestionResultKey,
      storagePath: `${root}source/fireflies/ingestion-result.json`,
    });
  }
  return copies;
}

function artifactId(transcriptId: string, kind: HistoricalImportArtifactKind): string {
  return `hist_fireflies_${transcriptId}_${kind}`;
}

function storagePathToTargetKey(storagePath: string): string {
  return storagePath.replace(/^\/+/, "");
}

function candidateEmailFrom(metadata: JsonRecord, transcript: JsonRecord): string {
  return (
    stringValue(metadata.targetEmail) ??
    transcriptAttendeeEmail(transcript) ??
    "unknown-fireflies-candidate@example.invalid"
  );
}

function transcriptAttendeeEmail(transcript: JsonRecord): string | null {
  const attendees = Array.isArray(transcript.attendees) ? transcript.attendees : [];
  for (const attendee of attendees) {
    const email = stringValue(asRecord(attendee).email);
    if (email) return email;
  }
  return null;
}

function meetingStartedAtFrom(
  recording: HistoricalFirefliesRecording,
  metadata: JsonRecord,
  transcript: JsonRecord,
): string | null {
  return (
    firstString(metadata, ["meetingStartedAt", "meeting_start", "startTime", "started_at"]) ??
    firstString(transcript, ["date", "meetingStartTime"]) ??
    meetingDateStart(recording.meetingDate)
  );
}

function meetingDateStart(meetingDate: string | null): string | null {
  const value = stringValue(meetingDate);
  return value ? `${value}T00:00:00.000Z` : null;
}

function durationSecondsFrom(metadata: JsonRecord, transcript: JsonRecord): number | null {
  return firstNumber(metadata, ["durationSeconds", "duration_seconds"]) ??
    firstNumber(transcript, ["duration", "durationSeconds"]);
}

function endedAtFromDuration(startedAt: string | null, durationSeconds: number | null): string | null {
  if (!startedAt || durationSeconds === null) return null;
  const start = new Date(startedAt);
  const startMs = start.getTime();
  if (!Number.isFinite(startMs)) return null;
  return new Date(startMs + durationSeconds * 1000).toISOString();
}

function occurredAtFromOffset(startedAt: string | null, offsetMs: number | null): string | null {
  if (!startedAt || offsetMs === null) return null;
  const start = new Date(startedAt);
  const startMs = start.getTime();
  if (!Number.isFinite(startMs)) return null;
  return new Date(startMs + offsetMs).toISOString();
}

function sourceMetadata(input: HistoricalImportPlanInput): HistoricalImportSourceMetadata {
  return {
    fireflies: {
      transcriptId: input.recording.transcriptId,
      sourceOccurrenceId: historicalFirefliesSourceOccurrenceId(
        input.sourceBucket,
        input.recording.prefix,
      ),
      ownerEmail: input.recording.ownerEmail,
      meetingDate: input.recording.meetingDate,
      sourceBucket: input.sourceBucket,
      sourcePrefix: input.recording.prefix,
      targetBucket: input.targetBucket,
      matchStatus: input.weaveMatch ? input.weaveMatch.matchStatus : "unindexed",
      audioKey: input.recording.audioKey,
      videoKey: input.recording.videoKey,
      transcriptKey: input.recording.transcriptKey,
      metadataKey: input.recording.metadataKey,
      summaryKey: input.recording.summaryKey,
      ingestionResultKey: input.recording.ingestionResultKey,
    },
    ashby: {
      selected: selectedAshby(input.weaveMatch),
      matchCandidates: ashbyMatchCandidates(input.weaveMatchCandidates),
    },
    summary: input.summary,
    ingestion: input.ingestionResult,
  };
}

function selectedAshby(match: HistoricalWeaveMatch | null): HistoricalImportSelectedAshby | null {
  if (!match?.ashbyApplicationId) return null;
  return {
    candidateId: match.ashbyCandidateId,
    applicationId: match.ashbyApplicationId,
    jobId: match.ashbyJobId,
    candidateEvaluationId: match.candidateEvaluationId,
    decisionSource: match.decisionSource,
    decisionReason: match.decisionReason,
    decidedAt: match.decidedAt,
  };
}

function ashbyMatchCandidates(
  candidates: readonly HistoricalWeaveMatchCandidate[],
): HistoricalImportAshbyMatchCandidate[] {
  return [...candidates]
    .sort((left, right) => left.rank - right.rank || right.score - left.score)
    .map((candidate) => ({
      rank: candidate.rank,
      score: candidate.score,
      candidateId: candidate.ashbyCandidateId,
      applicationId: candidate.ashbyApplicationId,
      jobId: candidate.ashbyJobId,
      candidateEvaluationId: candidate.candidateEvaluationId,
      matchedEmail: candidate.matchedEmail,
      dateDeltaDays: candidate.dateDeltaDays,
      stageDeltaDays: candidate.stageDeltaDays,
      stageTitles: candidate.stageTitles,
      applicationActiveOnMeetingDate: candidate.applicationActiveOnMeetingDate,
      activeApplicationCount: candidate.activeApplicationCount,
      reasons: candidate.reasons,
    }));
}

function firstString(record: JsonRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return null;
}

function firstNumber(record: JsonRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = numberValue(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
