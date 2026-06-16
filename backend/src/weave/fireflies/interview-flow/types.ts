export interface ManifestEntry {
  readonly transcriptId: string;
  readonly candidateName: string | null;
  readonly s3Bucket: string;
  readonly transcriptKey: string;
}

export interface ManifestFile {
  readonly version: 1;
  readonly createdAt: string;
  readonly bucket: string;
  readonly prefix: string;
  readonly limit: number;
  readonly entries: readonly ManifestEntry[];
}

export interface TranscriptInput {
  readonly transcriptId: string;
  readonly candidateName: string | null;
  readonly transcriptText: string;
}

export interface RunLogEvent {
  readonly timestamp: string;
  readonly level: "info" | "warn" | "error";
  readonly event: string;
  readonly transcriptId?: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface S3TranscriptClient {
  listTranscriptKeys(input: { readonly bucket: string; readonly prefix: string }): Promise<string[]>;
  getJsonObject(input: { readonly bucket: string; readonly key: string }): Promise<unknown>;
}

export interface BedrockJsonClient {
  invokeJsonPrompt(input: {
    readonly prompt: string;
    readonly maxTokens: number;
    readonly label: string;
  }): Promise<string>;
}
