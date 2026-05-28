import type { FastifyInstance } from "fastify";
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

export function registerCandidateInviteRoutes(
  app: FastifyInstance,
  liveKitConfig: LiveKitConfig,
): void {
  app.post<{ Params: InviteParams }>("/candidate/invites/:token/join", async (request, reply) => {
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
  });
}
