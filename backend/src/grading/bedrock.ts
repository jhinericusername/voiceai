import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { GradingModel, GradingModelCompleteOptions } from "./scoring.js";

const defaultModelId = "us.anthropic.claude-opus-4-8";
const defaultRegion = "us-east-1";
const richScorecardMaxTokens = 6000;

export interface BedrockGradingModelConfig {
  readonly client?: BedrockRuntimeClient;
  readonly region?: string;
  readonly modelId?: string;
}

export class BedrockGradingModel implements GradingModel {
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;

  constructor(clientOrConfig?: BedrockRuntimeClient | BedrockGradingModelConfig, modelId?: string) {
    if (clientOrConfig === undefined || isBedrockGradingModelConfig(clientOrConfig)) {
      this.client =
        clientOrConfig?.client ??
        new BedrockRuntimeClient({
          region: clientOrConfig?.region ?? process.env.AWS_REGION ?? defaultRegion,
        });
      this.modelId = clientOrConfig?.modelId ?? process.env.PUDDLE_GRADING_MODEL_ID ?? defaultModelId;
      return;
    }

    this.client = clientOrConfig;
    this.modelId = modelId ?? process.env.PUDDLE_GRADING_MODEL_ID ?? defaultModelId;
  }

  async complete(prompt: string, options?: GradingModelCompleteOptions): Promise<string> {
    const response = await this.client.send(
      new ConverseCommand({
        modelId: this.modelId,
        messages: [
          {
            role: "user",
            content: [{ text: prompt }],
          },
        ],
        inferenceConfig: {
          maxTokens: richScorecardMaxTokens,
        },
      }),
      options?.signal ? { abortSignal: options.signal } : undefined,
    );

    const blocks = response.output?.message?.content ?? [];
    const text = blocks.map((block) => block.text ?? "").join("");
    if (!text.trim()) {
      throw new Error("Bedrock grading model returned no text content.");
    }
    return text;
  }
}

function isBedrockGradingModelConfig(value: unknown): value is BedrockGradingModelConfig {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return "client" in record || "region" in record || "modelId" in record;
}
