import type { FastifyInstance } from "fastify";
import type { SqlStatement } from "../consent/repository.js";
import { getPool } from "../db/pool.js";
import { createArtifactS3Client } from "../storage/artifactStore.js";
import {
  persistFinalizedInterview,
  type FinalizedInterviewInput,
} from "./persist.js";

interface FinalizationParams {
  readonly sessionId: string;
}

interface FinalizationSessionRow {
  readonly session_id: string;
  readonly org_id: string;
  readonly script_version: string;
}

type FinalizationValidation =
  | { readonly ok: true; readonly input: FinalizedInterviewInput }
  | { readonly ok: false; readonly reason: string };

function artifactsBucketFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const bucket = env.PUDDLE_ARTIFACTS_BUCKET?.trim();
  if (!bucket) {
    throw new Error("PUDDLE_ARTIFACTS_BUCKET must be set to finalize interviews");
  }
  return bucket;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isJsonRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function finalizationSessionStatement(sessionId: string): SqlStatement {
  return {
    sql:
      "SELECT session_id, org_id, script_version FROM sessions " +
      "WHERE session_id = $1",
    params: [sessionId],
  };
}

export function validateFinalizedInterviewInput(
  value: unknown,
): FinalizationValidation {
  if (!isRecord(value)) {
    return { ok: false, reason: "body must be an object" };
  }
  if (!isNonEmptyString(value.sessionId)) {
    return { ok: false, reason: "sessionId is required" };
  }
  if (!isNonEmptyString(value.orgId)) {
    return { ok: false, reason: "orgId is required" };
  }
  if (!isNonEmptyString(value.scriptVersion)) {
    return { ok: false, reason: "scriptVersion is required" };
  }

  if (!Array.isArray(value.transcriptTurns)) {
    return { ok: false, reason: "transcriptTurns must be an array" };
  }
  for (const [index, turn] of value.transcriptTurns.entries()) {
    if (!isRecord(turn)) {
      return { ok: false, reason: `transcriptTurns[${index}] must be an object` };
    }
    if (!Number.isInteger(turn.turnIndex) || Number(turn.turnIndex) < 0) {
      return {
        ok: false,
        reason: `transcriptTurns[${index}].turnIndex must be a non-negative integer`,
      };
    }
    if (turn.speaker !== "agent" && turn.speaker !== "candidate") {
      return {
        ok: false,
        reason: `transcriptTurns[${index}].speaker must be agent or candidate`,
      };
    }
    if (typeof turn.text !== "string") {
      return { ok: false, reason: `transcriptTurns[${index}].text is required` };
    }
    if (
      turn.questionId !== undefined &&
      turn.questionId !== null &&
      typeof turn.questionId !== "string"
    ) {
      return {
        ok: false,
        reason: `transcriptTurns[${index}].questionId must be a string or null`,
      };
    }
  }

  if (!isRecord(value.assessment)) {
    return { ok: false, reason: "assessment must be an object" };
  }
  if (!Array.isArray(value.assessment.categoryScores)) {
    return { ok: false, reason: "assessment.categoryScores must be an array" };
  }
  for (const [index, score] of value.assessment.categoryScores.entries()) {
    if (!isRecord(score)) {
      return {
        ok: false,
        reason: `assessment.categoryScores[${index}] must be an object`,
      };
    }
    if (!isNonEmptyString(score.category)) {
      return {
        ok: false,
        reason: `assessment.categoryScores[${index}].category is required`,
      };
    }
    if (typeof score.score !== "number" || !Number.isFinite(score.score)) {
      return {
        ok: false,
        reason: `assessment.categoryScores[${index}].score must be a number`,
      };
    }
    if (typeof score.confidence !== "number" || !Number.isFinite(score.confidence)) {
      return {
        ok: false,
        reason: `assessment.categoryScores[${index}].confidence must be a number`,
      };
    }
    if (!isStringArray(score.evidenceQuotes)) {
      return {
        ok: false,
        reason: `assessment.categoryScores[${index}].evidenceQuotes must be an array`,
      };
    }
    if (typeof score.rationale !== "string") {
      return {
        ok: false,
        reason: `assessment.categoryScores[${index}].rationale is required`,
      };
    }
    if (typeof score.lowConfidence !== "boolean") {
      return {
        ok: false,
        reason: `assessment.categoryScores[${index}].lowConfidence must be boolean`,
      };
    }
  }
  if (typeof value.assessment.meetsBareMinimum !== "boolean") {
    return { ok: false, reason: "assessment.meetsBareMinimum must be boolean" };
  }
  if (!isStringArray(value.assessment.integrityFlags)) {
    return { ok: false, reason: "assessment.integrityFlags must be an array" };
  }
  if (!isJsonRecordArray(value.agentEvents)) {
    return { ok: false, reason: "agentEvents must be an array of objects" };
  }

  return { ok: true, input: value as unknown as FinalizedInterviewInput };
}

export function registerFinalizationRoutes(app: FastifyInstance): void {
  app.post<{ Params: FinalizationParams; Body: unknown }>(
    "/internal/sessions/:sessionId/finalize",
    async (request, reply) => {
      const validation = validateFinalizedInterviewInput(request.body);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.reason });
      }
      if (validation.input.sessionId !== request.params.sessionId) {
        return reply.code(400).send({ error: "session id mismatch" });
      }

      const pool = getPool();
      const sessionStmt = finalizationSessionStatement(request.params.sessionId);
      const sessionResult = await pool.query<FinalizationSessionRow>(
        sessionStmt.sql,
        [...sessionStmt.params],
      );
      const session = sessionResult.rows[0];
      if (!session) {
        return reply.code(404).send({ error: "session not found" });
      }
      if (
        validation.input.orgId !== session.org_id ||
        validation.input.scriptVersion !== session.script_version
      ) {
        return reply.code(400).send({ error: "session metadata mismatch" });
      }

      await persistFinalizedInterview(
        pool,
        createArtifactS3Client(),
        artifactsBucketFromEnv(),
        validation.input,
      );

      return reply.code(202).send({ ok: true });
    },
  );
}
