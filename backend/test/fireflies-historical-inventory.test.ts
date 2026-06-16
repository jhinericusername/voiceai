import { describe, expect, it } from "vitest";
import {
  buildHistoricalFirefliesInventory,
  parseHistoricalFirefliesKey,
} from "../src/weave/fireflies/historicalInventory.js";

const keys = [
  "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/audio.mp3",
  "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/video.mp4",
  "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/transcript.json",
  "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/metadata.json",
  "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/summary.json",
  "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/ingestion-result.json",
];

describe("Fireflies historical S3 inventory", () => {
  it("parses owner, meeting date, transcript ID, and filename from a key", () => {
    const parsed = parseHistoricalFirefliesKey(keys[0]);

    expect(parsed).toEqual({
      ownerEmail: "prakul@workweave.ai",
      meetingDate: "2026-04-09",
      transcriptId: "01ABC",
      fileName: "audio.mp3",
    });
  });

  it("groups S3 objects into one recording folder per prefix", () => {
    const inventory = buildHistoricalFirefliesInventory(keys);

    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toMatchObject({
      transcriptId: "01ABC",
      ownerEmail: "prakul@workweave.ai",
      meetingDate: "2026-04-09",
      prefix:
        "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/",
      metadataKey:
        "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/metadata.json",
      summaryKey:
        "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/summary.json",
      ingestionResultKey:
        "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/ingestion-result.json",
      objectCount: 6,
    });
    expect(inventory[0]?.audioKey).toContain("audio.mp3");
    expect(inventory[0]?.videoKey).toContain("video.mp4");
    expect(inventory[0]?.transcriptKey).toContain("transcript.json");
  });

  it("uses a configured source prefix when grouping Fireflies recording folders", () => {
    const inventory = buildHistoricalFirefliesInventory(
      [
        "archive/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/audio.mp3",
        "archive/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/transcript.json",
        "raw/fireflies/owner=other@workweave.ai/year=2026/month=04/day=09/transcript_id=02DEF/audio.mp3",
      ],
      "archive/fireflies/",
    );

    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toMatchObject({
      transcriptId: "01ABC",
      prefix:
        "archive/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/",
      audioKey:
        "archive/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/audio.mp3",
      transcriptKey:
        "archive/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/transcript.json",
      objectCount: 2,
    });
  });

  it("detects recording folders that are missing video", () => {
    const inventory = buildHistoricalFirefliesInventory([
      "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/audio.mp3",
      "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/transcript.json",
    ]);

    expect(inventory).toHaveLength(1);
    expect(inventory[0]?.videoKey).toBeNull();
    expect(inventory[0]?.audioKey).toContain("audio.mp3");
    expect(inventory[0]?.transcriptKey).toContain("transcript.json");
  });

  it("counts recording folders rather than S3 object count", () => {
    const inventory = buildHistoricalFirefliesInventory([
      ...keys,
      "raw/fireflies/owner=other@workweave.ai/year=2026/month=04/day=10/transcript_id=02DEF/audio.m4a",
      "raw/fireflies/owner=other@workweave.ai/year=2026/month=04/day=10/transcript_id=02DEF/video.webm",
      "raw/fireflies/owner=other@workweave.ai/year=2026/month=04/day=10/transcript_id=02DEF/transcript.json",
    ]);

    expect(inventory).toHaveLength(2);
    expect(inventory.map((recording) => recording.transcriptId)).toEqual(["01ABC", "02DEF"]);
    expect(inventory.map((recording) => recording.objectCount)).toEqual([6, 3]);
  });

  it("keeps distinct recording folders separate when they share a transcript ID", () => {
    const inventory = buildHistoricalFirefliesInventory([
      "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/audio.mp3",
      "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/video.mp4",
      "raw/fireflies/owner=other@workweave.ai/year=2026/month=04/day=10/transcript_id=01ABC/audio.m4a",
      "raw/fireflies/owner=other@workweave.ai/year=2026/month=04/day=10/transcript_id=01ABC/transcript.json",
    ]);

    expect(inventory).toHaveLength(2);
    expect(inventory.map((recording) => recording.prefix)).toEqual([
      "raw/fireflies/owner=other@workweave.ai/year=2026/month=04/day=10/transcript_id=01ABC/",
      "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/",
    ]);
    expect(inventory.map((recording) => recording.transcriptId)).toEqual(["01ABC", "01ABC"]);
    expect(inventory.map((recording) => recording.objectCount)).toEqual([2, 2]);
    expect(inventory[0]?.ownerEmail).toBe("other@workweave.ai");
    expect(inventory[0]?.videoKey).toBeNull();
    expect(inventory[1]?.ownerEmail).toBe("prakul@workweave.ai");
    expect(inventory[1]?.videoKey).toContain("video.mp4");
  });

  it("ignores keys outside the expected raw Fireflies transcript folder shape", () => {
    const inventory = buildHistoricalFirefliesInventory([
      "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/audio.mp3",
      "archive/raw/fireflies/owner=other@workweave.ai/year=2026/month=04/day=10/transcript_id=ARCHIVE/audio.mp3",
      "raw/other/owner=other@workweave.ai/year=2026/month=04/day=10/transcript_id=OTHER/audio.mp3",
      "raw/fireflies/owner=other@workweave.ai/year=2026/month=04/day=10/no_transcript_id/audio.mp3",
      "raw/fireflies/owner=other@workweave.ai/year=2026/month=04/day=10/transcript_id=NO_FILE",
    ]);

    expect(parseHistoricalFirefliesKey("raw/other/transcript_id=OTHER/audio.mp3")).toEqual({
      ownerEmail: null,
      meetingDate: null,
      transcriptId: null,
      fileName: null,
    });
    expect(inventory).toHaveLength(1);
    expect(inventory[0]?.transcriptId).toBe("01ABC");
  });

  it("groups nested objects under the transcript folder root prefix", () => {
    const inventory = buildHistoricalFirefliesInventory([
      "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/media/audio.mp3",
      "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/metadata.json",
    ]);

    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toMatchObject({
      transcriptId: "01ABC",
      prefix:
        "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/",
      audioKey:
        "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/media/audio.mp3",
      metadataKey:
        "raw/fireflies/owner=prakul@workweave.ai/year=2026/month=04/day=09/transcript_id=01ABC/metadata.json",
      objectCount: 2,
    });
  });
});
