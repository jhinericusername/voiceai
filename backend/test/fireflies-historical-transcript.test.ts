import { describe, expect, it } from "vitest";
import { historicalTranscriptTurns } from "../src/weave/fireflies/historicalTranscript.js";

describe("Fireflies historical transcript turns", () => {
  it("maps Prakul, interviewer, and host speakers to agent", () => {
    const turns = historicalTranscriptTurns({
      sentences: [
        {
          speaker_name: "Prakul Singh",
          text: "Tell me about your background.",
          start_time: 12,
        },
        {
          speaker_name: "Interviewer",
          text: "What did you build?",
          start_time: 15.25,
        },
        {
          speaker_name: "Host",
          text: "Thanks for joining.",
          start_time: 20,
        },
      ],
    });

    expect(turns).toEqual([
      {
        turnIndex: 0,
        speaker: "agent",
        questionId: null,
        text: "Tell me about your background.",
        offsetMs: 12000,
      },
      {
        turnIndex: 1,
        speaker: "agent",
        questionId: null,
        text: "What did you build?",
        offsetMs: 15250,
      },
      {
        turnIndex: 2,
        speaker: "agent",
        questionId: null,
        text: "Thanks for joining.",
        offsetMs: 20000,
      },
    ]);
  });

  it("maps other speakers to candidate", () => {
    const turns = historicalTranscriptTurns({
      sentences: [
        {
          speaker_name: "Candidate",
          text: "I build developer tools.",
          start_time: 31,
        },
      ],
    });

    expect(turns[0]).toEqual({
      turnIndex: 0,
      speaker: "candidate",
      questionId: null,
      text: "I build developer tools.",
      offsetMs: 31000,
    });
  });

  it("skips empty sentence text and keeps turn indexes stable from zero", () => {
    const turns = historicalTranscriptTurns({
      sentences: [
        { speaker_name: "Prakul", text: "  ", start_time: 1 },
        { speaker_name: "Candidate", text: "First answer.", start_time: 2 },
        { speaker_name: "Candidate", text: "", start_time: 3 },
        { speaker_name: "Host", text: "Follow-up question.", start_time: 4 },
      ],
    });

    expect(turns.map((turn) => turn.turnIndex)).toEqual([0, 1]);
    expect(turns).toEqual([
      {
        turnIndex: 0,
        speaker: "candidate",
        questionId: null,
        text: "First answer.",
        offsetMs: 2000,
      },
      {
        turnIndex: 1,
        speaker: "agent",
        questionId: null,
        text: "Follow-up question.",
        offsetMs: 4000,
      },
    ]);
  });
});
