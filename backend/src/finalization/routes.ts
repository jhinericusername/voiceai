import type { FastifyInstance } from "fastify";
import { getPool } from "../db/pool.js";
import { createArtifactS3Client } from "../storage/artifactStore.js";
import {
  persistFinalizedInterview,
  type FinalizedInterviewInput,
} from "./persist.js";

interface FinalizationParams {
  readonly sessionId: string;
}

function artifactsBucketFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const bucket = env.PUDDLE_ARTIFACTS_BUCKET?.trim();
  if (!bucket) {
    throw new Error("PUDDLE_ARTIFACTS_BUCKET must be set to finalize interviews");
  }
  return bucket;
}

function hasMatchingSessionId(
  params: FinalizationParams,
  body: FinalizedInterviewInput | undefined,
): body is FinalizedInterviewInput {
  return Boolean(body?.sessionId && body.sessionId === params.sessionId);
}

export function registerFinalizationRoutes(app: FastifyInstance): void {
  app.post<{ Params: FinalizationParams; Body: FinalizedInterviewInput }>(
    "/internal/sessions/:sessionId/finalize",
    async (request, reply) => {
      if (!hasMatchingSessionId(request.params, request.body)) {
        return reply.code(400).send({ error: "session id mismatch" });
      }

      await persistFinalizedInterview(
        getPool(),
        createArtifactS3Client(),
        artifactsBucketFromEnv(),
        request.body,
      );

      return reply.code(202).send({ ok: true });
    },
  );
}
