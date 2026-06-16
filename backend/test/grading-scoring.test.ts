import { describe, expect, it } from "vitest";
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

describe("grading scoring", () => {
  it("builds a scoring prompt with rubric and transcript", () => {
    const prompt = buildScoringPrompt({ rubric, transcriptTurns });

    expect(prompt).toContain("Return strict JSON only");
    expect(prompt).toContain("Problem Solving");
    expect(prompt).toContain("CANDIDATE: I built a migration");
  });

  it("parses valid scorer output", () => {
    const parsed = parseScoringOutput(JSON.stringify({
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
    }));

    expect(parsed.categoryScores[0].category).toBe("problem_solving");
    expect(parsed.categoryScores[0].score).toBe(4);
  });

  it("scores a transcript through an injected model", async () => {
    const result = await scoreTranscript({
      rubric,
      transcriptTurns,
      model: {
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
    });

    expect(result.categoryScores).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });
});
