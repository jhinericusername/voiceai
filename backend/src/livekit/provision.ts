import { RoomServiceClient, AgentDispatchClient } from "livekit-server-sdk";

const INTERVIEW_ROOM_PREFIX = "interview-";

export interface LiveKitConfig {
  readonly host: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

export function roomName(sessionId: string): string {
  return `${INTERVIEW_ROOM_PREFIX}${sessionId}`;
}

export function sessionIdFromRoomName(name: string): string | null {
  if (!name.startsWith(INTERVIEW_ROOM_PREFIX)) {
    return null;
  }

  const sessionId = name.slice(INTERVIEW_ROOM_PREFIX.length).trim();
  return sessionId || null;
}

// Provisions the SFU room and dispatches one agent worker into it.
export async function provisionRoom(
  config: LiveKitConfig,
  sessionId: string,
  workerMetadata: string,
): Promise<{ readonly room: string }> {
  const rooms = new RoomServiceClient(config.host, config.apiKey, config.apiSecret);
  const dispatch = new AgentDispatchClient(config.host, config.apiKey, config.apiSecret);
  const room = roomName(sessionId);
  await rooms.createRoom({ name: room, emptyTimeout: 600, maxParticipants: 3 });
  await dispatch.createDispatch(room, "puddle-interviewer", {
    metadata: workerMetadata,
  });
  return { room };
}
