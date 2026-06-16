import { describe, expect, it } from "vitest";
import {
  buildSingleRecordingImportInput,
  firefliesRecordingPrefixFromKey,
  firefliesRecordingReadiness,
} from "../src/weave/fireflies/liveIngestion.js";
import type { HistoricalFirefliesRecording } from "../src/weave/fireflies/historicalInventory.js";

const orgId = "org_01KV4FF7KX24B76H7Q57QVB5CT";
const sourceRootPrefix = "raw/fireflies/";
const recordingPrefix =
  "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=06/day=16/transcript_id=01LIVE/";

function recording(overrides: Partial<HistoricalFirefliesRecording> = {}): HistoricalFirefliesRecording {
  return {
    transcriptId: "01LIVE",
    ownerEmail: "prakul@workweave.ai",
    meetingDate: "2026-06-16",
    prefix: recordingPrefix,
    audioKey: `${recordingPrefix}audio.mp3`,
    videoKey: `${recordingPrefix}video.mp4`,
    transcriptKey: `${recordingPrefix}transcript.json`,
    metadataKey: `${recordingPrefix}metadata.json`,
    summaryKey: `${recordingPrefix}summary.json`,
    ingestionResultKey: `${recordingPrefix}ingestion-result.json`,
    objectCount: 6,
    ...overrides,
  };
}

describe("Fireflies live S3 ingestion helpers", () => {
  it("derives the recording folder prefix from an object key", () => {
    expect(
      firefliesRecordingPrefixFromKey(`${recordingPrefix}metadata.json`, sourceRootPrefix),
    ).toBe(recordingPrefix);
    expect(
      firefliesRecordingPrefixFromKey(`${recordingPrefix}nested/transcript.json`, sourceRootPrefix),
    ).toBe(recordingPrefix);
  });

  it("ignores keys outside the configured Fireflies recording layout", () => {
    expect(firefliesRecordingPrefixFromKey(`${recordingPrefix}metadata.json`, "archive/fireflies/")).toBeNull();
    expect(
      firefliesRecordingPrefixFromKey("raw/fireflies/owner=prakul/no_transcript_id/metadata.json", sourceRootPrefix),
    ).toBeNull();
    expect(firefliesRecordingPrefixFromKey("raw/fireflies/transcript_id=01LIVE", sourceRootPrefix)).toBeNull();
  });

  it("requires transcript, metadata, and audio before importing a folder", () => {
    expect(firefliesRecordingReadiness(recording())).toEqual({
      ready: true,
      missingRequiredKinds: [],
    });
    expect(firefliesRecordingReadiness(recording({ videoKey: null }))).toEqual({
      ready: true,
      missingRequiredKinds: [],
    });
    expect(firefliesRecordingReadiness(recording({ summaryKey: null, ingestionResultKey: null }))).toEqual({
      ready: true,
      missingRequiredKinds: [],
    });
    expect(firefliesRecordingReadiness(recording({ audioKey: null }))).toEqual({
      ready: false,
      missingRequiredKinds: ["audio"],
    });
    expect(firefliesRecordingReadiness(recording({ transcriptKey: null, metadataKey: null }))).toEqual({
      ready: false,
      missingRequiredKinds: ["metadata", "transcript"],
    });
  });

  it("builds a single-folder import input that preserves the historical Fireflies root", () => {
    const input = buildSingleRecordingImportInput({
      orgId,
      sourceBucket: "weave-fireflies-prod",
      sourceRegion: "us-west-2",
      sourceRootPrefix,
      recordingPrefix,
      targetBucket: "puddle-artifacts",
      targetRegion: "us-west-1",
      sourceS3: { send: async () => ({}) },
      targetS3: { send: async () => ({}) },
      weaveDb: { query: async () => ({ rows: [] }) },
      puddleDb: {
        query: async () => ({ rows: [] }),
        connect: async () => {
          throw new Error("unused");
        },
      },
    });

    expect(input).toMatchObject({
      mode: "apply",
      orgId,
      sourceBucket: "weave-fireflies-prod",
      sourcePrefix: recordingPrefix,
      sourceRootPrefix,
      targetBucket: "puddle-artifacts",
      batchSize: 1,
    });
  });
});
