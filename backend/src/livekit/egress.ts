import {
  EgressClient,
  EgressStatus,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
  WebhookConfig,
  type EgressInfo,
} from "livekit-server-sdk";
import type { RecordingStatus } from "../recordings/repository.js";
import type { LiveKitConfig } from "./provision.js";

export interface LiveKitEgressStorageConfig {
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly assumeRoleArn?: string;
  readonly assumeRoleExternalId?: string;
  readonly endpoint?: string;
  readonly forcePathStyle?: boolean;
}

export interface RoomCompositeRecordingInput {
  readonly liveKitConfig: LiveKitConfig;
  readonly storageConfig: LiveKitEgressStorageConfig;
  readonly room: string;
  readonly storagePath: string;
  readonly webhookUrl?: string;
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} must be set to start LiveKit Egress recording`);
  }
  return value;
}

function optionalEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  return env[key]?.trim() || undefined;
}

function optionalBooleanEnv(env: NodeJS.ProcessEnv, key: string): boolean | undefined {
  const value = optionalEnv(env, key);
  if (!value) {
    return undefined;
  }

  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
}

export function liveKitRecordingsEnabledFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return optionalBooleanEnv(env, "PUDDLE_RECORDINGS_ENABLED") === true;
}

export function liveKitEgressStorageConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LiveKitEgressStorageConfig {
  return {
    bucket: requiredEnv(env, "PUDDLE_ARTIFACTS_BUCKET"),
    region:
      optionalEnv(env, "PUDDLE_ARTIFACTS_REGION") ?? requiredEnv(env, "AWS_REGION"),
    accessKeyId: requiredEnv(env, "PUDDLE_EGRESS_S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv(env, "PUDDLE_EGRESS_S3_SECRET_ACCESS_KEY"),
    sessionToken: optionalEnv(env, "PUDDLE_EGRESS_S3_SESSION_TOKEN"),
    assumeRoleArn: optionalEnv(env, "PUDDLE_EGRESS_S3_ASSUME_ROLE_ARN"),
    assumeRoleExternalId: optionalEnv(env, "PUDDLE_EGRESS_S3_ASSUME_ROLE_EXTERNAL_ID"),
    endpoint: optionalEnv(env, "PUDDLE_EGRESS_S3_ENDPOINT"),
    forcePathStyle: optionalBooleanEnv(env, "PUDDLE_EGRESS_S3_FORCE_PATH_STYLE"),
  };
}

export function liveKitEgressWebhookUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return optionalEnv(env, "PUDDLE_LIVEKIT_WEBHOOK_URL");
}

export function s3KeyFromStoragePath(storagePath: string): string {
  return storagePath.replace(/^\/+/, "");
}

export function buildRoomCompositeFileOutput(
  storage: LiveKitEgressStorageConfig,
  storagePath: string,
): EncodedFileOutput {
  return new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: s3KeyFromStoragePath(storagePath),
    output: {
      case: "s3",
      value: new S3Upload({
        accessKey: storage.accessKeyId,
        secret: storage.secretAccessKey,
        sessionToken: storage.sessionToken ?? "",
        assumeRoleArn: storage.assumeRoleArn ?? "",
        assumeRoleExternalId: storage.assumeRoleArn
          ? (storage.assumeRoleExternalId ?? "")
          : "",
        region: storage.region,
        endpoint: storage.endpoint ?? "",
        bucket: storage.bucket,
        forcePathStyle: storage.forcePathStyle ?? false,
      }),
    },
  });
}

export function recordingStatusFromEgressStatus(status: EgressStatus): RecordingStatus {
  switch (status) {
    case EgressStatus.EGRESS_ACTIVE:
      return "active";
    case EgressStatus.EGRESS_COMPLETE:
      return "complete";
    case EgressStatus.EGRESS_FAILED:
    case EgressStatus.EGRESS_ABORTED:
    case EgressStatus.EGRESS_LIMIT_REACHED:
      return "failed";
    case EgressStatus.EGRESS_STARTING:
    case EgressStatus.EGRESS_ENDING:
    default:
      return "starting";
  }
}

export async function startRoomCompositeRecording(
  input: RoomCompositeRecordingInput,
): Promise<EgressInfo> {
  const egress = new EgressClient(
    input.liveKitConfig.host,
    input.liveKitConfig.apiKey,
    input.liveKitConfig.apiSecret,
  );
  const output = buildRoomCompositeFileOutput(input.storageConfig, input.storagePath);
  const webhooks = input.webhookUrl
    ? [
        new WebhookConfig({
          url: input.webhookUrl,
          signingKey: input.liveKitConfig.apiKey,
        }),
      ]
    : undefined;

  return egress.startRoomCompositeEgress(input.room, output, {
    layout: "grid",
    webhooks,
  });
}
