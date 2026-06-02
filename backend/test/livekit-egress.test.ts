import { describe, expect, it } from "vitest";
import { EgressStatus, EncodedFileType } from "livekit-server-sdk";
import {
  buildRoomCompositeFileOutput,
  liveKitEgressStorageConfigFromEnv,
  liveKitRecordingsEnabledFromEnv,
  recordingStatusFromEgressStatus,
  s3KeyFromStoragePath,
} from "../src/livekit/egress.js";
import {
  liveKitDurationSeconds,
  liveKitTimestampToIso,
  recordingStatusForEgressEvent,
} from "../src/livekit/webhooks.js";
import { roomName, sessionIdFromRoomName } from "../src/livekit/provision.js";

describe("LiveKit Egress output configuration", () => {
  it("keeps recordings disabled unless explicitly enabled", () => {
    expect(liveKitRecordingsEnabledFromEnv({})).toBe(false);
    expect(
      liveKitRecordingsEnabledFromEnv({ PUDDLE_RECORDINGS_ENABLED: "false" }),
    ).toBe(false);
    expect(liveKitRecordingsEnabledFromEnv({ PUDDLE_RECORDINGS_ENABLED: "true" })).toBe(
      true,
    );
  });

  it("reads S3 output settings from env", () => {
    const config = liveKitEgressStorageConfigFromEnv({
      PUDDLE_ARTIFACTS_BUCKET: "puddle-artifacts",
      AWS_REGION: "us-east-1",
      PUDDLE_EGRESS_S3_ACCESS_KEY_ID: "access-key-id",
      PUDDLE_EGRESS_S3_SECRET_ACCESS_KEY: "secret-access-key",
      PUDDLE_EGRESS_S3_ASSUME_ROLE_ARN:
        "arn:aws:iam::111111111111:role/puddle-livekit-egress-upload-role",
      PUDDLE_EGRESS_S3_ASSUME_ROLE_EXTERNAL_ID: "external-id",
    });

    expect(config).toEqual({
      bucket: "puddle-artifacts",
      region: "us-east-1",
      accessKeyId: "access-key-id",
      secretAccessKey: "secret-access-key",
      sessionToken: undefined,
      assumeRoleArn: "arn:aws:iam::111111111111:role/puddle-livekit-egress-upload-role",
      assumeRoleExternalId: "external-id",
      endpoint: undefined,
      forcePathStyle: undefined,
    });
  });

  it("builds an MP4 room composite output using the persisted storage path", () => {
    const output = buildRoomCompositeFileOutput(
      {
        bucket: "puddle-artifacts",
        region: "us-east-1",
        accessKeyId: "access-key-id",
        secretAccessKey: "secret-access-key",
        assumeRoleArn: "arn:aws:iam::111111111111:role/puddle-livekit-egress-upload-role",
        assumeRoleExternalId: "external-id",
      },
      "/org1/interviews/sess1/media/composite.mp4",
    );

    expect(s3KeyFromStoragePath("/org1/interviews/sess1/media/composite.mp4")).toBe(
      "org1/interviews/sess1/media/composite.mp4",
    );
    expect(output.fileType).toBe(EncodedFileType.MP4);
    expect(output.filepath).toBe("org1/interviews/sess1/media/composite.mp4");
    expect(output.output.case).toBe("s3");
    if (output.output.case === "s3") {
      expect(output.output.value.bucket).toBe("puddle-artifacts");
      expect(output.output.value.region).toBe("us-east-1");
      expect(output.output.value.accessKey).toBe("access-key-id");
      expect(output.output.value.secret).toBe("secret-access-key");
      expect(output.output.value.assumeRoleArn).toBe(
        "arn:aws:iam::111111111111:role/puddle-livekit-egress-upload-role",
      );
      expect(output.output.value.assumeRoleExternalId).toBe("external-id");
    }
  });

  it("does not send an assume-role external id without an assume-role ARN", () => {
    const output = buildRoomCompositeFileOutput(
      {
        bucket: "puddle-artifacts",
        region: "us-east-1",
        accessKeyId: "access-key-id",
        secretAccessKey: "secret-access-key",
        assumeRoleExternalId: "external-id",
      },
      "org1/interviews/sess1/media/composite.mp4",
    );

    expect(output.output.case).toBe("s3");
    if (output.output.case === "s3") {
      expect(output.output.value.assumeRoleArn).toBe("");
      expect(output.output.value.assumeRoleExternalId).toBe("");
    }
  });
});

describe("LiveKit Egress webhook mapping", () => {
  it("maps room names back to session ids", () => {
    expect(roomName("sess1")).toBe("interview-sess1");
    expect(sessionIdFromRoomName("interview-sess1")).toBe("sess1");
    expect(sessionIdFromRoomName("other-sess1")).toBeNull();
  });

  it("maps egress statuses into recording lifecycle states", () => {
    expect(recordingStatusFromEgressStatus(EgressStatus.EGRESS_STARTING)).toBe(
      "starting",
    );
    expect(recordingStatusFromEgressStatus(EgressStatus.EGRESS_ACTIVE)).toBe("active");
    expect(recordingStatusFromEgressStatus(EgressStatus.EGRESS_COMPLETE)).toBe(
      "complete",
    );
    expect(recordingStatusFromEgressStatus(EgressStatus.EGRESS_FAILED)).toBe("failed");
    expect(
      recordingStatusForEgressEvent("egress_started", EgressStatus.EGRESS_STARTING),
    ).toBe("active");
    expect(
      recordingStatusForEgressEvent("egress_ended", EgressStatus.EGRESS_ACTIVE),
    ).toBe("complete");
  });

  it("converts LiveKit nanosecond timestamps and durations for persistence", () => {
    expect(liveKitTimestampToIso(1_778_932_800_000_000_000n)).toBe(
      "2026-05-16T12:00:00.000Z",
    );
    expect(liveKitDurationSeconds(90_500_000_000n)).toBe(90.5);
  });
});
