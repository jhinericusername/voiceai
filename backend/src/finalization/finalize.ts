import { storagePaths } from "../storage/layout.js";

export interface ArtifactManifest {
  readonly transcript: string;
  readonly scores: string;
  readonly integrityFlags: string;
  readonly composite: string;
  readonly candidateVideo: string;
  readonly agentEvents: string;
  readonly mediaEvents: string;
  readonly integrityEvents: string;
}

// The Finalization worker writes/collects exactly these artifacts post-call.
export function buildArtifactManifest(
  orgId: string,
  sessionId: string,
): ArtifactManifest {
  const p = storagePaths(orgId, sessionId);
  return {
    transcript: p.transcripts.transcript,
    scores: p.assessment.scores,
    integrityFlags: p.assessment.integrityFlags,
    composite: p.media.composite,
    candidateVideo: p.media.candidateVideo,
    agentEvents: p.events.agentEvents,
    mediaEvents: p.events.mediaEvents,
    integrityEvents: p.events.integrityEvents,
  };
}
