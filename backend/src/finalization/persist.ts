import type { Pool } from "pg";
import {
  assessmentUpsertStatement,
  type CategoryScoreInput,
} from "../assessments/repository.js";
import {
  recordingArtifactUpsertStatement,
} from "../recordings/repository.js";
import { storagePaths } from "../storage/layout.js";
import {
  putJsonArtifact,
  putJsonLinesArtifact,
  type S3LikeClient,
} from "../storage/artifactStore.js";
import { transcriptTurnUpsertStatement } from "../transcripts/repository.js";
import { markSessionReviewReadyIfComplete } from "./reviewReady.js";
import { assembleTranscript, type RawTurn } from "./transcript.js";

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
