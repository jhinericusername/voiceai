import type { FastifyInstance } from "fastify";
import {
  consentUpsertStatement,
  validateConsent,
  type ConsentInput,
} from "../consent/repository.js";
import { getPool } from "../db/pool.js";
import { roomName, type LiveKitConfig } from "../livekit/provision.js";
import { buildCandidateJoinToken } from "../livekit/token.js";
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
