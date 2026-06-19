import type { GradingModel, GradingModelCompleteOptions } from "./scoring.js";

const defaultModelId = "gpt-5.5";
const defaultBaseUrl = "https://api.openai.com/v1";
const richScorecardMaxOutputTokens = 6000;

export type OpenAIReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type OpenAITextVerbosity = "low" | "medium" | "high";

interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

type FetchLike = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

export interface OpenAIGradingModelConfig {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly modelId?: string;
  readonly reasoningEffort?: OpenAIReasoningEffort;
  readonly verbosity?: OpenAITextVerbosity;
  readonly fetchFn?: FetchLike;
}

export class OpenAIGradingModel implements GradingModel {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly modelId: string;
  private readonly reasoningEffort: OpenAIReasoningEffort;
  private readonly verbosity: OpenAITextVerbosity;
  private readonly fetchFn: FetchLike;

  constructor(config: OpenAIGradingModelConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
    this.baseUrl = stripTrailingSlash(config.baseUrl ?? process.env.OPENAI_BASE_URL ?? defaultBaseUrl);
    this.modelId = config.modelId ?? process.env.PUDDLE_GRADING_MODEL_ID ?? defaultModelId;
    this.reasoningEffort =
      config.reasoningEffort ??
      openaiReasoningEffortFromEnv(process.env.PUDDLE_GRADING_OPENAI_REASONING_EFFORT) ??
      "high";
    this.verbosity =
      config.verbosity ??
      openaiVerbosityFromEnv(process.env.PUDDLE_GRADING_OPENAI_VERBOSITY) ??
      "low";
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async complete(prompt: string, options?: GradingModelCompleteOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY must be set to use the OpenAI grading model.");
    }

    const response = await this.fetchFn(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.modelId,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
        reasoning: { effort: this.reasoningEffort },
        text: {
          verbosity: this.verbosity,
          format: { type: "text" },
        },
        max_output_tokens: richScorecardMaxOutputTokens,
        store: false,
      }),
      ...(options?.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI grading model request failed with HTTP ${response.status}: ${body}`);
    }

    const body = await response.json();
    const text = extractOutputText(body);
    if (!text.trim()) {
      throw new Error("OpenAI grading model returned no text content.");
    }
    return text;
  }
}

function extractOutputText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  if (typeof record.output_text === "string") {
    return record.output_text;
  }

  const output = Array.isArray(record.output) ? record.output : [];
  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const content = (item as Record<string, unknown>).content;
      return Array.isArray(content) ? content : [];
    })
    .flatMap((content) => {
      if (!content || typeof content !== "object") {
        return [];
      }
      const contentRecord = content as Record<string, unknown>;
      return contentRecord.type === "output_text" && typeof contentRecord.text === "string"
        ? [contentRecord.text]
        : [];
    })
    .join("");
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function openaiReasoningEffortFromEnv(value: string | undefined): OpenAIReasoningEffort | undefined {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : undefined;
}

function openaiVerbosityFromEnv(value: string | undefined): OpenAITextVerbosity | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}
