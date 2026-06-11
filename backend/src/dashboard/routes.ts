import type { FastifyInstance } from "fastify";
import { getPool } from "../db/pool.js";
import {
  createArtifactS3Client,
  signedArtifactUrl,
} from "../storage/artifactStore.js";
import { interviewDetailStatement, interviewListStatement } from "./interviews.js";

const SIGNED_URL_TTL_SECONDS = 15 * 60;

function artifactsBucketFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const bucket = env.PUDDLE_ARTIFACTS_BUCKET?.trim();
  if (!bucket) {
    throw new Error("PUDDLE_ARTIFACTS_BUCKET must be set for dashboard media URLs");
  }
  return bucket;
}

export function registerDashboardRoutes(app: FastifyInstance): void {
  app.get("/internal/interviews", async (_request, reply) => {
    const stmt = interviewListStatement({ limit: 100 });
    const result = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.code(200).send({ interviews: result.rows });
  });

  app.get<{ Params: { sessionId: string } }>(
    "/internal/interviews/:sessionId",
    async (request, reply) => {
      const stmt = interviewDetailStatement(request.params.sessionId);
      const result = await getPool().query(stmt.sql, [...stmt.params]);
      const packet = result.rows[0];
      if (!packet) {
        return reply.code(404).send({ error: "interview not found" });
      }

      const artifacts = Array.isArray(packet.artifacts) ? packet.artifacts : [];
      const composite = artifacts.find(
        (artifact: { kind?: string; status?: string }) =>
          artifact.kind === "composite_video" && artifact.status === "available",
      );
      const compositeVideoUrl = composite?.storagePath
        ? await signedArtifactUrl(createArtifactS3Client(), {
            bucket: artifactsBucketFromEnv(),
            storagePath: composite.storagePath,
            expiresInSeconds: SIGNED_URL_TTL_SECONDS,
          })
        : null;

      return reply.code(200).send({ interview: { ...packet, compositeVideoUrl } });
    },
  );
}
