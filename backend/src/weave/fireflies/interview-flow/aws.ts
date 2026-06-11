import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { BedrockJsonClient, S3TranscriptClient } from "./types.js";

interface SendClient {
  send(command: unknown): Promise<unknown>;
}

export function createS3TranscriptClient(region: string): S3TranscriptClient {
  return makeS3TranscriptClient(new S3Client({ region }) as SendClient);
}

export function makeS3TranscriptClient(client: SendClient): S3TranscriptClient {
  return {
    async listTranscriptKeys(input) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const response = (await client.send(
          new ListObjectsV2Command({
            Bucket: input.bucket,
            Prefix: input.prefix,
            ContinuationToken: token,
          }),
        )) as { Contents?: Array<{ Key?: string }>; NextContinuationToken?: string };
        for (const object of response.Contents ?? []) {
          if (object.Key) {
            keys.push(object.Key);
          }
        }
        token = response.NextContinuationToken;
      } while (token);
      return keys;
    },
    async getJsonObject(input) {
      const response = (await client.send(
        new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
      )) as { Body?: { transformToString?: () => Promise<string> } };
      const body = await response.Body?.transformToString?.();
      if (!body) {
        throw new Error(`S3 object has empty body: s3://${input.bucket}/${input.key}`);
      }
      return JSON.parse(body);
    },
  };
}

export function createBedrockJsonClient(region: string, modelId: string): BedrockJsonClient {
  return makeBedrockJsonClient({
    modelId,
    client: new BedrockRuntimeClient({ region }) as SendClient,
  });
}

export function makeBedrockJsonClient(input: {
  readonly modelId: string;
  readonly client: SendClient;
}): BedrockJsonClient {
  return {
    async invokeJsonPrompt(request) {
      const response = (await input.client.send(
        new ConverseCommand({
          modelId: input.modelId,
          messages: [{ role: "user", content: [{ text: request.prompt }] }],
          inferenceConfig: { maxTokens: request.maxTokens },
        }),
      )) as { output?: { message?: { content?: Array<{ text?: string }> } } };
      const text = response.output?.message?.content?.find((part) => part.text)?.text;
      if (!text) {
        throw new Error(`Bedrock response did not include text for ${request.label}`);
      }
      return text;
    },
  };
}
