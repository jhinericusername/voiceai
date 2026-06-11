import type { FastifyInstance } from "fastify";
import type { S3Client } from "@aws-sdk/client-s3";
import { getPool } from "../db/pool.js";
import {
  createArtifactS3Client,
  signedArtifactUrl,
  type S3LikeClient,
  type SignedUrlFn,
} from "../storage/artifactStore.js";
import { interviewDetailStatement, interviewListStatement } from "./interviews.js";

const SIGNED_URL_TTL_SECONDS = 15 * 60;
type ArtifactLike = {
  readonly kind?: string;
  readonly status?: string;
  readonly storagePath?: string | null;
};

type DashboardQuery = {
  readonly orgId?: string;
};

function artifactsBucketFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const bucket = env.PUDDLE_ARTIFACTS_BUCKET?.trim();
  if (!bucket) {
    throw new Error("PUDDLE_ARTIFACTS_BUCKET must be set for dashboard media URLs");
  }
  return bucket;
}

export async function signedCompositeVideoUrl(
  artifacts: readonly ArtifactLike[],
  input: {
    readonly bucket: string | (() => string);
    readonly client: S3Client;
  },
): Promise<string | null>;
export async function signedCompositeVideoUrl<Client extends S3LikeClient>(
  artifacts: readonly ArtifactLike[],
  input: {
    readonly bucket: string | (() => string);
    readonly client: Client;
    readonly signer: SignedUrlFn<Client>;
  },
): Promise<string | null>;
export async function signedCompositeVideoUrl<Client extends S3LikeClient>(
  artifacts: readonly ArtifactLike[],
  input: {
    readonly bucket: string | (() => string);
    readonly client: S3Client | Client;
    readonly signer?: SignedUrlFn<Client>;
  },
): Promise<string | null> {
  const composite = artifacts.find(
    (artifact) =>
      artifact.kind === "composite_video" &&
      artifact.status === "available" &&
      Boolean(artifact.storagePath),
  );
  if (!composite?.storagePath) {
    return null;
  }

  const bucket = typeof input.bucket === "function" ? input.bucket() : input.bucket;

  if (input.signer) {
    return signedArtifactUrl(
      input.client as Client,
      {
        bucket,
        storagePath: composite.storagePath,
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      },
      input.signer,
    );
  }

  return signedArtifactUrl(input.client as S3Client, {
    bucket,
    storagePath: composite.storagePath,
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
  });
}

function orgIdFromQuery(query: DashboardQuery): string | null {
  const orgId = query.orgId?.trim();
  return orgId || null;
}

export function registerDashboardRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: DashboardQuery }>("/internal/interviews", async (request, reply) => {
    const orgId = orgIdFromQuery(request.query);
    if (!orgId) {
      return reply.code(400).send({ error: "orgId is required" });
    }

    const stmt = interviewListStatement({ limit: 100, orgId });
    const result = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.code(200).send({ interviews: result.rows });
  });

  app.get<{ Params: { sessionId: string }; Querystring: DashboardQuery }>(
    "/internal/interviews/:sessionId",
    async (request, reply) => {
      const orgId = orgIdFromQuery(request.query);
      if (!orgId) {
        return reply.code(400).send({ error: "orgId is required" });
      }

      const stmt = interviewDetailStatement(request.params.sessionId, orgId);
      const result = await getPool().query(stmt.sql, [...stmt.params]);
      const packet = result.rows[0];
      if (!packet) {
        return reply.code(404).send({ error: "interview not found" });
      }

      const artifacts = Array.isArray(packet.artifacts) ? packet.artifacts : [];
      const compositeVideoUrl = await signedCompositeVideoUrl(artifacts, {
        bucket: artifactsBucketFromEnv,
        client: createArtifactS3Client(),
      });

      return reply.code(200).send({ interview: { ...packet, compositeVideoUrl } });
    },
  );
}
