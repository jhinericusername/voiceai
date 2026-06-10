import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3LikeClient {
  send(command: unknown): Promise<unknown>;
}

export type SignedUrlFn<Client extends S3LikeClient = S3Client> = (
  client: Client,
  command: GetObjectCommand,
  options: { readonly expiresIn: number },
) => Promise<string>;

export interface SignedArtifactUrlInput {
  readonly bucket: string;
  readonly storagePath: string;
  readonly expiresInSeconds: number;
}

export function createArtifactS3Client(region = process.env.AWS_REGION): S3Client {
  return new S3Client({ region });
}

export function artifactS3Key(storagePath: string): string {
  const key = storagePath.replace(/^\/+/, "");
  if (!key) {
    throw new Error("storagePath must produce a non-empty S3 key");
  }
  return key;
}

function jsonStringify(value: unknown, label: string, space?: number): string {
  const serialized = JSON.stringify(value, null, space);
  if (serialized === undefined) {
    throw new Error(`${label} must be JSON-serializable`);
  }
  return serialized;
}

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
      Body: `${jsonStringify(input.body, "body", 2)}\n`,
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
  const body = input.rows.map((row, index) => jsonStringify(row, `rows[${index}]`)).join("\n");
  await client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: artifactS3Key(input.storagePath),
      Body: body ? `${body}\n` : "",
      ContentType: "application/x-ndjson",
    }),
  );
}

export function signedArtifactUrl(
  client: S3Client,
  input: SignedArtifactUrlInput,
): Promise<string>;
export function signedArtifactUrl<Client extends S3LikeClient>(
  client: Client,
  input: SignedArtifactUrlInput,
  signer: SignedUrlFn<Client>,
): Promise<string>;
export async function signedArtifactUrl<Client extends S3LikeClient>(
  client: S3Client | Client,
  input: SignedArtifactUrlInput,
  signer?: SignedUrlFn<Client>,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: input.bucket,
    Key: artifactS3Key(input.storagePath),
  });
  const options = { expiresIn: input.expiresInSeconds };
  if (signer) {
    return signer(client as Client, command, options);
  }
  return getSignedUrl(client as S3Client, command, options);
}
