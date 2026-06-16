export interface GradingModel {
  complete(prompt: string): Promise<string>;
}

export interface TranscriptTurnLike {
  readonly speaker: string;
  readonly text: string;
  readonly turnIndex?: number;
}

export interface ScoringInput {
  readonly rubric: unknown;
  readonly transcriptTurns: readonly TranscriptTurnLike[];
}

export interface ParsedCategoryScore {
  readonly category: string;
  readonly score: number;
  readonly confidence?: number;
  readonly evidenceQuotes: readonly string[];
  readonly rationale: string;
}

export interface ParsedScoringOutput {
  readonly categoryScores: readonly ParsedCategoryScore[];
  readonly warnings: readonly string[];
}

export function buildScoringPrompt(input: ScoringInput): string {
  return [
    "You are Puddle's rubric scorer for a structured hiring interview.",
    "Score only job-related answer content against the provided rubric.",
    "Do not infer job fit, ability, or score from protected characteristics.",
    "Do not score protected-class evidence or proxies, including appearance, voice quality, accent, emotion, facial expression, age, race, gender, or disability.",
    "Return strict JSON only with keys category_scores and warnings.",
    "Do not include markdown, code fences, or explanatory prose.",
    "Each category_scores item must include category, score, evidence_quotes, and rationale.",
    "confidence is optional; if present, it must be a finite number.",
    "",
    "OUTPUT_JSON_SHAPE:",
    JSON.stringify(
      {
        category_scores: [
          {
            category: "problem_solving",
            score: 4,
            confidence: 0.91,
            evidence_quotes: ["verbatim candidate quote from transcript"],
            rationale: "Non-empty rationale grounded in the evidence quotes.",
          },
        ],
        warnings: ["string warning, or empty array when there are no warnings"],
      },
      null,
      2,
    ),
    "",
    "RUBRIC_JSON:",
    JSON.stringify(input.rubric, null, 2),
    "",
    "TRANSCRIPT:",
    input.transcriptTurns.map((turn) => `${turn.speaker.toUpperCase()}: ${turn.text}`).join("\n"),
  ].join("\n");
}

export function parseScoringOutput(text: string): ParsedScoringOutput {
  const payload = JSON.parse(extractJson(text)) as {
    category_scores?: unknown;
    warnings?: unknown;
  };
  if (!Array.isArray(payload.category_scores)) {
    throw new Error("Scoring output must include category_scores.");
  }

  const categoryScores = payload.category_scores.map((score) => {
    if (!isRecord(score)) {
      throw new Error("Each category score must be an object.");
    }
    const category = stringValue(score.category);
    const numericScore = numberValue(score.score);
    const confidence = Object.prototype.hasOwnProperty.call(score, "confidence")
      ? numberValue(score.confidence)
      : undefined;
    const evidenceQuotes = stringArrayValue(score.evidence_quotes, "evidence_quotes");
    const rationale = stringValue(score.rationale);
    if (!category || numericScore === null) {
      throw new Error("Each category score must include category and score.");
    }
    if (confidence === null) {
      throw new Error("confidence must be a finite number when present.");
    }
    if (!rationale) {
      throw new Error("Each category score must include rationale as a non-empty string.");
    }
    return {
      category,
      score: numericScore,
      ...(confidence === undefined ? {} : { confidence }),
      evidenceQuotes,
      rationale,
    };
  });

  return {
    categoryScores,
    warnings: stringArrayValue(payload.warnings, "warnings"),
  };
}

export async function scoreTranscript(input: ScoringInput, model: GradingModel): Promise<ParsedScoringOutput> {
  const prompt = buildScoringPrompt(input);
  return parseScoringOutput(await model.complete(prompt));
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Scoring output did not contain a JSON object.");
  }
  return text.slice(start, end + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArrayValue(value: unknown, fieldName: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings.`);
  }
  if (value.some((item) => typeof item !== "string")) {
    throw new Error(`${fieldName} must contain only strings.`);
  }
  return value;
}
