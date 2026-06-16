import type { Pool } from "pg";
import {
  assessmentUpsertStatement,
  type CategoryScoreInput,
} from "../assessments/repository.js";
import {
  recordingArtifactStatusUpdateStatement,
  recordingArtifactUpsertStatement,
  type RecordingArtifactKind,
} from "../recordings/repository.js";
import {
  createArtifactS3Client,
  putJsonArtifact,
  putJsonLinesArtifact,
  type S3LikeClient,
} from "../storage/artifactStore.js";
import { storagePaths } from "../storage/layout.js";
import { transcriptTurnUpsertStatement } from "../transcripts/repository.js";
import {
  markReviewReadyIfArtifactsAvailable,
  markSessionReviewReadyIfComplete,
} from "./reviewReady.js";
import { assembleTranscript, type RawTurn } from "./transcript.js";

export interface Queryable {
  query<T = unknown>(
    sql: string,
    params: readonly unknown[],
  ): Promise<{ readonly rows: readonly T[] }>;
}

export interface FinalizedInterviewInput {
  readonly sessionId: string;
  readonly orgId: string;
  readonly scriptVersion: string;
  readonly transcriptTurns: readonly RawTurn[];
  readonly assessment: {
    readonly categoryScores: readonly CategoryScoreInput[];
    readonly meetsBareMinimum: boolean;
    readonly integrityFlags: readonly string[];
  };
  readonly agentEvents: readonly Record<string, unknown>[];
}

export interface FinalizationSessionRow {
  readonly session_id: string;
  readonly org_id: string;
  readonly script_version: string;
}

export interface FinalizationTranscriptTurnRow {
  readonly session_id?: string;
  readonly turn_index: number;
  readonly speaker: string;
  readonly question_id: string | null;
  readonly text: string;
  readonly occurred_at: string | Date;
  readonly offset_ms: number | null;
  readonly source: string;
}

export interface FinalizationAgentEventRow {
  readonly session_id?: string;
  readonly sequence: number;
  readonly turn_index: number | null;
  readonly utterance: string;
  readonly reason_code: string;
  readonly question_id: string | null;
  readonly category: string | null;
  readonly missing_element: string | null;
  readonly occurred_at: string | Date;
}

export interface FinalizationScoreCheckpointAssessment {
  readonly category: string;
  readonly provisionalScore: number;
  readonly confidence: number;
  readonly evidenceQuotes: readonly string[];
  readonly missingOrAmbiguous: readonly string[];
}

export interface FinalizationScoreCheckpointRow {
  readonly session_id?: string;
  readonly sequence: number;
  readonly question_id: string;
  readonly model: string;
  readonly assessments: readonly FinalizationScoreCheckpointAssessment[];
}

interface RawFinalizationScoreCheckpointRow {
  readonly session_id?: string;
  readonly sequence: number;
  readonly question_id: string;
  readonly model: string;
  readonly assessments: unknown;
}

export interface FinalizationMetadata {
  readonly completionReason: string;
  readonly scriptVersion: string;
  readonly finalTurnCount: number;
  readonly integrityFlags: readonly string[];
  readonly agentEventCount: number;
  readonly scoreCheckpointCount?: number;
}

export interface BuildFinalArtifactsInput {
  readonly session: FinalizationSessionRow;
  readonly transcriptTurns: readonly FinalizationTranscriptTurnRow[];
  readonly agentEvents: readonly FinalizationAgentEventRow[];
  readonly scoreCheckpoints: readonly FinalizationScoreCheckpointRow[];
  readonly finalization: FinalizationMetadata;
}

export interface PersistFinalArtifactsInput {
  readonly pool: Queryable;
  readonly sessionId: string;
  readonly finalization: FinalizationMetadata;
  readonly s3Client?: S3LikeClient;
  readonly bucket?: string;
}

export interface FinalArtifactDescriptor {
  readonly storagePath: string;
  readonly body: Record<string, unknown>;
}

export interface FinalJsonLinesArtifactDescriptor {
  readonly storagePath: string;
  readonly rows: readonly unknown[];
}

export interface FinalScoreArtifactScore {
  readonly category: string;
  readonly score: number;
  readonly confidence: number;
  readonly evidenceQuotes: readonly string[];
  readonly missingOrAmbiguous: readonly string[];
  readonly questionId: string;
  readonly model: string;
}

export interface FinalArtifacts {
  readonly transcript: FinalArtifactDescriptor;
  readonly agentEvents: FinalJsonLinesArtifactDescriptor;
  readonly scores: FinalArtifactDescriptor & {
    readonly body: Record<string, unknown> & {
      readonly categoryScores: readonly FinalScoreArtifactScore[];
    };
  };
  readonly integrityFlags: FinalArtifactDescriptor;
}

function isoTimestamp(value: string | Date): string {
  return new Date(value).toISOString();
}

export function buildFinalizationArtifacts(input: FinalizedInterviewInput) {
  const paths = storagePaths(input.orgId, input.sessionId);
  const transcript = assembleTranscript(input.transcriptTurns);
  return {
    transcript: {
      storagePath: paths.transcripts.transcript,
      body: transcript,
    },
    scores: {
      storagePath: paths.assessment.scores,
      body: {
        session_id: input.sessionId,
        script_version: input.scriptVersion,
        category_scores: input.assessment.categoryScores,
        meets_bare_minimum: input.assessment.meetsBareMinimum,
      },
    },
    integrityFlags: {
      storagePath: paths.assessment.integrityFlags,
      body: input.assessment.integrityFlags,
    },
    agentEvents: {
      storagePath: paths.events.agentEvents,
      rows: input.agentEvents,
    },
  };
}

export function buildFinalArtifacts(input: BuildFinalArtifactsInput): FinalArtifacts {
  const paths = storagePaths(input.session.org_id, input.session.session_id);
  const latestAssessments = new Map<string, FinalScoreArtifactScore>();

  for (const checkpoint of input.scoreCheckpoints) {
    for (const assessment of checkpoint.assessments) {
      latestAssessments.set(assessment.category, {
        category: assessment.category,
        score: assessment.provisionalScore,
        confidence: assessment.confidence,
        evidenceQuotes: assessment.evidenceQuotes,
        missingOrAmbiguous: assessment.missingOrAmbiguous,
        questionId: checkpoint.question_id,
        model: checkpoint.model,
      });
    }
  }

  return {
    transcript: {
      storagePath: paths.transcripts.transcript,
      body: {
        version: "v1",
        sessionId: input.session.session_id,
        scriptVersion: input.session.script_version,
        turns: input.transcriptTurns.map((turn) => ({
          turnIndex: turn.turn_index,
          speaker: turn.speaker,
          questionId: turn.question_id,
          text: turn.text,
          occurredAt: isoTimestamp(turn.occurred_at),
          offsetMs: turn.offset_ms,
          source: turn.source,
        })),
      },
    },
    agentEvents: {
      storagePath: paths.events.agentEvents,
      rows: input.agentEvents.map((event) => ({
        sequence: event.sequence,
        turnIndex: event.turn_index,
        utterance: event.utterance,
        reasonCode: event.reason_code,
        questionId: event.question_id,
        category: event.category,
        missingElement: event.missing_element,
        occurredAt: isoTimestamp(event.occurred_at),
      })),
    },
    scores: {
      storagePath: paths.assessment.scores,
      body: {
        sessionId: input.session.session_id,
        scriptVersion: input.finalization.scriptVersion,
        completionReason: input.finalization.completionReason,
        categoryScores: [...latestAssessments.values()],
      },
    },
    integrityFlags: {
      storagePath: paths.assessment.integrityFlags,
      body: {
        sessionId: input.session.session_id,
        integrityFlags: input.finalization.integrityFlags,
      },
    },
  };
}

export async function persistFinalizedInterview(
  pool: Pick<Pool, "query">,
  s3: S3LikeClient,
  bucket: string,
  input: FinalizedInterviewInput,
): Promise<void> {
  const artifacts = buildFinalizationArtifacts(input);

  for (const turn of input.transcriptTurns) {
    const stmt = transcriptTurnUpsertStatement({
      sessionId: input.sessionId,
      turnIndex: turn.turnIndex,
      speaker: turn.speaker,
      questionId: turn.questionId,
      text: turn.text,
      source: "livekit-agent",
    });
    await pool.query(stmt.sql, [...stmt.params]);
  }

  const assessmentStmt = assessmentUpsertStatement({
    sessionId: input.sessionId,
    scriptVersion: input.scriptVersion,
    categoryScores: input.assessment.categoryScores,
    meetsBareMinimum: input.assessment.meetsBareMinimum,
    integrityFlags: input.assessment.integrityFlags,
  });
  await pool.query(assessmentStmt.sql, [...assessmentStmt.params]);

  await putJsonArtifact(s3, {
    bucket,
    storagePath: artifacts.transcript.storagePath,
    body: artifacts.transcript.body,
  });
  await putJsonArtifact(s3, {
    bucket,
    storagePath: artifacts.scores.storagePath,
    body: artifacts.scores.body,
  });
  await putJsonArtifact(s3, {
    bucket,
    storagePath: artifacts.integrityFlags.storagePath,
    body: artifacts.integrityFlags.body,
  });
  await putJsonLinesArtifact(s3, {
    bucket,
    storagePath: artifacts.agentEvents.storagePath,
    rows: artifacts.agentEvents.rows,
  });

  const artifactRows = [
    ["transcript", artifacts.transcript.storagePath, "application/json"],
    ["scores", artifacts.scores.storagePath, "application/json"],
    ["integrity_flags", artifacts.integrityFlags.storagePath, "application/json"],
    ["agent_events", artifacts.agentEvents.storagePath, "application/x-ndjson"],
  ] as const;

  for (const [kind, storagePath, contentType] of artifactRows) {
    const upsert = recordingArtifactUpsertStatement({
      sessionId: input.sessionId,
      kind,
      storagePath,
      contentType,
      status: "available",
    });
    await pool.query(upsert.sql, [...upsert.params]);
  }

  await markSessionReviewReadyIfComplete(pool, input.sessionId);
}

function normalizeAssessments(
  value: unknown,
): readonly FinalizationScoreCheckpointAssessment[] {
  const parsed = typeof value === "string" ? parseJsonOrNull(value) : value;
  return Array.isArray(parsed)
    ? (parsed as readonly FinalizationScoreCheckpointAssessment[])
    : [];
}

function parseJsonOrNull(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeScoreCheckpointRow(
  row: RawFinalizationScoreCheckpointRow,
): FinalizationScoreCheckpointRow {
  return {
    session_id: row.session_id,
    sequence: row.sequence,
    question_id: row.question_id,
    model: row.model,
    assessments: normalizeAssessments(row.assessments),
  };
}

function assertFinalizationDurableCounts(input: {
  readonly finalization: FinalizationMetadata;
  readonly transcriptTurnCount: number;
  readonly agentEventCount: number;
  readonly scoreCheckpointCount: number;
}): void {
  if (input.transcriptTurnCount !== input.finalization.finalTurnCount) {
    throw new Error(
      `finalTurnCount mismatch: expected ${input.finalization.finalTurnCount} ` +
        `durable transcript_turns rows, found ${input.transcriptTurnCount}`,
    );
  }

  if (input.agentEventCount !== input.finalization.agentEventCount) {
    throw new Error(
      `agentEventCount mismatch: expected ${input.finalization.agentEventCount} ` +
        `durable agent_events rows, found ${input.agentEventCount}`,
    );
  }

  if (
    input.finalization.completionReason === "completed" &&
    input.finalization.scoreCheckpointCount === undefined
  ) {
    throw new Error(
      "scoreCheckpointCount is required for completed finalization before publishing artifacts",
    );
  }

  if (
    input.finalization.scoreCheckpointCount !== undefined &&
    input.scoreCheckpointCount !== input.finalization.scoreCheckpointCount
  ) {
    throw new Error(
      `scoreCheckpointCount mismatch: expected ${input.finalization.scoreCheckpointCount} ` +
        `durable score_checkpoints rows, found ${input.scoreCheckpointCount}`,
    );
  }
}

function sessionByIdStatement(sessionId: string) {
  return {
    sql: "SELECT session_id, org_id, script_version FROM sessions WHERE session_id = $1",
    params: [sessionId],
  };
}

function transcriptTurnsBySessionStatement(sessionId: string) {
  return {
    sql:
      "SELECT session_id, turn_index, speaker, question_id, text, occurred_at, offset_ms, source " +
      "FROM transcript_turns WHERE session_id = $1 ORDER BY turn_index ASC",
    params: [sessionId],
  };
}

function agentEventsBySessionStatement(sessionId: string) {
  return {
    sql:
      "SELECT session_id, sequence, turn_index, utterance, reason_code, question_id, " +
      "category, missing_element, occurred_at " +
      "FROM agent_events WHERE session_id = $1 ORDER BY sequence ASC",
    params: [sessionId],
  };
}

function scoreCheckpointsBySessionStatement(sessionId: string) {
  return {
    sql:
      "SELECT session_id, sequence, question_id, model, assessments " +
      "FROM score_checkpoints WHERE session_id = $1 ORDER BY sequence ASC",
    params: [sessionId],
  };
}

async function markArtifactAvailable(
  pool: Queryable,
  sessionId: string,
  kind: RecordingArtifactKind,
): Promise<void> {
  const stmt = recordingArtifactStatusUpdateStatement({
    sessionId,
    kind,
    status: "available",
  });
  await pool.query(stmt.sql, stmt.params);
}

function finalScoreToAssessment(score: FinalScoreArtifactScore): CategoryScoreInput {
  return {
    category: score.category,
    score: score.score,
    confidence: score.confidence,
    evidenceQuotes: score.evidenceQuotes,
    rationale: score.missingOrAmbiguous.length
      ? `Missing or ambiguous: ${score.missingOrAmbiguous.join("; ")}`
      : "Generated from final streaming score checkpoint.",
    lowConfidence: score.confidence < 0.7 || score.missingOrAmbiguous.length > 0,
  };
}

export async function persistFinalArtifacts(
  input: PersistFinalArtifactsInput,
): Promise<void> {
  const bucket = input.bucket ?? process.env.PUDDLE_ARTIFACTS_BUCKET;
  if (!bucket) {
    throw new Error("PUDDLE_ARTIFACTS_BUCKET is required to persist final artifacts");
  }

  const sessionStmt = sessionByIdStatement(input.sessionId);
  const sessionResult = await input.pool.query<FinalizationSessionRow>(
    sessionStmt.sql,
    sessionStmt.params,
  );
  const session = sessionResult.rows[0];
  if (!session) {
    throw new Error(`session ${input.sessionId} not found`);
  }

  const transcriptStmt = transcriptTurnsBySessionStatement(input.sessionId);
  const transcriptTurns = await input.pool.query<FinalizationTranscriptTurnRow>(
    transcriptStmt.sql,
    transcriptStmt.params,
  );

  const agentEventsStmt = agentEventsBySessionStatement(input.sessionId);
  const agentEvents = await input.pool.query<FinalizationAgentEventRow>(
    agentEventsStmt.sql,
    agentEventsStmt.params,
  );

  const scoreCheckpointsStmt = scoreCheckpointsBySessionStatement(input.sessionId);
  const rawScoreCheckpoints =
    await input.pool.query<RawFinalizationScoreCheckpointRow>(
      scoreCheckpointsStmt.sql,
      scoreCheckpointsStmt.params,
    );

  assertFinalizationDurableCounts({
    finalization: input.finalization,
    transcriptTurnCount: transcriptTurns.rows.length,
    agentEventCount: agentEvents.rows.length,
    scoreCheckpointCount: rawScoreCheckpoints.rows.length,
  });

  const artifacts = buildFinalArtifacts({
    session,
    transcriptTurns: transcriptTurns.rows,
    agentEvents: agentEvents.rows,
    scoreCheckpoints: rawScoreCheckpoints.rows.map(normalizeScoreCheckpointRow),
    finalization: input.finalization,
  });
  const s3Client = input.s3Client ?? createArtifactS3Client();

  await putJsonArtifact(s3Client, {
    bucket,
    storagePath: artifacts.transcript.storagePath,
    body: artifacts.transcript.body,
  });
  await putJsonLinesArtifact(s3Client, {
    bucket,
    storagePath: artifacts.agentEvents.storagePath,
    rows: artifacts.agentEvents.rows,
  });
  await putJsonArtifact(s3Client, {
    bucket,
    storagePath: artifacts.scores.storagePath,
    body: artifacts.scores.body,
  });
  await putJsonArtifact(s3Client, {
    bucket,
    storagePath: artifacts.integrityFlags.storagePath,
    body: artifacts.integrityFlags.body,
  });

  const categoryScores = artifacts.scores.body.categoryScores.map(
    finalScoreToAssessment,
  );
  const assessmentStmt = assessmentUpsertStatement({
    sessionId: input.sessionId,
    scriptVersion: input.finalization.scriptVersion,
    categoryScores,
    meetsBareMinimum: categoryScores.length > 0,
    integrityFlags: input.finalization.integrityFlags,
  });
  await input.pool.query(assessmentStmt.sql, assessmentStmt.params);

  await markArtifactAvailable(input.pool, input.sessionId, "transcript");
  await markArtifactAvailable(input.pool, input.sessionId, "agent_events");
  await markArtifactAvailable(input.pool, input.sessionId, "scores");
  await markArtifactAvailable(input.pool, input.sessionId, "integrity_flags");
  await markReviewReadyIfArtifactsAvailable(input.sessionId, input.pool);
}
