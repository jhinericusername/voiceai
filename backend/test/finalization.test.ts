import { describe, it, expect } from "vitest";
import { assembleTranscript } from "../src/finalization/transcript.js";
import { buildArtifactManifest } from "../src/finalization/finalize.js";

describe("assembleTranscript", () => {
  it("builds a question-aligned diarized transcript", () => {
    const transcript = assembleTranscript([
      { turnIndex: 0, speaker: "agent", text: "Tell me about a hard problem.", questionId: "q1" },
      { turnIndex: 1, speaker: "candidate", text: "I rewrote the scheduler.", questionId: "q1" },
      { turnIndex: 2, speaker: "agent", text: "What was the impact?", questionId: "q1" },
      { turnIndex: 3, speaker: "candidate", text: "Cut latency in half.", questionId: "q1" },
    ]);
    expect(transcript.version).toBe("v1");
    expect(transcript.byQuestion.q1).toHaveLength(4);
    expect(transcript.byQuestion.q1[0].speaker).toBe("agent");
  });

  it("groups turns under their question id", () => {
    const transcript = assembleTranscript([
      { turnIndex: 0, speaker: "agent", text: "q1 text", questionId: "q1" },
      { turnIndex: 1, speaker: "candidate", text: "a1", questionId: "q1" },
      { turnIndex: 2, speaker: "agent", text: "q2 text", questionId: "q2" },
      { turnIndex: 3, speaker: "candidate", text: "a2", questionId: "q2" },
    ]);
    expect(Object.keys(transcript.byQuestion)).toEqual(["q1", "q2"]);
    expect(transcript.byQuestion.q2[1].text).toBe("a2");
  });
});

describe("buildArtifactManifest", () => {
  it("lists every expected artifact path for the session", () => {
    const manifest = buildArtifactManifest("org1", "sess1");
    expect(manifest.transcript).toBe(
      "/org1/interviews/sess1/transcripts/transcript.v1.json",
    );
    expect(manifest.scores).toBe("/org1/interviews/sess1/assessment/scores.json");
    expect(manifest.composite).toBe("/org1/interviews/sess1/media/composite.mp4");
    expect(manifest.agentEvents).toBe(
      "/org1/interviews/sess1/events/agent_events.jsonl",
    );
    expect(manifest.integrityEvents).toBe(
      "/org1/interviews/sess1/events/integrity_events.jsonl",
    );
  });
});
