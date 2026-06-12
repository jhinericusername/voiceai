import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { getPool } from "../db/pool.js";
import { persistOpsEvent } from "../events/repository.js";
import { persistFinalArtifacts } from "../finalization/persist.js";
import { sessionStatusUpdateStatement } from "../scheduler/sessions.js";
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
} from "./streamingArtifacts.js";
import { transcriptTurnUpsertStatement } from "../transcripts/repository.js";

interface InternalSessionParams {
  readonly sessionId: string;
}

interface InternalSessionEventBody {
  readonly eventType?: string;
  readonly payload?: Record<string, unknown>;
  readonly status?: "incomplete";
  readonly endedAt?: string;
}

function validEventType(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{1,80}$/.test(value);
}

type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function normalizeTranscriptQuestionId(value: unknown): ValidationResult<string | null> {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string" || !value.trim()) {
    return {
      ok: false,
      reason: "questionId must be a non-empty string when provided",
    };
  }
  return { ok: true, value: value.trim() };
}

function normalizeTranscriptSource(value: unknown): ValidationResult<string> {
  if (value === undefined) {
    return { ok: true, value: "livekit" };
  }
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, reason: "source must be a non-empty string when provided" };
  }
  return { ok: true, value: value.trim() };
}

function normalizeTranscriptUnreliable(value: unknown): ValidationResult<boolean> {
  if (value !== undefined && typeof value !== "boolean") {
    return { ok: false, reason: "unreliable must be a boolean when provided" };
  }
  return { ok: true, value: value === true };
}

async function withInternalSessionTransaction<T>(
  work: (client: Pick<PoolClient, "query">) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  let result: T;
  try {
    await client.query("BEGIN");
    result = await work(client);
    await client.query("COMMIT");
  } catch (err) {
    let releaseError: Error | boolean | undefined;
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      releaseError = rollbackErr instanceof Error ? rollbackErr : true;
    }
    try {
      if (releaseError === undefined) {
        client.release();
      } else {
        client.release(releaseError);
      }
    } catch {
      // Preserve the original transaction failure.
    }
    throw err;
  }

  try {
    client.release();
  } catch {
    // Preserve the committed transaction result.
  }
  return result;
}

export function registerInternalSessionRoutes(app: FastifyInstance): void {
  app.post<{ Params: InternalSessionParams; Body: unknown }>(
    "/internal/sessions/:sessionId/transcript-turns",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        return reply.code(400).send({ error: "missing session id" });
      }

      const validation = validateStreamingTranscriptTurn(request.body ?? {});
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.reason });
      }

      const body = request.body as StreamingTranscriptTurnBody;
      const rawBody = request.body as Record<string, unknown>;
      const questionId = normalizeTranscriptQuestionId(rawBody.questionId);
      if (!questionId.ok) {
        return reply.code(400).send({ error: questionId.reason });
      }
      const source = normalizeTranscriptSource(rawBody.source);
      if (!source.ok) {
        return reply.code(400).send({ error: source.reason });
      }
      const unreliable = normalizeTranscriptUnreliable(rawBody.unreliable);
      if (!unreliable.ok) {
        return reply.code(400).send({ error: unreliable.reason });
      }
      const stmt = transcriptTurnUpsertStatement({
        sessionId,
        turnIndex: body.turnIndex,
        speaker: body.speaker,
        questionId: questionId.value,
        text: body.text,
        occurredAt: body.occurredAt,
        offsetMs: body.offsetMs ?? null,
        source: source.value,
      });

      await withInternalSessionTransaction(async (client) => {
        await client.query(stmt.sql, [...stmt.params]);
        await persistOpsEvent(client, {
          sessionId,
          eventType: "transcript_turn_persisted",
          payload: {
            turn_index: body.turnIndex,
            speaker: body.speaker,
            question_id: questionId.value,
            source: source.value,
            unreliable: unreliable.value,
          },
        });
      });

      return reply.code(202).send({ ok: true });
    },
  );

  app.post<{ Params: InternalSessionParams; Body: unknown }>(
    "/internal/sessions/:sessionId/agent-events",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        return reply.code(400).send({ error: "missing session id" });
      }

      const validation = validateAgentEvent(request.body ?? {});
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.reason });
      }

      const body = request.body as AgentEventBody;
      const stmt = agentEventUpsertStatement(sessionId, body);

      await withInternalSessionTransaction(async (client) => {
        await client.query(stmt.sql, [...stmt.params]);
        await persistOpsEvent(client, {
          sessionId,
          eventType: "agent_event_persisted",
          payload: {
            sequence: body.sequence,
            reason_code: body.reasonCode,
            question_id: body.questionId ?? null,
          },
        });
      });

      return reply.code(202).send({ ok: true });
    },
  );

  app.post<{ Params: InternalSessionParams; Body: unknown }>(
    "/internal/sessions/:sessionId/score-checkpoints",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        return reply.code(400).send({ error: "missing session id" });
      }

      const validation = validateScoreCheckpoint(request.body ?? {});
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.reason });
      }

      const body = request.body as ScoreCheckpointBody;
      if (body.sessionId !== undefined && body.sessionId !== sessionId) {
        return reply.code(400).send({ error: "sessionId does not match path session id" });
      }
      const stmt = scoreCheckpointUpsertStatement(sessionId, body);

      await withInternalSessionTransaction(async (client) => {
        await client.query(stmt.sql, [...stmt.params]);
        await persistOpsEvent(client, {
          sessionId,
          eventType: "score_checkpoint_persisted",
          payload: {
            sequence: body.sequence,
            question_id: body.questionId,
            model: body.model,
            assessment_count: body.assessments.length,
          },
        });
      });

      return reply.code(202).send({ ok: true });
    },
  );

  app.post<{ Params: InternalSessionParams; Body: unknown }>(
    "/internal/sessions/:sessionId/finalize",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        return reply.code(400).send({ error: "missing session id" });
      }

      const validation = validateFinalization(request.body ?? {});
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.reason });
      }

      const body = request.body as FinalizationBody;
      const status = await withInternalSessionTransaction(async (client) => {
        await persistOpsEvent(client, {
          sessionId,
          eventType: "interview_finalization_requested",
          payload: finalizationEventPayload(body),
        });

        if (body.completionReason !== "completed") {
          const statusStmt = sessionStatusUpdateStatement(sessionId, "incomplete", {
            endedAt: new Date().toISOString(),
          });
          await client.query(statusStmt.sql, [...statusStmt.params]);
          return "incomplete";
        }

        const statusStmt = sessionStatusUpdateStatement(
          sessionId,
          "recording_finalizing",
          {
            endedAt: new Date().toISOString(),
          },
        );
        await client.query(statusStmt.sql, [...statusStmt.params]);
        await persistFinalArtifacts({
          pool: client,
          sessionId,
          finalization: {
            completionReason: body.completionReason,
            scriptVersion: body.scriptVersion,
            finalTurnCount: body.finalTurnCount,
            integrityFlags: body.integrityFlags,
            agentEventCount: body.agentEventCount,
            scoreCheckpointCount: body.scoreCheckpointCount,
          },
        });
        return "recording_finalizing";
      });

      return reply.code(202).send({ ok: true, status });
    },
  );

  app.post<{ Params: InternalSessionParams; Body: InternalSessionEventBody }>(
    "/internal/sessions/:sessionId/events",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        return reply.code(400).send({ error: "missing session id" });
      }

      const eventType = request.body?.eventType;
      if (!validEventType(eventType)) {
        return reply.code(400).send({ error: "missing or invalid eventType" });
      }

      if (request.body.status !== undefined && request.body.status !== "incomplete") {
        return reply.code(400).send({ error: "unsupported session status" });
      }

      await withInternalSessionTransaction(async (client) => {
        if (request.body.status !== undefined) {
          const statusStmt = sessionStatusUpdateStatement(sessionId, request.body.status, {
            endedAt: request.body.endedAt ?? new Date().toISOString(),
          });
          await client.query(statusStmt.sql, [...statusStmt.params]);
        }

        await persistOpsEvent(client, {
          sessionId,
          eventType,
          payload: {
            ...(request.body.payload ?? {}),
            ...(request.body.status ? { status: request.body.status } : {}),
          },
        });
      });

      return reply.code(202).send({ ok: true });
    },
  );
}
