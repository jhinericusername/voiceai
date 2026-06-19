import { RoomServiceClient, AgentDispatchClient } from "livekit-server-sdk";

const INTERVIEW_ROOM_PREFIX = "interview-";
const INTERVIEW_AGENT_NAME = "puddle-interviewer";
const ROOM_EMPTY_TIMEOUT_SECONDS = 600;
const ROOM_DEPARTURE_TIMEOUT_SECONDS = 300;
const ROOM_MAX_PARTICIPANTS = 8;

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
  readonly dispatchAgent?: boolean;
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

export function liveKitApiUrl(host: string): string {
  if (host.startsWith("wss://")) {
    return `https://${host.slice("wss://".length)}`;
  }
  if (host.startsWith("ws://")) {
    return `http://${host.slice("ws://".length)}`;
  }
  return host;
}

function liveKitClients(config: LiveKitConfig): {
  readonly rooms: RoomClient;
  readonly dispatch: DispatchClient;
} {
  const apiUrl = liveKitApiUrl(config.host);
  return {
    rooms: new RoomServiceClient(apiUrl, config.apiKey, config.apiSecret),
    dispatch: new AgentDispatchClient(apiUrl, config.apiKey, config.apiSecret),
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

// Ensures the SFU room exists and, unless disabled for interviewer-led setup,
// that one Puddle interviewer dispatch has been requested.
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
        maxParticipants: ROOM_MAX_PARTICIPANTS,
      });
    } catch (error) {
      if (!roomAlreadyExists(error)) {
        throw error;
      }
      roomCreated = false;
    }
  }

  let dispatchCreated = false;
  if (input.dispatchAgent !== false) {
    const dispatches = await dispatch.listDispatch(room);
    dispatchCreated = !dispatches.some(dispatchMatchesPuddleInterviewer);
    if (dispatchCreated) {
      await dispatch.createDispatch(room, INTERVIEW_AGENT_NAME, {
        metadata: workerMetadata,
      });
    }
  }

  return {
    room,
    roomCreated,
    dispatchCreated,
    roomRecreated: roomCreated && input.hadPreviousRoom === true,
  };
}

// Stops the Puddle interviewer agent for a session. Two steps, both required:
//   1) delete the agent dispatch(es) — ensureRoomReady only dispatches when
//      none exists, so a lingering dispatch would make a later "resume" a no-op;
//   2) remove the live agent participant so the running worker actually
//      disconnects (deleting the dispatch alone does not evict a connected job).
// Best-effort: callers log failures but do not fail the request (the stop intent
// is already recorded, and the empty-room timeout is a backstop).
export async function stopInterviewerAgent(
  config: LiveKitConfig,
  sessionId: string,
): Promise<{ readonly deletedDispatches: number; readonly removedParticipants: number }> {
  const apiUrl = liveKitApiUrl(config.host);
  const rooms = new RoomServiceClient(apiUrl, config.apiKey, config.apiSecret);
  const dispatch = new AgentDispatchClient(apiUrl, config.apiKey, config.apiSecret);
  const room = roomName(sessionId);

  let deletedDispatches = 0;
  const dispatches = await dispatch.listDispatch(room);
  for (const entry of dispatches) {
    const id = (entry as { id?: string }).id;
    if (id && dispatchMatchesPuddleInterviewer(entry)) {
      await dispatch.deleteDispatch(id, room);
      deletedDispatches += 1;
    }
  }

  // ParticipantInfo_Kind.AGENT === 4 in the LiveKit protocol enum (stable wire
  // value). Comparing the numeric kind avoids depending on an enum export.
  const AGENT_KIND = 4;
  let removedParticipants = 0;
  const participants = await rooms.listParticipants(room);
  for (const participant of participants) {
    if (Number((participant as { kind?: number }).kind) === AGENT_KIND) {
      await rooms.removeParticipant(room, participant.identity);
      removedParticipants += 1;
    }
  }

  return { deletedDispatches, removedParticipants };
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
