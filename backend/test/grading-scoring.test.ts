import { describe, expect, it } from "vitest";
import type { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { BedrockGradingModel } from "../src/grading/bedrock.js";
import { buildScoringPrompt, parseScoringOutput, scoreTranscript } from "../src/grading/scoring.js";

const rubric = {
  script_version: "job_1-v1",
  dimensions: [
    {
      key: "problem_solving",
      name: "Problem Solving",
      meaning: "Finds clever, elegant solutions.",
      anchors: { 1: "Low", 2: "Some", 3: "Strong", 4: "Exceptional" },
    },
  ],
  bare_minimum_rule: "at_least_one_4_and_problem_solving_ge_3",
};

const transcriptTurns = [
  { speaker: "agent", text: "Tell me about a hard problem.", turnIndex: 0 },
  { speaker: "candidate", text: "I built a migration and cut runtime by 90%.", turnIndex: 1 },
];

const validScoringPayload = {
  category_scores: [
    {
      category: "problem_solving",
      score: 4,
      confidence: 0.91,
      evidence_quotes: ["cut runtime by 90%"],
      rationale: "Specific high-impact migration.",
    },
  ],
  warnings: [],
};

describe("grading scoring", () => {
  it("builds a scoring prompt with rubric, transcript, and exact output instructions", () => {
    const prompt = buildScoringPrompt({ rubric, transcriptTurns });

    expect(prompt).toContain("Return strict JSON only");
    expect(prompt).toContain("Do not include markdown, code fences, or explanatory prose.");
    expect(prompt).toContain('"category_scores"');
    expect(prompt).toContain('"category"');
    expect(prompt).toContain('"score"');
    expect(prompt).toContain('"confidence"');
    expect(prompt).toContain('"evidence_quotes"');
    expect(prompt).toContain('"rationale"');
    expect(prompt).toContain('"warnings"');
    expect(prompt).toContain("Do not infer job fit, ability, or score from protected characteristics");
    expect(prompt).toContain("Do not score protected-class evidence or proxies");
    expect(prompt).toContain("Problem Solving");
    expect(prompt).toContain("CANDIDATE: I built a migration");
  });

  it("parses valid scorer output to camelCase", () => {
    const parsed = parseScoringOutput(JSON.stringify(validScoringPayload));

    expect(parsed.categoryScores[0]).toEqual({
      category: "problem_solving",
      score: 4,
      confidence: 0.91,
      evidenceQuotes: ["cut runtime by 90%"],
      rationale: "Specific high-impact migration.",
    });
    expect(parsed.warnings).toEqual([]);
  });

  it("parses valid scorer output without confidence", () => {
    const parsed = parseScoringOutput(
      JSON.stringify({
        category_scores: [
          {
            category: "problem_solving",
            score: 4,
            evidence_quotes: ["cut runtime by 90%"],
            rationale: "Specific high-impact migration.",
          },
        ],
        warnings: [],
      }),
    );

    expect(parsed.categoryScores[0]).not.toHaveProperty("confidence");
  });

  it("parses valid scorer output wrapped in prose and a code fence", () => {
    const parsed = parseScoringOutput(`Here is the score:

\`\`\`json
${JSON.stringify(validScoringPayload)}
\`\`\`
`);

    expect(parsed.categoryScores[0].evidenceQuotes).toEqual(["cut runtime by 90%"]);
  });

  it("throws when evidence_quotes is missing, malformed, or contains non-strings", () => {
    expect(() => parseScoringOutput(JSON.stringify({
      category_scores: [
        {
          category: "problem_solving",
          score: 4,
          rationale: "Specific high-impact migration.",
        },
      ],
      warnings: [],
    }))).toThrow(/evidence_quotes/);

    expect(() => parseScoringOutput(JSON.stringify({
      category_scores: [
        {
          category: "problem_solving",
          score: 4,
          evidence_quotes: "cut runtime by 90%",
          rationale: "Specific high-impact migration.",
        },
      ],
      warnings: [],
    }))).toThrow(/evidence_quotes/);

    expect(() => parseScoringOutput(JSON.stringify({
      category_scores: [
        {
          category: "problem_solving",
          score: 4,
          evidence_quotes: ["cut runtime by 90%", 90],
          rationale: "Specific high-impact migration.",
        },
      ],
      warnings: [],
    }))).toThrow(/evidence_quotes/);
  });

  it("throws when rationale is missing or malformed", () => {
    expect(() => parseScoringOutput(JSON.stringify({
      category_scores: [
        {
          category: "problem_solving",
          score: 4,
          evidence_quotes: ["cut runtime by 90%"],
        },
      ],
      warnings: [],
    }))).toThrow(/rationale/);

    expect(() => parseScoringOutput(JSON.stringify({
      category_scores: [
        {
          category: "problem_solving",
          score: 4,
          evidence_quotes: ["cut runtime by 90%"],
          rationale: "",
        },
      ],
      warnings: [],
    }))).toThrow(/rationale/);
  });

  it("throws when warnings is missing, malformed, or contains non-strings", () => {
    expect(() => parseScoringOutput(JSON.stringify({
      category_scores: validScoringPayload.category_scores,
    }))).toThrow(/warnings/);

    expect(() => parseScoringOutput(JSON.stringify({
      category_scores: validScoringPayload.category_scores,
      warnings: "none",
    }))).toThrow(/warnings/);

    expect(() => parseScoringOutput(JSON.stringify({
      category_scores: validScoringPayload.category_scores,
      warnings: ["check", 1],
    }))).toThrow(/warnings/);
  });

  it("throws when optional confidence is malformed", () => {
    expect(() => parseScoringOutput(JSON.stringify({
      category_scores: [
        {
          category: "problem_solving",
          score: 4,
          confidence: "high",
          evidence_quotes: ["cut runtime by 90%"],
          rationale: "Specific high-impact migration.",
        },
      ],
      warnings: [],
    }))).toThrow(/confidence/);
  });

  it("throws when scorer output does not contain a JSON object", () => {
    expect(() => parseScoringOutput("no structured output")).toThrow(/JSON object/);
  });

  it("scores a transcript through an injected model", async () => {
    const result = await scoreTranscript(
      {
        rubric,
        transcriptTurns,
      },
      {
        complete: async () => JSON.stringify({
          category_scores: [
            {
              category: "problem_solving",
              score: 4,
              confidence: 0.91,
              evidence_quotes: ["cut runtime by 90%"],
              rationale: "Specific high-impact migration.",
            },
          ],
          warnings: [],
        }),
      },
    );

    expect(result.categoryScores).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("throws a provider-level error when Bedrock returns no text blocks", async () => {
    const model = new BedrockGradingModel(
      {
        send: async () => ({
          output: {
            message: {
              content: [],
            },
          },
        }),
      } as unknown as BedrockRuntimeClient,
      "test-model",
    );

    await expect(model.complete("prompt")).rejects.toThrow(/Bedrock grading model returned no text content/);
  });
});
