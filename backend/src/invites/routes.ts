import type { FastifyInstance } from "fastify";
import {
  consentUpsertStatement,
  validateConsent,
  type ConsentInput,
} from "../consent/repository.js";
import { getPool } from "../db/pool.js";
import {
  liveKitEgressStorageConfigFromEnv,
  liveKitEgressWebhookUrlFromEnv,
  liveKitRecordingsEnabledFromEnv,
  recordingStatusFromEgressStatus,
  startRoomCompositeRecording,
  type RoomCompositeRecordingInput,
} from "../livekit/egress.js";
import { roomName, type LiveKitConfig } from "../livekit/provision.js";
import { buildCandidateJoinToken } from "../livekit/token.js";
import {
  recordingArtifactUpsertStatement,
  recordingBySessionStatement,
  recordingUpsertStatement,
  type RecordingRow,
  type RecordingStatus,
} from "../recordings/repository.js";
import { sessionStatusUpdateStatement } from "../scheduler/sessions.js";
import { storagePaths } from "../storage/layout.js";
import {
  findCandidateInviteByTokenStatement,
  isInviteUsable,
  markCandidateInviteUsedStatement,
  type CandidateInviteRow,
} from "./repository.js";

interface InviteParams {
  readonly token: string;
}

export interface CandidateJoinBody {
  readonly consent?: {
    readonly aiDisclosureAcknowledged?: boolean;
    readonly recordingConsented?: boolean;
    readonly dataUseAcknowledged?: boolean;
    readonly consentedAt?: string;
  };
}

type CandidateJoinConsent =
  | { readonly ok: true; readonly input: ConsentInput }
  | { readonly ok: false; readonly reason: string };

type RecordingStarter = (input: RoomCompositeRecordingInput) => ReturnType<
  typeof startRoomCompositeRecording
>;

const RECORDING_STARTED_STATUSES: readonly RecordingStatus[] = [
  "starting",
  "active",
  "complete",
];

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }
  return "failed to start LiveKit Egress recording";
}

function hasStartedRecording(recording: RecordingRow | undefined): boolean {
  return Boolean(
    recording?.egress_id && RECORDING_STARTED_STATUSES.includes(recording.status),
  );
}

export async function ensureSessionRecording(input: {
  readonly invite: CandidateInviteRow;
  readonly liveKitConfig: LiveKitConfig;
  readonly room: string;
  readonly now?: Date;
  readonly env?: NodeJS.ProcessEnv;
  readonly startRecording?: RecordingStarter;
}): Promise<void> {
  if (!liveKitRecordingsEnabledFromEnv(input.env)) {
    return;
  }

  const pool = getPool();
  const existingStmt = recordingBySessionStatement(input.invite.session_id);
  const existing = await pool.query<RecordingRow>(existingStmt.sql, [
    ...existingStmt.params,
  ]);
  if (hasStartedRecording(existing.rows[0])) {
    return;
  }

  const startedAt = (input.now ?? new Date()).toISOString();
  const storagePath = storagePaths(input.invite.org_id, input.invite.session_id).media
    .composite;
  const artifactStmt = recordingArtifactUpsertStatement({
    sessionId: input.invite.session_id,
    kind: "composite_video",
    storagePath,
    contentType: "video/mp4",
    status: "expected",
  });
  await pool.query(artifactStmt.sql, [...artifactStmt.params]);

  const startingStmt = recordingUpsertStatement({
    sessionId: input.invite.session_id,
    status: "starting",
    startedAt,
  });
  await pool.query(startingStmt.sql, [...startingStmt.params]);

  try {
    const info = await (input.startRecording ?? startRoomCompositeRecording)({
      liveKitConfig: input.liveKitConfig,
      storageConfig: liveKitEgressStorageConfigFromEnv(input.env),
      room: input.room,
      storagePath,
      webhookUrl: liveKitEgressWebhookUrlFromEnv(input.env),
    });
    if (!info.egressId) {
      throw new Error("LiveKit Egress did not return an egress id");
    }

    const recordingStatus = recordingStatusFromEgressStatus(info.status);
    if (recordingStatus === "failed") {
      const failedStmt = recordingUpsertStatement({
        sessionId: input.invite.session_id,
        status: "failed",
        egressId: info.egressId,
        startedAt,
        errorMessage: "LiveKit Egress returned failed status",
      });
      await pool.query(failedStmt.sql, [...failedStmt.params]);
      throw new Error("LiveKit Egress returned failed status");
    }

    const activeStmt = recordingUpsertStatement({
      sessionId: input.invite.session_id,
      status: recordingStatus,
      egressId: info.egressId,
      startedAt,
    });
    await pool.query(activeStmt.sql, [...activeStmt.params]);
  } catch (error) {
    const failedStmt = recordingUpsertStatement({
      sessionId: input.invite.session_id,
      status: "failed",
      startedAt,
      errorMessage: errorMessage(error),
    });
    await pool.query(failedStmt.sql, [...failedStmt.params]);
    throw error;
  }
}

export function consentInputFromCandidateJoin(
  invite: CandidateInviteRow,
  body: CandidateJoinBody | undefined,
  now = new Date(),
): CandidateJoinConsent {
  const consent = body?.consent;
  if (!consent?.dataUseAcknowledged) {
    return { ok: false, reason: "data-use acknowledgement is required" };
  }

  const input: ConsentInput = {
    sessionId: invite.session_id,
    candidateEmail: invite.candidate_email,
    aiDisclosureAcknowledged: consent.aiDisclosureAcknowledged === true,
    recordingConsented: consent.recordingConsented === true,
    consentedAt: consent.consentedAt ?? now.toISOString(),
  };
  const validation = validateConsent(input);
  return validation.ok ? { ok: true, input } : validation;
}

export function registerCandidateInviteRoutes(
  app: FastifyInstance,
  liveKitConfig: LiveKitConfig,
  startRecording: RecordingStarter = startRoomCompositeRecording,
): void {
  app.post<{ Params: InviteParams; Body: CandidateJoinBody }>(
    "/candidate/invites/:token/join",
    async (request, reply) => {
      const rawToken = request.params.token?.trim();
      if (!rawToken) {
        return reply.code(400).send({ error: "missing invite token" });
      }

      const stmt = findCandidateInviteByTokenStatement(rawToken);
      const { rows } = await getPool().query<CandidateInviteRow>(stmt.sql, [...stmt.params]);
      const invite = rows[0];
      if (!invite) {
        return reply.code(404).send({ error: "invite not found" });
      }

      const usability = isInviteUsable(invite);
      if (!usability.ok) {
        return reply.code(410).send({ error: `invite ${usability.reason}` });
      }

      const consentInput = consentInputFromCandidateJoin(invite, request.body);
      if (!consentInput.ok) {
        return reply.code(400).send({ error: consentInput.reason });
      }

      const consentStmt = consentUpsertStatement(consentInput.input);
      await getPool().query(consentStmt.sql, [...consentStmt.params]);

      const room = roomName(invite.session_id);
      const recordingsEnabled = liveKitRecordingsEnabledFromEnv();
      try {
        await ensureSessionRecording({
          invite,
          liveKitConfig,
          room,
          startRecording,
        });
      } catch (error) {
        request.log.error({ err: error, sessionId: invite.session_id }, "recording start failed");
        return reply.code(503).send({
          error: "recording could not be started; please try again shortly",
        });
      }

      const statusStmt = sessionStatusUpdateStatement(invite.session_id, "in_progress", {
        startedAt: consentInput.input.consentedAt,
        includeTimelineColumns: recordingsEnabled,
      });
      await getPool().query(statusStmt.sql, [...statusStmt.params]);

      const token = await buildCandidateJoinToken(liveKitConfig, {
        sessionId: invite.session_id,
        room,
        inviteId: invite.invite_id,
        candidateEmail: invite.candidate_email,
      });

      const markUsed = markCandidateInviteUsedStatement(invite.invite_id);
      await getPool().query(markUsed.sql, [...markUsed.params]);

      return reply.code(200).send({
        sessionId: invite.session_id,
        room,
        liveKitUrl: liveKitConfig.host,
        token,
      });
    },
  );
}
