import type { RemoteParticipant, RemoteTrack } from "livekit-client";

export const AI_INTERVIEWER_IDENTITY_PREFIX = "puddle-interviewer-";

export type LiveKitParticipantKind = "ai_interviewer" | "candidate" | "interviewer" | "unknown";

export interface LiveKitParticipantTile {
  readonly identity: string;
  readonly kind: LiveKitParticipantKind;
  readonly label: string;
  readonly fallbackInitial: string;
  readonly videoTrack: RemoteTrack | null;
}

export function aiInterviewerParticipantIdentity(sessionId: string): string {
  return `${AI_INTERVIEWER_IDENTITY_PREFIX}${sessionId}`;
}

export function aiInterviewerPlaceholderTile(sessionId: string): LiveKitParticipantTile {
  return {
    identity: aiInterviewerParticipantIdentity(sessionId),
    kind: "ai_interviewer",
    label: "Puddle AI interviewer",
    fallbackInitial: "P",
    videoTrack: null,
  };
}

export function syncParticipantTiles(
  currentTiles: readonly LiveKitParticipantTile[],
  participants: Iterable<RemoteParticipant>,
): LiveKitParticipantTile[] {
  const currentByIdentity = new Map(currentTiles.map((tile) => [tile.identity, tile]));
  return sortParticipantTiles(
    Array.from(participants, (participant) => participantTileFromRemoteParticipant(
      participant,
      currentByIdentity.get(participant.identity),
    )),
  );
}

export function upsertParticipantTile(
  currentTiles: readonly LiveKitParticipantTile[],
  participant: RemoteParticipant,
): LiveKitParticipantTile[] {
  const nextTile = participantTileFromRemoteParticipant(
    participant,
    currentTiles.find((tile) => tile.identity === participant.identity),
  );
  return sortParticipantTiles([
    ...currentTiles.filter((tile) => tile.identity !== participant.identity),
    nextTile,
  ]);
}

export function removeParticipantTile(
  currentTiles: readonly LiveKitParticipantTile[],
  participant: RemoteParticipant,
): LiveKitParticipantTile[] {
  return currentTiles.filter((tile) => tile.identity !== participant.identity);
}

export function setParticipantVideoTrack(
  currentTiles: readonly LiveKitParticipantTile[],
  participant: RemoteParticipant,
  videoTrack: RemoteTrack | null,
): LiveKitParticipantTile[] {
  const baseTile = participantTileFromRemoteParticipant(
    participant,
    currentTiles.find((tile) => tile.identity === participant.identity),
  );
  const nextTile = {
    ...baseTile,
    videoTrack,
  };
  return sortParticipantTiles([
    ...currentTiles.filter((tile) => tile.identity !== participant.identity),
    nextTile,
  ]);
}

export function findParticipantTile(
  tiles: readonly LiveKitParticipantTile[],
  kind: LiveKitParticipantKind,
): LiveKitParticipantTile | null {
  return tiles.find((tile) => tile.kind === kind) ?? null;
}

function participantTileFromRemoteParticipant(
  participant: RemoteParticipant,
  currentTile: LiveKitParticipantTile | undefined,
): LiveKitParticipantTile {
  const kind = participantKind(participant);
  return {
    identity: participant.identity,
    kind,
    label: participantLabel(participant, kind),
    fallbackInitial: fallbackInitial(kind),
    videoTrack: currentTile?.videoTrack ?? null,
  };
}

function participantKind(participant: RemoteParticipant): LiveKitParticipantKind {
  if (participant.isAgent) {
    return "ai_interviewer";
  }

  if (participant.identity.startsWith(AI_INTERVIEWER_IDENTITY_PREFIX)) {
    return "ai_interviewer";
  }

  if (participant.attributes["puddle.role"] === "ai_interviewer") {
    return "ai_interviewer";
  }

  const metadataKind = participantKindFromMetadata(participant.metadata);
  if (metadataKind !== null) {
    return metadataKind;
  }

  if (participant.identity.startsWith("candidate-")) {
    return "candidate";
  }

  if (participant.identity.startsWith("interviewer-")) {
    return "interviewer";
  }

  return "unknown";
}

function participantKindFromMetadata(metadata: string | undefined): LiveKitParticipantKind | null {
  if (!metadata) {
    return null;
  }

  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const participantKindValue = (parsed as Record<string, unknown>).participant_kind;
    if (participantKindValue === "ai_interviewer") {
      return "ai_interviewer";
    }

    if (participantKindValue === "candidate" || participantKindValue === "interviewer") {
      return participantKindValue;
    }

    if ((parsed as Record<string, unknown>)["puddle.role"] === "ai_interviewer") {
      return "ai_interviewer";
    }
  } catch {
    return null;
  }

  return null;
}

function participantLabel(participant: RemoteParticipant, kind: LiveKitParticipantKind): string {
  if (kind === "ai_interviewer") {
    return "Puddle AI interviewer";
  }

  if (kind === "candidate") {
    return "Candidate";
  }

  if (kind === "interviewer") {
    return "Host";
  }

  return participant.name?.trim() || "Participant";
}

function fallbackInitial(kind: LiveKitParticipantKind): string {
  if (kind === "ai_interviewer") {
    return "P";
  }

  if (kind === "candidate") {
    return "C";
  }

  if (kind === "interviewer") {
    return "H";
  }

  return "?";
}

function sortParticipantTiles(tiles: readonly LiveKitParticipantTile[]): LiveKitParticipantTile[] {
  return [...tiles].sort((left, right) => {
    const byKind = tileKindRank(left.kind) - tileKindRank(right.kind);
    if (byKind !== 0) {
      return byKind;
    }

    return left.identity.localeCompare(right.identity);
  });
}

function tileKindRank(kind: LiveKitParticipantKind): number {
  if (kind === "candidate") {
    return 0;
  }

  if (kind === "ai_interviewer") {
    return 1;
  }

  if (kind === "interviewer") {
    return 2;
  }

  return 3;
}
