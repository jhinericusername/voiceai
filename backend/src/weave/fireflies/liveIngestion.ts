import type {
  ExecuteHistoricalFirefliesImportInput,
  PuddleDb,
  S3LikeClient,
} from "./historicalImportExecutor.js";
import type { HistoricalFirefliesRecording } from "./historicalInventory.js";
import type { Queryable } from "./historicalWeaveMatches.js";

export interface FirefliesRecordingReadiness {
  readonly ready: boolean;
  readonly missingRequiredKinds: readonly string[];
}

export interface SingleRecordingImportInputOptions {
  readonly orgId: string;
  readonly sourceBucket: string;
  readonly sourceRegion: string;
  readonly sourceRootPrefix: string;
  readonly recordingPrefix: string;
  readonly targetBucket: string;
  readonly targetRegion: string;
  readonly sourceS3: S3LikeClient;
  readonly targetS3: S3LikeClient;
  readonly weaveDb: Queryable;
  readonly puddleDb: PuddleDb;
}

export type SingleRecordingImportInput = ExecuteHistoricalFirefliesImportInput & {
  readonly sourceRootPrefix: string;
};

export function firefliesRecordingPrefixFromKey(
  key: string,
  sourceRootPrefix: string,
): string | null {
  const root = normalizedPrefix(sourceRootPrefix);
  if (!key.startsWith(root)) return null;
  const match = key.match(
    new RegExp(`^(${escapeRegExp(root)}(?:[^/]+/)*transcript_id=[^/]+/).+`),
  );
  return match?.[1] ?? null;
}

export function firefliesRecordingReadiness(
  recording: HistoricalFirefliesRecording,
): FirefliesRecordingReadiness {
  const missingRequiredKinds: string[] = [];
  if (!recording.metadataKey) missingRequiredKinds.push("metadata");
  if (!recording.transcriptKey) missingRequiredKinds.push("transcript");
  if (!recording.audioKey) missingRequiredKinds.push("audio");
  return {
    ready: missingRequiredKinds.length === 0,
    missingRequiredKinds,
  };
}

export function buildSingleRecordingImportInput(
  options: SingleRecordingImportInputOptions,
): SingleRecordingImportInput {
  return {
    mode: "apply",
    orgId: options.orgId,
    sourceBucket: options.sourceBucket,
    sourcePrefix: normalizedPrefix(options.recordingPrefix),
    sourceRootPrefix: normalizedPrefix(options.sourceRootPrefix),
    targetBucket: options.targetBucket,
    sourceS3: options.sourceS3,
    targetS3: options.targetS3,
    weaveDb: options.weaveDb,
    puddleDb: options.puddleDb,
    batchSize: 1,
  };
}

function normalizedPrefix(prefix: string): string {
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
