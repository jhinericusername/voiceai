import { AccessToken } from "livekit-server-sdk";
import type { LiveKitConfig } from "./provision.js";

const DEFAULT_JOIN_TOKEN_TTL_SECONDS = 15 * 60;

export type ParticipantKind = "candidate" | "interviewer";

export interface CandidateTokenInput {
  readonly sessionId: string;
  readonly room: string;
  readonly inviteId: string;
  readonly candidateEmail: string;
  readonly ttlSeconds?: number;
}

export interface InterviewerTokenInput {
  readonly sessionId: string;
  readonly room: string;
  readonly interviewerUserId: string;
  readonly interviewerEmail: string;
  readonly ttlSeconds?: number;
}

function addRoomGrant(token: AccessToken, room: string): void {
  token.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
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

  addRoomGrant(token, input.room);
  return token.toJwt();
}

export async function buildInterviewerJoinToken(
  config: LiveKitConfig,
  input: InterviewerTokenInput,
): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: `interviewer-${input.sessionId}-${input.interviewerUserId}`,
    name: input.interviewerEmail,
    ttl: input.ttlSeconds ?? DEFAULT_JOIN_TOKEN_TTL_SECONDS,
    metadata: JSON.stringify({
      session_id: input.sessionId,
      interviewer_user_id: input.interviewerUserId,
      participant_kind: "interviewer",
    }),
  });

  addRoomGrant(token, input.room);
  return token.toJwt();
}
