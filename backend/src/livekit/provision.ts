import { RoomServiceClient, AgentDispatchClient } from "livekit-server-sdk";

const INTERVIEW_ROOM_PREFIX = "interview-";
const INTERVIEW_AGENT_NAME = "puddle-interviewer";
const ROOM_EMPTY_TIMEOUT_SECONDS = 600;
const ROOM_DEPARTURE_TIMEOUT_SECONDS = 300;

export interface LiveKitConfig {
  readonly host: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

interface LiveKitRoom {
  readonly name?: string;
}

interface AgentDispatch {
  readonly agentName?: string;
  readonly agent_name?: string;
}

interface RoomClient {
  listRooms(names?: string[]): Promise<LiveKitRoom[]>;
  createRoom(options: {
    readonly name: string;
    readonly emptyTimeout?: number;
    readonly departureTimeout?: number;
    readonly maxParticipants?: number;
  }): Promise<unknown>;
}

interface DispatchClient {
  listDispatch(roomName: string): Promise<AgentDispatch[]>;
  createDispatch(
    roomName: string,
    agentName: string,
    options?: { readonly metadata?: string },
  ): Promise<unknown>;
}

export interface RoomReadinessInput {
  readonly hadPreviousRoom?: boolean;
  readonly rooms?: RoomClient;
  readonly dispatch?: DispatchClient;
}

export interface RoomReadinessResult {
  readonly room: string;
  readonly roomCreated: boolean;
  readonly dispatchCreated: boolean;
  readonly roomRecreated: boolean;
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

function liveKitClients(config: LiveKitConfig): {
  readonly rooms: RoomClient;
  readonly dispatch: DispatchClient;
} {
  return {
    rooms: new RoomServiceClient(config.host, config.apiKey, config.apiSecret),
    dispatch: new AgentDispatchClient(config.host, config.apiKey, config.apiSecret),
  };
}

function roomAlreadyExists(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("already") && message.includes("exist");
}

function dispatchMatchesPuddleInterviewer(dispatch: AgentDispatch): boolean {
  return (dispatch.agentName ?? dispatch.agent_name) === INTERVIEW_AGENT_NAME;
}

// Ensures the SFU room exists and exactly one Puddle interviewer dispatch has
// been requested. This is intentionally safe to call from every candidate join.
export async function ensureRoomReady(
  config: LiveKitConfig,
  sessionId: string,
  workerMetadata: string,
  input: RoomReadinessInput = {},
): Promise<RoomReadinessResult> {
  const clients = liveKitClients(config);
  const rooms = input.rooms ?? clients.rooms;
  const dispatch = input.dispatch ?? clients.dispatch;
  const room = roomName(sessionId);

  const existingRooms = await rooms.listRooms([room]);
  let roomCreated = existingRooms.every((existingRoom) => existingRoom.name !== room);
  if (roomCreated) {
    try {
      await rooms.createRoom({
        name: room,
        emptyTimeout: ROOM_EMPTY_TIMEOUT_SECONDS,
        departureTimeout: ROOM_DEPARTURE_TIMEOUT_SECONDS,
        maxParticipants: 3,
      });
    } catch (error) {
      if (!roomAlreadyExists(error)) {
        throw error;
      }
      roomCreated = false;
    }
  }

  const dispatches = await dispatch.listDispatch(room);
  const dispatchCreated = !dispatches.some(dispatchMatchesPuddleInterviewer);
  if (dispatchCreated) {
    await dispatch.createDispatch(room, INTERVIEW_AGENT_NAME, {
      metadata: workerMetadata,
    });
  }

  return {
    room,
    roomCreated,
    dispatchCreated,
    roomRecreated: roomCreated && input.hadPreviousRoom === true,
  };
}

// Legacy explicit provisioning wrapper for callers that still need it.
export async function provisionRoom(
  config: LiveKitConfig,
  sessionId: string,
  workerMetadata: string,
): Promise<{ readonly room: string }> {
  const { room } = await ensureRoomReady(config, sessionId, workerMetadata);
  return { room };
}
