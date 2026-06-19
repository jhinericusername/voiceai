import type { FastifyInstance } from "fastify";
import type { S3Client } from "@aws-sdk/client-s3";
import { getPool } from "../db/pool.js";
import {
  createArtifactS3Client,
  signedArtifactUrl,
  type S3LikeClient,
  type SignedUrlFn,
} from "../storage/artifactStore.js";
import {
  interviewDetailStatement,
  interviewListStatement,
  roomRecordingListStatement,
} from "./interviews.js";

const SIGNED_URL_TTL_SECONDS = 15 * 60;
type ArtifactLike = {
  readonly kind?: string;
  readonly status?: string;
  readonly storagePath?: string | null;
};
type PlayableArtifactKind = "composite_video" | "candidate_audio";

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

export async function signedArtifactMediaUrl(
  artifacts: readonly ArtifactLike[],
  input: {
    readonly bucket: string | (() => string);
    readonly client: S3Client;
    readonly kind: PlayableArtifactKind;
  },
): Promise<string | null>;
export async function signedArtifactMediaUrl<Client extends S3LikeClient>(
  artifacts: readonly ArtifactLike[],
  input: {
    readonly bucket: string | (() => string);
    readonly client: Client;
    readonly kind: PlayableArtifactKind;
    readonly signer: SignedUrlFn<Client>;
  },
): Promise<string | null>;
export async function signedArtifactMediaUrl<Client extends S3LikeClient>(
  artifacts: readonly ArtifactLike[],
  input: {
    readonly bucket: string | (() => string);
    readonly client: S3Client | Client;
    readonly kind: PlayableArtifactKind;
    readonly signer?: SignedUrlFn<Client>;
  },
): Promise<string | null> {
  const artifact = artifacts.find(
    (artifact) =>
      artifact.kind === input.kind &&
      artifact.status === "available" &&
      Boolean(artifact.storagePath),
  );
  if (!artifact?.storagePath) {
    return null;
  }

  const bucket = typeof input.bucket === "function" ? input.bucket() : input.bucket;

  if (input.signer) {
    return signedArtifactUrl(
      input.client as Client,
      {
        bucket,
        storagePath: artifact.storagePath,
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      },
      input.signer,
    );
  }

  return signedArtifactUrl(input.client as S3Client, {
    bucket,
    storagePath: artifact.storagePath,
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
  });
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
  if (input.signer) {
    return signedArtifactMediaUrl(artifacts, {
      bucket: input.bucket,
      client: input.client as Client,
      kind: "composite_video",
      signer: input.signer,
    });
  }

  return signedArtifactMediaUrl(artifacts, {
    bucket: input.bucket,
    client: input.client as S3Client,
    kind: "composite_video",
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

  app.get<{ Querystring: DashboardQuery }>("/internal/room-recordings", async (request, reply) => {
    const orgId = orgIdFromQuery(request.query);
    if (!orgId) {
      return reply.code(400).send({ error: "orgId is required" });
    }

    const stmt = roomRecordingListStatement({ limit: 500, orgId });
    const result = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.code(200).send({ recordings: result.rows });
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
      const candidateAudioUrl = await signedArtifactMediaUrl(artifacts, {
        bucket: artifactsBucketFromEnv,
        client: createArtifactS3Client(),
        kind: "candidate_audio",
      });

      return reply.code(200).send({ interview: { ...packet, compositeVideoUrl, candidateAudioUrl } });
    },
  );
}
