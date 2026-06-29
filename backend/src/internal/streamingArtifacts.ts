import type { SqlStatement } from "../consent/repository.js";
import type { TranscriptSpeaker } from "../transcripts/repository.js";

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export interface StreamingTranscriptTurnBody {
  readonly turnIndex: number;
  readonly speaker: TranscriptSpeaker;
  readonly questionId?: string | null;
  readonly text: string;
  readonly occurredAt?: string;
  readonly offsetMs?: number | null;
  readonly source?: string;
  readonly unreliable?: boolean;
}

export interface AgentEventBody {
  readonly sequence: number;
  readonly turnIndex?: number | null;
  readonly utterance: string;
  readonly reasonCode: string;
  readonly questionId?: string | null;
  readonly category?: string | null;
  readonly missingElement?: string | null;
  readonly occurredAt?: string;
}

export interface ScoreCheckpointAssessment {
  readonly questionId?: string;
  readonly category: string;
  readonly provisionalScore: number;
  readonly confidence: number;
  readonly evidenceQuotes: readonly string[];
  readonly missingOrAmbiguous: readonly string[];
}

export interface ScoreCheckpointBody {
  readonly sessionId?: string;
  readonly sequence: number;
  readonly questionId: string;
  readonly model: string;
  readonly assessments: readonly ScoreCheckpointAssessment[];
}

export type CompletionReason =
  | "completed"
  | "candidate_disconnected"
  | "agent_error"
  | "timeout"
  | "ai_ended_by_host";

export interface FinalizationBody {
  readonly completionReason: CompletionReason;
  readonly scriptVersion: string;
  readonly finalTurnCount: number;
  readonly integrityFlags: readonly string[];
  readonly agentEventCount: number;
  readonly scoreCheckpointCount?: number;
}

const completionReasons = new Set<string>([
  "completed",
  "candidate_disconnected",
  "agent_error",
  "timeout",
  "ai_ended_by_host",
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isIsoDateString(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validateOptionalNonEmptyString(
  value: unknown,
  reason: string,
): ValidationResult {
  if (value === undefined || value === null) {
    return { ok: true };
  }
  if (!isNonEmptyString(value)) {
    return { ok: false, reason };
  }
  return { ok: true };
}

export function validateStreamingTranscriptTurn(body: unknown): ValidationResult {
  if (!isRecord(body)) {
    return { ok: false, reason: "body must be an object" };
  }
  if (!isNonNegativeInteger(body.turnIndex)) {
    return { ok: false, reason: "turnIndex must be a non-negative integer" };
  }
  if (body.speaker !== "agent" && body.speaker !== "candidate") {
    return { ok: false, reason: "speaker must be agent or candidate" };
  }
  if (!isNonEmptyString(body.text)) {
    return { ok: false, reason: "text is required" };
  }
  if (body.occurredAt !== undefined && !isIsoDateString(body.occurredAt)) {
    return { ok: false, reason: "occurredAt must be a valid ISO date string" };
  }
  if (
    body.offsetMs !== undefined &&
    body.offsetMs !== null &&
    !isNonNegativeInteger(body.offsetMs)
  ) {
    return { ok: false, reason: "offsetMs must be a non-negative integer" };
  }
  return { ok: true };
}

export function validateAgentEvent(body: unknown): ValidationResult {
  if (!isRecord(body)) {
    return { ok: false, reason: "body must be an object" };
  }
  if (!isNonNegativeInteger(body.sequence)) {
    return { ok: false, reason: "sequence must be a non-negative integer" };
  }
  if (
    body.turnIndex !== undefined &&
    body.turnIndex !== null &&
    !isNonNegativeInteger(body.turnIndex)
  ) {
    return { ok: false, reason: "turnIndex must be a non-negative integer" };
  }
  if (!isNonEmptyString(body.utterance)) {
    return { ok: false, reason: "utterance is required" };
  }
  if (!isNonEmptyString(body.reasonCode)) {
    return { ok: false, reason: "reasonCode is required" };
  }
  if (body.occurredAt !== undefined && !isIsoDateString(body.occurredAt)) {
    return { ok: false, reason: "occurredAt must be a valid ISO date string" };
  }
  const questionId = validateOptionalNonEmptyString(
    body.questionId,
    "questionId must be a non-empty string when provided",
  );
  if (!questionId.ok) {
    return questionId;
  }
  const category = validateOptionalNonEmptyString(
    body.category,
    "category must be a non-empty string when provided",
  );
  if (!category.ok) {
    return category;
  }
  const missingElement = validateOptionalNonEmptyString(
    body.missingElement,
    "missingElement must be a non-empty string when provided",
  );
  if (!missingElement.ok) {
    return missingElement;
  }
  return { ok: true };
}

export function validateScoreCheckpoint(body: unknown): ValidationResult {
  if (!isRecord(body)) {
    return { ok: false, reason: "body must be an object" };
  }
  if (body.sessionId !== undefined && !isNonEmptyString(body.sessionId)) {
    return { ok: false, reason: "sessionId is required" };
  }
  if (!isNonNegativeInteger(body.sequence)) {
    return { ok: false, reason: "sequence must be a non-negative integer" };
  }
  if (!isNonEmptyString(body.questionId)) {
    return { ok: false, reason: "questionId is required" };
  }
  if (!isNonEmptyString(body.model)) {
    return { ok: false, reason: "model is required" };
  }
  if (!Array.isArray(body.assessments) || body.assessments.length === 0) {
    return { ok: false, reason: "assessments are required" };
  }
  for (const assessment of body.assessments) {
    if (!isRecord(assessment)) {
      return { ok: false, reason: "assessment must be an object" };
    }
    if (
      assessment.questionId !== undefined &&
      !isNonEmptyString(assessment.questionId)
    ) {
      return { ok: false, reason: "assessment questionId is required" };
    }
    if (!isNonEmptyString(assessment.category)) {
      return { ok: false, reason: "assessment category is required" };
    }
    if (
      !isFiniteNumber(assessment.provisionalScore) ||
      !Number.isInteger(assessment.provisionalScore) ||
      assessment.provisionalScore < 1 ||
      assessment.provisionalScore > 4
    ) {
      return { ok: false, reason: "assessment provisionalScore must be an integer from 1 to 4" };
    }
    if (
      !isFiniteNumber(assessment.confidence) ||
      assessment.confidence < 0 ||
      assessment.confidence > 1
    ) {
      return { ok: false, reason: "assessment confidence must be between 0 and 1" };
    }
    if (!isStringArray(assessment.evidenceQuotes)) {
      return { ok: false, reason: "assessment evidenceQuotes must be an array of strings" };
    }
    if (!isStringArray(assessment.missingOrAmbiguous)) {
      return { ok: false, reason: "assessment missingOrAmbiguous must be an array of strings" };
    }
  }
  return { ok: true };
}

export function validateFinalization(body: unknown): ValidationResult {
  if (!isRecord(body)) {
    return { ok: false, reason: "body must be an object" };
  }
  if (
    typeof body.completionReason !== "string" ||
    !completionReasons.has(body.completionReason)
  ) {
    return { ok: false, reason: "completionReason is invalid" };
  }
  if (!isNonEmptyString(body.scriptVersion)) {
    return { ok: false, reason: "scriptVersion is required" };
  }
  if (!isNonNegativeInteger(body.finalTurnCount)) {
    return { ok: false, reason: "finalTurnCount must be a non-negative integer" };
  }
  if (!isStringArray(body.integrityFlags)) {
    return { ok: false, reason: "integrityFlags must be an array of strings" };
  }
  if (!isNonNegativeInteger(body.agentEventCount)) {
    return { ok: false, reason: "agentEventCount must be a non-negative integer" };
  }
  if (
    body.completionReason === "completed" &&
    body.scoreCheckpointCount === undefined
  ) {
    return {
      ok: false,
      reason: "scoreCheckpointCount is required when completionReason is completed",
    };
  }
  if (
    body.scoreCheckpointCount !== undefined &&
    !isNonNegativeInteger(body.scoreCheckpointCount)
  ) {
    return { ok: false, reason: "scoreCheckpointCount must be a non-negative integer" };
  }
  return { ok: true };
}

export function agentEventUpsertStatement(
  sessionId: string,
  body: AgentEventBody,
): SqlStatement {
  return {
    sql:
      "INSERT INTO agent_events " +
      "(session_id, sequence, turn_index, utterance, reason_code, question_id, " +
      "category, missing_element, occurred_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now())) " +
      "ON CONFLICT (session_id, sequence) DO UPDATE SET " +
      "turn_index = EXCLUDED.turn_index, utterance = EXCLUDED.utterance, " +
      "reason_code = EXCLUDED.reason_code, question_id = EXCLUDED.question_id, " +
      "category = EXCLUDED.category, missing_element = EXCLUDED.missing_element, " +
      "occurred_at = EXCLUDED.occurred_at, updated_at = now()",
    params: [
      sessionId,
      body.sequence,
      body.turnIndex ?? null,
      body.utterance,
      body.reasonCode,
      body.questionId ?? null,
      body.category ?? null,
      body.missingElement ?? null,
      body.occurredAt ?? null,
    ],
  };
}

export function scoreCheckpointUpsertStatement(
  sessionId: string,
  body: ScoreCheckpointBody,
): SqlStatement {
  return {
    sql:
      "INSERT INTO score_checkpoints " +
      "(session_id, sequence, question_id, model, assessments) " +
      "VALUES ($1, $2, $3, $4, $5::jsonb) " +
      "ON CONFLICT (session_id, sequence) DO UPDATE SET " +
      "question_id = EXCLUDED.question_id, model = EXCLUDED.model, " +
      "assessments = EXCLUDED.assessments, updated_at = now()",
    params: [
      sessionId,
      body.sequence,
      body.questionId,
      body.model,
      JSON.stringify(body.assessments),
    ],
  };
}

export function finalizationEventPayload(body: FinalizationBody): {
  readonly completion_reason: CompletionReason;
  readonly script_version: string;
  readonly final_turn_count: number;
  readonly integrity_flags: readonly string[];
  readonly agent_event_count: number;
  readonly score_checkpoint_count?: number;
} {
  const payload: {
    completion_reason: CompletionReason;
    script_version: string;
    final_turn_count: number;
    integrity_flags: readonly string[];
    agent_event_count: number;
    score_checkpoint_count?: number;
  } = {
    completion_reason: body.completionReason,
    script_version: body.scriptVersion,
    final_turn_count: body.finalTurnCount,
    integrity_flags: body.integrityFlags,
    agent_event_count: body.agentEventCount,
  };
  if (body.scoreCheckpointCount !== undefined) {
    payload.score_checkpoint_count = body.scoreCheckpointCount;
  }
  return payload;
}
