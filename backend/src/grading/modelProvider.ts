import { BedrockGradingModel } from "./bedrock.js";
import {
  OpenAIGradingModel,
  type OpenAIReasoningEffort,
  type OpenAITextVerbosity,
} from "./openai.js";
import type { GradingModel } from "./scoring.js";

type GradingModelProvider = "bedrock" | "openai";

interface EnvLike {
  readonly [key: string]: string | undefined;
}

export type GradingModelMetadata =
  | {
      readonly provider: "bedrock";
      readonly region: string;
      readonly modelId: string;
    }
  | {
      readonly provider: "openai";
      readonly modelId: string;
      readonly reasoningEffort: OpenAIReasoningEffort;
      readonly verbosity: OpenAITextVerbosity;
    };

export interface GradingModelSelection {
  readonly model: GradingModel;
  readonly metadata: GradingModelMetadata;
}

const defaultBedrockRegion = "us-east-1";
const defaultBedrockModelId = "us.anthropic.claude-opus-4-8";
const defaultOpenAIModelId = "gpt-5.5";
const modelProviders = ["bedrock", "openai"] as const;
const openaiReasoningEfforts = ["low", "medium", "high", "xhigh"] as const;
const openaiVerbosities = ["low", "medium", "high"] as const;

export function createGradingModelSelection(env: EnvLike = process.env): GradingModelSelection {
  const provider = parseEnumEnv(
    nonEmptyString(env.PUDDLE_GRADING_MODEL_PROVIDER),
    "PUDDLE_GRADING_MODEL_PROVIDER",
    modelProviders,
    "bedrock",
  );

  if (provider === "openai") {
    const modelId = nonEmptyString(env.PUDDLE_GRADING_MODEL_ID) ?? defaultOpenAIModelId;
    const reasoningEffort = parseEnumEnv(
      nonEmptyString(env.PUDDLE_GRADING_OPENAI_REASONING_EFFORT),
      "PUDDLE_GRADING_OPENAI_REASONING_EFFORT",
      openaiReasoningEfforts,
      "high",
    );
    const verbosity = parseEnumEnv(
      nonEmptyString(env.PUDDLE_GRADING_OPENAI_VERBOSITY),
      "PUDDLE_GRADING_OPENAI_VERBOSITY",
      openaiVerbosities,
      "low",
    );
    return {
      model: new OpenAIGradingModel({ modelId, reasoningEffort, verbosity }),
      metadata: {
        provider: "openai",
        modelId,
        reasoningEffort,
        verbosity,
      },
    };
  }

  const region = nonEmptyString(env.AWS_REGION) ?? defaultBedrockRegion;
  const modelId = nonEmptyString(env.PUDDLE_GRADING_MODEL_ID) ?? defaultBedrockModelId;
  return {
    model: new BedrockGradingModel({ region, modelId }),
    metadata: {
      provider: "bedrock",
      region,
      modelId,
    },
  };
}

function parseEnumEnv<const T extends readonly string[]>(
  value: string | undefined,
  envName: string,
  allowed: T,
  defaultValue: T[number],
): T[number] {
  if (value === undefined) {
    return defaultValue;
  }
  if ((allowed as readonly string[]).includes(value)) {
    return value as T[number];
  }
  throw new Error(`${envName} must be one of: ${allowed.join(", ")}`);
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}
