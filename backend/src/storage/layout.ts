export interface StoragePaths {
  readonly root: string;
  readonly media: {
    readonly composite: string;
    readonly candidateVideo: string;
    readonly candidateAudio: string;
    readonly agentAudio: string;
  };
  readonly transcripts: { readonly transcript: string };
  readonly events: {
    readonly agentEvents: string;
    readonly mediaEvents: string;
    readonly integrityEvents: string;
  };
  readonly assessment: { readonly scores: string; readonly integrityFlags: string };
  readonly review: { readonly reviewerNotes: string; readonly signoff: string };
  readonly audit: {
    readonly consent: string;
    readonly scriptVersion: string;
    readonly modelVersions: string;
  };
}

export function storagePaths(orgId: string, sessionId: string): StoragePaths {
  const root = `/${orgId}/interviews/${sessionId}/`;
  return {
    root,
    media: {
      composite: `${root}media/composite.mp4`,
      candidateVideo: `${root}media/candidate_video.mp4`,
      candidateAudio: `${root}media/candidate_audio.m4a`,
      agentAudio: `${root}media/agent_audio.m4a`,
    },
    transcripts: { transcript: `${root}transcripts/transcript.v1.json` },
    events: {
      agentEvents: `${root}events/agent_events.jsonl`,
      mediaEvents: `${root}events/media_events.jsonl`,
      integrityEvents: `${root}events/integrity_events.jsonl`,
    },
    assessment: {
      scores: `${root}assessment/scores.json`,
      integrityFlags: `${root}assessment/integrity_flags.json`,
    },
    review: {
      reviewerNotes: `${root}review/reviewer_notes.json`,
      signoff: `${root}review/signoff.json`,
    },
    audit: {
      consent: `${root}audit/consent.json`,
      scriptVersion: `${root}audit/script_version.json`,
      modelVersions: `${root}audit/model_versions.json`,
    },
  };
}
