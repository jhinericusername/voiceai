import { describe, expect, it, vi } from "vitest";
import {
  artifactS3Key,
  putJsonArtifact,
  putJsonLinesArtifact,
  signedArtifactUrl,
  type S3LikeClient,
} from "../src/storage/artifactStore.js";

describe("artifactStore", () => {
  it("normalizes storage paths into S3 keys", () => {
    expect(artifactS3Key("/org/interviews/sess/media/composite.mp4")).toBe(
      "org/interviews/sess/media/composite.mp4",
    );
    expect(artifactS3Key("org/interviews/sess/transcripts/transcript.v1.json")).toBe(
      "org/interviews/sess/transcripts/transcript.v1.json",
    );
  });

  it("writes JSON artifacts with stable formatting", async () => {
    const send = vi.fn(async () => ({}));
    const client: S3LikeClient = { send };

    await putJsonArtifact(client, {
      bucket: "puddle-artifacts",
      storagePath: "/org/interviews/sess/transcripts/transcript.v1.json",
      body: { version: "v1", turns: [] },
    });

    const command = send.mock.calls[0]?.[0] as { input?: Record<string, unknown> };
    expect(command.input?.Bucket).toBe("puddle-artifacts");
    expect(command.input?.Key).toBe("org/interviews/sess/transcripts/transcript.v1.json");
    expect(command.input?.ContentType).toBe("application/json");
    expect(command.input?.Body).toBe('{\n  "version": "v1",\n  "turns": []\n}\n');
  });

  it("writes JSONL artifacts with one JSON object per line", async () => {
    const send = vi.fn(async () => ({}));
    const client: S3LikeClient = { send };

    await putJsonLinesArtifact(client, {
      bucket: "puddle-artifacts",
      storagePath: "/org/interviews/sess/events/agent_events.jsonl",
      rows: [{ event: "intro" }, { event: "closing" }],
    });

    const command = send.mock.calls[0]?.[0] as { input?: Record<string, unknown> };
    expect(command.input?.ContentType).toBe("application/x-ndjson");
    expect(command.input?.Body).toBe('{"event":"intro"}\n{"event":"closing"}\n');
  });

  it("delegates signed URL generation to the injected signer", async () => {
    const client: S3LikeClient = { send: async () => ({}) };
    const signer = vi.fn(async () => "https://signed.example/video.mp4");

    const url = await signedArtifactUrl(client, signer, {
      bucket: "puddle-artifacts",
      storagePath: "/org/interviews/sess/media/composite.mp4",
      expiresInSeconds: 900,
    });

    expect(url).toBe("https://signed.example/video.mp4");
    expect(signer).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: "puddle-artifacts",
          Key: "org/interviews/sess/media/composite.mp4",
        }),
      }),
      { expiresIn: 900 },
    );
  });
});
