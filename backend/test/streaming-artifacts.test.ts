import { describe, expect, it } from "vitest";
import {
  agentEventUpsertStatement,
  finalizationEventPayload,
  scoreCheckpointUpsertStatement,
  validateAgentEvent,
  validateFinalization,
  validateScoreCheckpoint,
  validateStreamingTranscriptTurn,
  type AgentEventBody,
  type FinalizationBody,
  type ScoreCheckpointBody,
  type StreamingTranscriptTurnBody,
} from "../src/internal/streamingArtifacts.js";

const transcriptTurn: StreamingTranscriptTurnBody = {
  turnIndex: 3,
  speaker: "candidate",
  questionId: "q2",
  text: "I rebuilt the ingestion worker.",
  occurredAt: "2026-06-11T04:18:22.000Z",
  offsetMs: 124000,
  source: "deepgram:nova-3",
  unreliable: false,
};

const agentEvent: AgentEventBody = {
  sequence: 4,
  turnIndex: 4,
  utterance: "Can you walk through the tradeoff?",
  reasonCode: "PROBE_LOW_CONFIDENCE",
  questionId: "q2",
  category: "technical_depth",
  missingElement: "tradeoff analysis",
  occurredAt: "2026-06-11T04:18:31.000Z",
};

const assessments = [
  {
    category: "technical_depth",
    provisionalScore: 3,
    confidence: 0.74,
    evidenceQuotes: ["I rebuilt the ingestion worker."],
    missingOrAmbiguous: ["failure depth"],
  },
];

const scoreCheckpoint: ScoreCheckpointBody = {
  sequence: 2,
  questionId: "q2",
  model: "claude-opus-4-7",
  assessments,
};

const finalization: FinalizationBody = {
  completionReason: "completed",
  scriptVersion: "pilot-v1",
  finalTurnCount: 10,
  integrityFlags: [],
  agentEventCount: 8,
  scoreCheckpointCount: 2,
};

const completedFinalizationWithoutScoreCheckpointCount: FinalizationBody = {
  completionReason: "completed",
  scriptVersion: "pilot-v1",
  finalTurnCount: 10,
  integrityFlags: [],
  agentEventCount: 8,
};

const agentErrorFinalizationWithoutScoreCheckpointCount: FinalizationBody = {
  completionReason: "agent_error",
  scriptVersion: "pilot-v1",
  finalTurnCount: 10,
  integrityFlags: ["agent_error"],
  agentEventCount: 8,
};

const aiEndedFinalizationWithoutScoreCheckpointCount: FinalizationBody = {
  completionReason: "ai_ended_by_host",
  scriptVersion: "pilot-v1",
  finalTurnCount: 10,
  integrityFlags: ["ai_ended_by_host"],
  agentEventCount: 8,
};

function expectInvalid(result: { ok: true } | { ok: false; reason: string }): void {
  expect(result.ok).toBe(false);
}

describe("streaming transcript turn validation", () => {
  it("accepts a valid candidate turn", () => {
    expect(validateStreamingTranscriptTurn(transcriptTurn)).toEqual({ ok: true });
  });

  it("accepts a transcript turn without occurredAt", () => {
    const { occurredAt: _occurredAt, ...body } = transcriptTurn;
    expect(validateStreamingTranscriptTurn(body)).toEqual({ ok: true });
  });

  it("rejects malformed transcript turn bodies without throwing", () => {
    for (const body of [null, "turn", 3, [], true]) {
      expectInvalid(validateStreamingTranscriptTurn(body));
    }
  });

  it("rejects empty transcript text", () => {
    expectInvalid(validateStreamingTranscriptTurn({ ...transcriptTurn, text: "" }));
  });

  it("rejects invalid transcript turn fields", () => {
    expectInvalid(validateStreamingTranscriptTurn({ ...transcriptTurn, turnIndex: -1 }));
    expectInvalid(
      validateStreamingTranscriptTurn({
        ...transcriptTurn,
        turnIndex: 1.5,
      }),
    );
    expectInvalid(
      validateStreamingTranscriptTurn({
        ...transcriptTurn,
        speaker: "viewer",
      } as unknown as StreamingTranscriptTurnBody),
    );
    expectInvalid(
      validateStreamingTranscriptTurn({
        ...transcriptTurn,
        occurredAt: "not-a-date",
      }),
    );
    expectInvalid(validateStreamingTranscriptTurn({ ...transcriptTurn, offsetMs: -1 }));
    expectInvalid(validateStreamingTranscriptTurn({ ...transcriptTurn, offsetMs: 1.5 }));
    expectInvalid(
      validateStreamingTranscriptTurn({
        ...transcriptTurn,
        offsetMs: Number.POSITIVE_INFINITY,
      }),
    );
  });
});

describe("agent event validation and persistence", () => {
  it("accepts a valid agent event", () => {
    expect(validateAgentEvent(agentEvent)).toEqual({ ok: true });
  });

  it("accepts an agent event without occurredAt", () => {
    const { occurredAt: _occurredAt, ...body } = agentEvent;
    expect(validateAgentEvent(body)).toEqual({ ok: true });
  });

  it("rejects malformed agent event bodies without throwing", () => {
    for (const body of [null, "event", 4, [], false]) {
      expectInvalid(validateAgentEvent(body));
    }
  });

  it("rejects a negative sequence", () => {
    expectInvalid(validateAgentEvent({ ...agentEvent, sequence: -1 }));
  });

  it("rejects invalid agent event fields", () => {
    expectInvalid(validateAgentEvent({ ...agentEvent, sequence: 1.5 }));
    expectInvalid(validateAgentEvent({ ...agentEvent, turnIndex: -1 }));
    expectInvalid(validateAgentEvent({ ...agentEvent, turnIndex: 1.5 }));
    expectInvalid(validateAgentEvent({ ...agentEvent, utterance: " " }));
    expectInvalid(validateAgentEvent({ ...agentEvent, reasonCode: "" }));
    expectInvalid(validateAgentEvent({ ...agentEvent, occurredAt: "not-a-date" }));
  });

  it("rejects invalid optional agent event metadata when present", () => {
    expectInvalid(validateAgentEvent({ ...agentEvent, questionId: "" }));
    expectInvalid(validateAgentEvent({ ...agentEvent, category: " " }));
    expectInvalid(validateAgentEvent({ ...agentEvent, missingElement: "" }));
    expectInvalid(
      validateAgentEvent({
        ...agentEvent,
        questionId: 12,
      } as unknown as AgentEventBody),
    );
    expectInvalid(
      validateAgentEvent({
        ...agentEvent,
        category: false,
      } as unknown as AgentEventBody),
    );
    expectInvalid(
      validateAgentEvent({
        ...agentEvent,
        missingElement: ["tradeoff"],
      } as unknown as AgentEventBody),
    );
  });

  it("upserts agent events by session and sequence", () => {
    const statement = agentEventUpsertStatement("sess1", agentEvent);

    expect(statement.sql).toContain("INSERT INTO agent_events");
    expect(statement.sql).toContain(
      "(session_id, sequence, turn_index, utterance, reason_code, question_id, " +
        "category, missing_element, occurred_at)",
    );
    expect(statement.sql).toContain("ON CONFLICT (session_id, sequence)");
    expect(statement.sql).toContain("updated_at = now()");
    expect(statement.params).toEqual([
      "sess1",
      4,
      4,
      "Can you walk through the tradeoff?",
      "PROBE_LOW_CONFIDENCE",
      "q2",
      "technical_depth",
      "tradeoff analysis",
      "2026-06-11T04:18:31.000Z",
    ]);
  });
});

describe("score checkpoint validation and persistence", () => {
  it("accepts a valid score checkpoint", () => {
    expect(validateScoreCheckpoint(scoreCheckpoint)).toEqual({ ok: true });
  });

  it("rejects malformed score checkpoint bodies without throwing", () => {
    for (const body of [null, "score", 2, [], true]) {
      expectInvalid(validateScoreCheckpoint(body));
    }
    expectInvalid(
      validateScoreCheckpoint({
        ...scoreCheckpoint,
        assessments: [null],
      } as unknown as ScoreCheckpointBody),
    );
  });

  it("rejects confidence outside 0..1", () => {
    expectInvalid(
      validateScoreCheckpoint({
        ...scoreCheckpoint,
        assessments: [{ ...assessments[0], confidence: 1.1 }],
      }),
    );
  });

  it("rejects invalid score checkpoint fields", () => {
    expectInvalid(validateScoreCheckpoint({ ...scoreCheckpoint, sequence: -1 }));
    expectInvalid(validateScoreCheckpoint({ ...scoreCheckpoint, sequence: 1.5 }));
    expectInvalid(validateScoreCheckpoint({ ...scoreCheckpoint, questionId: " " }));
    expectInvalid(validateScoreCheckpoint({ ...scoreCheckpoint, model: "" }));
    expectInvalid(
      validateScoreCheckpoint({
        ...scoreCheckpoint,
        sessionId: " ",
      }),
    );
    expectInvalid(
      validateScoreCheckpoint({
        ...scoreCheckpoint,
        sessionId: 42,
      } as unknown as ScoreCheckpointBody),
    );
    expectInvalid(
      validateScoreCheckpoint({
        ...scoreCheckpoint,
        assessments: "not-an-array",
      } as unknown as ScoreCheckpointBody),
    );
    expectInvalid(
      validateScoreCheckpoint({
        ...scoreCheckpoint,
        assessments: [{ ...assessments[0], category: "" }],
      }),
    );
    expectInvalid(
      validateScoreCheckpoint({
        ...scoreCheckpoint,
        assessments: [{ ...assessments[0], provisionalScore: 0 }],
      }),
    );
    expectInvalid(
      validateScoreCheckpoint({
        ...scoreCheckpoint,
        assessments: [{ ...assessments[0], provisionalScore: 5 }],
      }),
    );
    expectInvalid(
      validateScoreCheckpoint({
        ...scoreCheckpoint,
        assessments: [{ ...assessments[0], provisionalScore: 2.5 }],
      }),
    );
    expectInvalid(
      validateScoreCheckpoint({
        ...scoreCheckpoint,
        assessments: [{ ...assessments[0], evidenceQuotes: "quote" }],
      } as unknown as ScoreCheckpointBody),
    );
    expectInvalid(
      validateScoreCheckpoint({
        ...scoreCheckpoint,
        assessments: [{ ...assessments[0], evidenceQuotes: ["quote", 7] }],
      } as unknown as ScoreCheckpointBody),
    );
    expectInvalid(
      validateScoreCheckpoint({
        ...scoreCheckpoint,
        assessments: [{ ...assessments[0], missingOrAmbiguous: "gap" }],
      } as unknown as ScoreCheckpointBody),
    );
    expectInvalid(
      validateScoreCheckpoint({
        ...scoreCheckpoint,
        assessments: [{ ...assessments[0], missingOrAmbiguous: ["gap", null] }],
      } as unknown as ScoreCheckpointBody),
    );
  });

  it("upserts score checkpoints by session and sequence", () => {
    const statement = scoreCheckpointUpsertStatement("sess1", scoreCheckpoint);

    expect(statement.sql).toContain("INSERT INTO score_checkpoints");
    expect(statement.sql).toContain("(session_id, sequence, question_id, model, assessments)");
    expect(statement.sql).toContain("$5::jsonb");
    expect(statement.sql).toContain("ON CONFLICT (session_id, sequence)");
    expect(statement.sql).toContain("updated_at = now()");
    expect(statement.params).toEqual([
      "sess1",
      2,
      "q2",
      "claude-opus-4-7",
      JSON.stringify(assessments),
    ]);
  });
});

describe("finalization validation and payload", () => {
  it("accepts a valid finalization body", () => {
    expect(validateFinalization(finalization)).toEqual({ ok: true });
  });

  it("rejects completed finalization without scoreCheckpointCount", () => {
    const validation = validateFinalization(completedFinalizationWithoutScoreCheckpointCount);

    expect(validation).toEqual({
      ok: false,
      reason: "scoreCheckpointCount is required when completionReason is completed",
    });
  });

  it("accepts non-completed finalization without scoreCheckpointCount", () => {
    expect(validateFinalization(agentErrorFinalizationWithoutScoreCheckpointCount)).toEqual({
      ok: true,
    });
  });

  it("accepts host-ended AI finalization without scoreCheckpointCount", () => {
    expect(validateFinalization(aiEndedFinalizationWithoutScoreCheckpointCount)).toEqual({
      ok: true,
    });
  });

  it("rejects malformed finalization bodies without throwing", () => {
    for (const body of [null, "final", 10, [], false]) {
      expectInvalid(validateFinalization(body));
    }
  });

  it("serializes finalization event payload with snake case keys", () => {
    expect(finalizationEventPayload(finalization)).toEqual({
      completion_reason: "completed",
      script_version: "pilot-v1",
      final_turn_count: 10,
      integrity_flags: [],
      agent_event_count: 8,
      score_checkpoint_count: 2,
    });
  });

  it("omits score_checkpoint_count when absent from finalization payload", () => {
    expect(finalizationEventPayload(agentErrorFinalizationWithoutScoreCheckpointCount)).toEqual({
      completion_reason: "agent_error",
      script_version: "pilot-v1",
      final_turn_count: 10,
      integrity_flags: ["agent_error"],
      agent_event_count: 8,
    });
  });

  it("serializes host-ended AI finalization payload", () => {
    expect(finalizationEventPayload(aiEndedFinalizationWithoutScoreCheckpointCount)).toEqual({
      completion_reason: "ai_ended_by_host",
      script_version: "pilot-v1",
      final_turn_count: 10,
      integrity_flags: ["ai_ended_by_host"],
      agent_event_count: 8,
    });
  });

  it("rejects invalid finalization fields", () => {
    expectInvalid(
      validateFinalization({
        ...finalization,
        completionReason: "candidate_left",
      } as unknown as FinalizationBody),
    );
    expectInvalid(validateFinalization({ ...finalization, scriptVersion: " " }));
    expectInvalid(validateFinalization({ ...finalization, finalTurnCount: -1 }));
    expectInvalid(validateFinalization({ ...finalization, finalTurnCount: 1.5 }));
    expectInvalid(
      validateFinalization({
        ...finalization,
        integrityFlags: "none",
      } as unknown as FinalizationBody),
    );
    expectInvalid(
      validateFinalization({
        ...finalization,
        integrityFlags: ["flag", 12],
      } as unknown as FinalizationBody),
    );
    expectInvalid(validateFinalization({ ...finalization, agentEventCount: -1 }));
    expectInvalid(validateFinalization({ ...finalization, agentEventCount: 1.5 }));
    expectInvalid(validateFinalization({ ...finalization, scoreCheckpointCount: -1 }));
    expectInvalid(validateFinalization({ ...finalization, scoreCheckpointCount: 1.5 }));
  });
});
