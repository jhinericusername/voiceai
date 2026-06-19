import { createHash } from "node:crypto";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessToken, EgressStatus, EncodedFileType } from "livekit-server-sdk";
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
  registerLiveKitWebhookRoutes,
  sessionStatusForFinalizedEgress,
} from "../src/livekit/webhooks.js";
import {
  ensureRoomReady,
  liveKitApiUrl,
  roomName,
  sessionIdFromRoomName,
} from "../src/livekit/provision.js";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("../src/db/pool.js", () => ({
  getPool: () => ({ query: queryMock }),
}));

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

const liveKitConfig = {
  host: "wss://livekit.example",
  apiKey: "key",
  apiSecret: "secret",
};

async function signedWebhookAuth(body: string): Promise<string> {
  const token = new AccessToken(liveKitConfig.apiKey, liveKitConfig.apiSecret);
  token.sha256 = createHash("sha256").update(body).digest("base64");
  return token.toJwt();
}

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

describe("LiveKit Egress finalization status decision", () => {
  it("marks completed egress finalizing and failed egress incomplete", () => {
    expect(sessionStatusForFinalizedEgress("complete")).toBe("recording_finalizing");
    expect(sessionStatusForFinalizedEgress("failed")).toBe("incomplete");
    expect(sessionStatusForFinalizedEgress("active")).toBeNull();
  });
});

describe("LiveKit Egress webhook persistence", () => {
  it("does not move an already incomplete session back to recording_finalizing after successful egress", async () => {
    const previousRecordingsEnabled = process.env.PUDDLE_RECORDINGS_ENABLED;
    process.env.PUDDLE_RECORDINGS_ENABLED = "true";
    let sessionStatus = "incomplete";
    queryMock.mockImplementation(async (sql: unknown, params: readonly unknown[] = []) => {
      const sqlText = String(sql);
      if (sqlText.includes("UPDATE sessions SET status = $2")) {
        if (!sqlText.includes("status IN")) {
          sessionStatus = String(params[1]);
          return { rows: [], rowCount: 1 };
        }
        const eligibleStatuses = params.slice(4).map(String);
        if (eligibleStatuses.includes(sessionStatus)) {
          sessionStatus = String(params[1]);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sqlText.includes("SELECT kind, status FROM recording_artifacts")) {
        return {
          rows: [
            { kind: "composite_video", status: "available" },
            { kind: "transcript", status: "available" },
            { kind: "scores", status: "available" },
            { kind: "integrity_flags", status: "available" },
            { kind: "agent_events", status: "available" },
          ],
          rowCount: 5,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    const app = Fastify();
    registerLiveKitWebhookRoutes(app, liveKitConfig);
    const payload = {
      event: "egress_ended",
      egressInfo: {
        egressId: "egress1",
        roomName: "interview-session-1",
        status: "EGRESS_COMPLETE",
        startedAt: "1778932700000000000",
        endedAt: "1778932800000000000",
        fileResults: [
          {
            filename: "composite.mp4",
            size: "123456",
            duration: "90500000000",
          },
        ],
      },
    };
    const body = JSON.stringify(payload);

    try {
      const res = await app.inject({
        method: "POST",
        url: "/livekit/webhook",
        headers: {
          authorization: await signedWebhookAuth(body),
          "content-type": "application/json",
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, persisted: true });
      expect(sessionStatus).toBe("incomplete");
      const sessionUpdate = queryMock.mock.calls.find(([sql]) =>
        String(sql).includes("UPDATE sessions SET status = $2"),
      );
      expect(sessionUpdate).toBeDefined();
      expect(String(sessionUpdate?.[0])).toContain("status IN");
      expect(
        queryMock.mock.calls.some(([sql]) =>
          String(sql).includes("SELECT kind, status FROM recording_artifacts"),
        ),
      ).toBe(false);
    } finally {
      if (previousRecordingsEnabled === undefined) {
        delete process.env.PUDDLE_RECORDINGS_ENABLED;
      } else {
        process.env.PUDDLE_RECORDINGS_ENABLED = previousRecordingsEnabled;
      }
      await app.close();
    }
  });
});

describe("LiveKit room readiness", () => {

  it("normalizes websocket hosts for LiveKit server API clients", () => {
    expect(liveKitApiUrl("wss://livekit.example")).toBe("https://livekit.example");
    expect(liveKitApiUrl("ws://localhost:7880")).toBe("http://localhost:7880");
    expect(liveKitApiUrl("https://livekit.example")).toBe("https://livekit.example");
  });

  it("creates a missing room and dispatches the interviewer on candidate join", async () => {
    const createdRooms: unknown[] = [];
    const createdDispatches: unknown[] = [];
    const rooms = {
      listRooms: async () => [],
      createRoom: async (options: unknown) => {
        createdRooms.push(options);
      },
    };
    const dispatch = {
      listDispatch: async () => [],
      createDispatch: async (room: string, agentName: string, options: unknown) => {
        createdDispatches.push({ room, agentName, options });
      },
    };

    const result = await ensureRoomReady(liveKitConfig, "sess1", "{\"session_id\":\"sess1\"}", {
      rooms,
      dispatch,
    });

    expect(result).toEqual({
      room: "interview-sess1",
      roomCreated: true,
      dispatchCreated: true,
      roomRecreated: false,
    });
    expect(createdRooms).toEqual([
      {
        name: "interview-sess1",
        emptyTimeout: 600,
        departureTimeout: 300,
        maxParticipants: 8,
      },
    ]);
    expect(createdDispatches).toEqual([
      {
        room: "interview-sess1",
        agentName: "puddle-interviewer",
        options: { metadata: "{\"session_id\":\"sess1\"}" },
      },
    ]);
  });

  it("can prepare an interviewer-led room without dispatching the AI interviewer", async () => {
    const createdRooms: unknown[] = [];
    const createdDispatches: unknown[] = [];
    const rooms = {
      listRooms: async () => [],
      createRoom: async (options: unknown) => {
        createdRooms.push(options);
      },
    };
    const dispatch = {
      listDispatch: async () => {
        throw new Error("should not list dispatches");
      },
      createDispatch: async (room: string, agentName: string, options: unknown) => {
        createdDispatches.push({ room, agentName, options });
      },
    };

    const result = await ensureRoomReady(liveKitConfig, "sess1", "{\"session_id\":\"sess1\"}", {
      rooms,
      dispatch,
      dispatchAgent: false,
    });

    expect(result).toEqual({
      room: "interview-sess1",
      roomCreated: true,
      dispatchCreated: false,
      roomRecreated: false,
    });
    expect(createdRooms).toHaveLength(1);
    expect(createdDispatches).toEqual([]);
  });

  it("recreates an expired prior room and records that as a recreation", async () => {
    const rooms = {
      listRooms: async () => [],
      createRoom: async () => undefined,
    };
    const dispatch = {
      listDispatch: async () => [{ agentName: "other-agent" }],
      createDispatch: async () => undefined,
    };

    const result = await ensureRoomReady(liveKitConfig, "sess1", "{}", {
      hadPreviousRoom: true,
      rooms,
      dispatch,
    });

    expect(result.roomCreated).toBe(true);
    expect(result.dispatchCreated).toBe(true);
    expect(result.roomRecreated).toBe(true);
  });

  it("leaves an active room and existing interviewer dispatch alone", async () => {
    const rooms = {
      listRooms: async () => [{ name: "interview-sess1" }],
      createRoom: async () => {
        throw new Error("should not create room");
      },
    };
    const dispatch = {
      listDispatch: async () => [{ agentName: "puddle-interviewer" }],
      createDispatch: async () => {
        throw new Error("should not create dispatch");
      },
    };

    const result = await ensureRoomReady(liveKitConfig, "sess1", "{}", {
      hadPreviousRoom: true,
      rooms,
      dispatch,
    });

    expect(result).toEqual({
      room: "interview-sess1",
      roomCreated: false,
      dispatchCreated: false,
      roomRecreated: false,
    });
  });
});
