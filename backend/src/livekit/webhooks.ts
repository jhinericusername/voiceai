import type { FastifyInstance } from "fastify";
import {
  EgressStatus,
  WebhookReceiver,
  type EgressInfo,
  type WebhookEvent,
} from "livekit-server-sdk";
import { getPool } from "../db/pool.js";
import { markReviewReadyIfArtifactsAvailable } from "../finalization/reviewReady.js";
import {
  liveKitRecordingsEnabledFromEnv,
  recordingStatusFromEgressStatus,
} from "./egress.js";
import { sessionIdFromRoomName, type LiveKitConfig } from "./provision.js";
import {
  recordingArtifactStatusUpdateStatement,
  recordingUpsertStatement,
  type RecordingStatus,
} from "../recordings/repository.js";
import { sessionStatusUpdateStatement } from "../scheduler/sessions.js";

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function bigintValue(value: bigint | number | undefined): bigint | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "bigint") {
    return value;
  }

  if (!Number.isFinite(value)) {
    return null;
  }

  return BigInt(Math.trunc(value));
}

export function liveKitTimestampToIso(value: bigint | number | undefined): string | null {
  const raw = bigintValue(value);
  if (!raw || raw <= 0n) {
    return null;
  }

  const milliseconds =
    raw > 10_000_000_000_000n
      ? Number(raw / 1_000_000n)
      : raw > 10_000_000_000n
        ? Number(raw)
        : Number(raw) * 1000;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function liveKitDurationSeconds(
  value: bigint | number | undefined,
): number | null {
  const raw = bigintValue(value);
  if (!raw || raw <= 0n) {
    return null;
  }

  const seconds = raw > 1_000_000_000n ? Number(raw) / 1_000_000_000 : Number(raw);
  return Math.round(seconds * 1000) / 1000;
}

export function recordingStatusForEgressEvent(
  eventName: WebhookEvent["event"],
  status: EgressStatus,
): RecordingStatus {
  const mapped = recordingStatusFromEgressStatus(status);
  if (eventName === "egress_started" && mapped !== "failed") {
    return "active";
  }
  if (eventName === "egress_ended" && mapped !== "failed") {
    return "complete";
  }
  return mapped;
}

function egressRoomName(info: EgressInfo): string | null {
  if (info.roomName) {
    return info.roomName;
  }
  if (info.request.case === "roomComposite") {
    return info.request.value.roomName || null;
  }
  return null;
}

export function sessionStatusForFinalizedEgress(
  status: RecordingStatus,
): "recording_finalizing" | "incomplete" | null {
  if (status === "complete") {
    return "recording_finalizing";
  }
  if (status === "failed") {
    return "incomplete";
  }
  return null;
}

const recordingFinalizingEligibleSessionStatuses = [
  "in_progress",
  "recording_finalizing",
] as const;

function sessionStatusUpdateForFinalizedEgress(
  sessionId: string,
  status: "recording_finalizing" | "incomplete",
  options: { readonly endedAt?: string } = {},
) {
  const stmt = sessionStatusUpdateStatement(sessionId, status, options);
  if (status !== "recording_finalizing") {
    return stmt;
  }

  return {
    sql: `${stmt.sql} AND status IN ($5, $6)`,
    params: [...stmt.params, ...recordingFinalizingEligibleSessionStatuses],
  };
}

async function persistEgressWebhook(event: WebhookEvent): Promise<boolean> {
  const info = event.egressInfo;
  if (!info) {
    return false;
  }

  const room = egressRoomName(info);
  const sessionId = room ? sessionIdFromRoomName(room) : null;
  if (!sessionId) {
    return false;
  }

  const status = recordingStatusForEgressEvent(event.event, info.status);
  const startedAt = liveKitTimestampToIso(info.startedAt);
  const endedAt =
    status === "complete" || status === "failed"
      ? liveKitTimestampToIso(info.endedAt) ?? new Date().toISOString()
      : null;
  const errorMessage = info.error || info.details || null;
  const pool = getPool();

  const recordingStmt = recordingUpsertStatement({
    sessionId,
    status,
    egressId: info.egressId || null,
    startedAt,
    endedAt,
    errorMessage,
  });
  await pool.query(recordingStmt.sql, [...recordingStmt.params]);

  if (status === "complete" || status === "failed") {
    const file = info.fileResults[0];
    const artifactStmt = recordingArtifactStatusUpdateStatement({
      sessionId,
      kind: "composite_video",
      status: status === "complete" ? "available" : "failed",
      sizeBytes: file?.size ? Number(file.size) : null,
      durationSeconds: liveKitDurationSeconds(file?.duration),
    });
    await pool.query(artifactStmt.sql, [...artifactStmt.params]);

    const finalizedSessionStatus = sessionStatusForFinalizedEgress(status);
    if (!finalizedSessionStatus) {
      return true;
    }

    const sessionStmt = sessionStatusUpdateForFinalizedEgress(sessionId, finalizedSessionStatus, {
      endedAt: endedAt ?? undefined,
    });
    const sessionResult = await pool.query(sessionStmt.sql, [...sessionStmt.params]);

    if (
      finalizedSessionStatus === "recording_finalizing" &&
      (sessionResult.rowCount ?? 0) > 0
    ) {
      await markReviewReadyIfArtifactsAvailable(sessionId, pool);
    }
  }

  return true;
}

export function registerLiveKitWebhookRoutes(
  app: FastifyInstance,
  liveKitConfig: LiveKitConfig,
): void {
  const receiver = new WebhookReceiver(liveKitConfig.apiKey, liveKitConfig.apiSecret);

  app.post<{ Body: string }>("/livekit/webhook", async (request, reply) => {
    const body =
      typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
    const authHeader =
      firstHeader(request.headers.authorization) ?? firstHeader(request.headers.authorize);

    let event: WebhookEvent;
    try {
      event = await receiver.receive(body, authHeader);
    } catch (error) {
      request.log.warn({ err: error }, "invalid LiveKit webhook");
      return reply.code(401).send({ error: "invalid webhook signature" });
    }

    const persisted =
      liveKitRecordingsEnabledFromEnv() &&
      (event.event === "egress_started" ||
        event.event === "egress_updated" ||
        event.event === "egress_ended")
        ? await persistEgressWebhook(event)
        : false;

    return reply.code(200).send({ ok: true, persisted });
  });
}
