import { RoomServiceClient, AgentDispatchClient } from "livekit-server-sdk";

export interface LiveKitConfig {
  readonly host: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

export function roomName(sessionId: string): string {
  return `interview-${sessionId}`;
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
