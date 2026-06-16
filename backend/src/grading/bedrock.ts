import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { GradingModel } from "./scoring.js";

export class BedrockGradingModel implements GradingModel {
  constructor(
    private readonly client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
    private readonly modelId = process.env.PUDDLE_GRADING_MODEL_ID ?? "us.anthropic.claude-opus-4-8",
  ) {}

  async complete(prompt: string): Promise<string> {
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
          maxTokens: 2000,
        },
      }),
    );

    const blocks = response.output?.message?.content ?? [];
    const text = blocks.map((block) => block.text ?? "").join("");
    if (!text.trim()) {
      throw new Error("Bedrock grading model returned no text content.");
    }
    return text;
  }
}
