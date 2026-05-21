import { describe, it, expect } from "vitest";
import { storagePaths } from "../src/storage/layout.js";

describe("storagePaths", () => {
  it("builds the spec storage layout under org and session", () => {
    const p = storagePaths("org1", "sess1");
    expect(p.root).toBe("/org1/interviews/sess1/");
    expect(p.media.composite).toBe("/org1/interviews/sess1/media/composite.mp4");
    expect(p.media.candidateVideo).toBe("/org1/interviews/sess1/media/candidate_video.mp4");
    expect(p.media.candidateAudio).toBe("/org1/interviews/sess1/media/candidate_audio.m4a");
    expect(p.media.agentAudio).toBe("/org1/interviews/sess1/media/agent_audio.m4a");
    expect(p.transcripts.transcript).toBe(
      "/org1/interviews/sess1/transcripts/transcript.v1.json",
    );
    expect(p.events.agentEvents).toBe("/org1/interviews/sess1/events/agent_events.jsonl");
    expect(p.events.mediaEvents).toBe("/org1/interviews/sess1/events/media_events.jsonl");
    expect(p.events.integrityEvents).toBe(
      "/org1/interviews/sess1/events/integrity_events.jsonl",
    );
    expect(p.assessment.scores).toBe("/org1/interviews/sess1/assessment/scores.json");
    expect(p.assessment.integrityFlags).toBe(
      "/org1/interviews/sess1/assessment/integrity_flags.json",
    );
    expect(p.review.reviewerNotes).toBe("/org1/interviews/sess1/review/reviewer_notes.json");
    expect(p.review.signoff).toBe("/org1/interviews/sess1/review/signoff.json");
    expect(p.audit.consent).toBe("/org1/interviews/sess1/audit/consent.json");
    expect(p.audit.scriptVersion).toBe("/org1/interviews/sess1/audit/script_version.json");
    expect(p.audit.modelVersions).toBe("/org1/interviews/sess1/audit/model_versions.json");
  });
});
