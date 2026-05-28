import { AccessToken } from "livekit-server-sdk";
import type { LiveKitConfig } from "./provision.js";

const DEFAULT_JOIN_TOKEN_TTL_SECONDS = 15 * 60;

export interface CandidateTokenInput {
  readonly sessionId: string;
  readonly room: string;
  readonly inviteId: string;
  readonly candidateEmail: string;
  readonly ttlSeconds?: number;
}

export async function buildCandidateJoinToken(
  config: LiveKitConfig,
  input: CandidateTokenInput,
): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: `candidate-${input.inviteId}`,
    name: input.candidateEmail,
    ttl: input.ttlSeconds ?? DEFAULT_JOIN_TOKEN_TTL_SECONDS,
    metadata: JSON.stringify({
      session_id: input.sessionId,
      invite_id: input.inviteId,
      participant_kind: "candidate",
    }),
  });

  token.addGrant({
    roomJoin: true,
    room: input.room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return token.toJwt();
}
