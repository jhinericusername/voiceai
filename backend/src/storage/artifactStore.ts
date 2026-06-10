import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3LikeClient {
  send(command: unknown): Promise<unknown>;
}

export type SignedUrlFn = (
  client: S3LikeClient,
  command: GetObjectCommand,
  options: { readonly expiresIn: number },
) => Promise<string>;

export function createArtifactS3Client(region = process.env.AWS_REGION): S3Client {
  return new S3Client({ region });
}

export function artifactS3Key(storagePath: string): string {
  return storagePath.replace(/^\/+/, "");
}

const defaultSignedUrl: SignedUrlFn = (client, command, options) =>
  getSignedUrl(client as S3Client, command, options);

export async function putJsonArtifact(
  client: S3LikeClient,
  input: {
    readonly bucket: string;
    readonly storagePath: string;
    readonly body: unknown;
  },
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: artifactS3Key(input.storagePath),
      Body: `${JSON.stringify(input.body, null, 2)}\n`,
      ContentType: "application/json",
    }),
  );
}

export async function putJsonLinesArtifact(
  client: S3LikeClient,
  input: {
    readonly bucket: string;
    readonly storagePath: string;
    readonly rows: readonly unknown[];
  },
): Promise<void> {
  const body = input.rows.map((row) => JSON.stringify(row)).join("\n");
  await client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: artifactS3Key(input.storagePath),
      Body: body ? `${body}\n` : "",
      ContentType: "application/x-ndjson",
    }),
  );
}

export async function signedArtifactUrl(
  client: S3LikeClient,
  signer: SignedUrlFn = defaultSignedUrl,
  input: {
    readonly bucket: string;
    readonly storagePath: string;
    readonly expiresInSeconds: number;
  },
): Promise<string> {
  return signer(
    client,
    new GetObjectCommand({
      Bucket: input.bucket,
      Key: artifactS3Key(input.storagePath),
    }),
    { expiresIn: input.expiresInSeconds },
  );
}
