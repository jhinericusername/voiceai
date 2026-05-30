import type { SqlStatement } from "../consent/repository.js";

export type TranscriptSpeaker = "agent" | "candidate";

export interface TranscriptTurnInput {
  readonly sessionId: string;
  readonly turnIndex: number;
  readonly speaker: TranscriptSpeaker;
  readonly text: string;
  readonly questionId?: string | null;
  readonly occurredAt?: string;
  readonly offsetMs?: number | null;
  readonly source?: string;
}

export type TranscriptTurnValidation =
  | { ok: true }
  | { ok: false; reason: string };

export function validateTranscriptTurn(input: TranscriptTurnInput): TranscriptTurnValidation {
  if (!input.sessionId.trim()) {
    return { ok: false, reason: "sessionId is required" };
  }
  if (!Number.isInteger(input.turnIndex) || input.turnIndex < 0) {
    return { ok: false, reason: "turnIndex must be a non-negative integer" };
  }
  if (input.speaker !== "agent" && input.speaker !== "candidate") {
    return { ok: false, reason: "speaker must be agent or candidate" };
  }
  if (!input.text.trim()) {
    return { ok: false, reason: "text is required" };
  }
  return { ok: true };
}

export function transcriptTurnUpsertStatement(input: TranscriptTurnInput): SqlStatement {
  return {
    sql:
      "INSERT INTO transcript_turns " +
      "(session_id, turn_index, speaker, question_id, text, occurred_at, offset_ms, source) " +
      "VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()), $7, $8) " +
      "ON CONFLICT (session_id, turn_index) DO UPDATE SET " +
      "speaker = EXCLUDED.speaker, question_id = EXCLUDED.question_id, " +
      "text = EXCLUDED.text, occurred_at = EXCLUDED.occurred_at, " +
      "offset_ms = EXCLUDED.offset_ms, source = EXCLUDED.source, updated_at = now()",
    params: [
      input.sessionId,
      input.turnIndex,
      input.speaker,
      input.questionId ?? null,
      input.text,
      input.occurredAt ?? null,
      input.offsetMs ?? null,
      input.source ?? "livekit",
    ],
  };
}

export function transcriptTurnsBySessionStatement(sessionId: string): SqlStatement {
  return {
    sql:
      "SELECT session_id, turn_index, speaker, question_id, text, occurred_at, offset_ms, source " +
      "FROM transcript_turns WHERE session_id = $1 ORDER BY turn_index ASC",
    params: [sessionId],
  };
}
