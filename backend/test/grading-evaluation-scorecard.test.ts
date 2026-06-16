import { describe, expect, it } from "vitest";
import { compareScorecardScores, parseScorecardMarkdown } from "../src/grading/evaluation/scorecard.js";
import type { HumanScorecardLabel } from "../src/grading/evaluation/scorecard.js";

const guthrieScorecard = `
# Scorecard for Example C

| Dimension | Score | Notes |
| --- | ---: | --- |
| **Problem Solving** | **3** | Practical robotics support workaround. |
| **Agency** | **4** | Strong non-computer system hack. |
| **Competitiveness** | **2** | Light competitive signal. |
| **Curious** | **4** | Strong niche knowledge. |

## Missing Questions

| Question | Asked? |
| --- | --- |
| Clever/hacky technical solution | **Yes, strong practical answer** |
| Hacked a non-computer system | **Yes, very strong answer** |
| Extreme competitiveness outside work | **Yes, weak/moderate answer** |
| Niche/obscure top-1% non-technical topic | **Yes, strong answer** |

# AI / Scripted Answer Detection

| Signal | Rating |
| --- | ---: |
| Scripted / rehearsed likelihood | **Low** |
| Live AI-assistance likelihood | **Very low** |
| Overall AI-detection confidence | **3-8%** |

# Final Scores

| Dimension | Score |
| --- | ---: |
| Problem Solving | **3 / 4** |
| Agency | **4 / 4** |
| Competitiveness | **2 / 4** |
| Curious | **4 / 4** |
| **Sum** | **13 / 16** |

## Comment

**Strong support/FDE-style signal, especially agency and curiosity.**
`;

describe("grading evaluation scorecard", () => {
  it("parses dimension scores and final score from markdown scorecard tables", () => {
    const parsed = parseScorecardMarkdown(guthrieScorecard);

    expect(parsed.candidateName).toBe("Example C");
    expect(parsed.scores).toEqual({
      problem_solving: 3,
      agency: 4,
      competitiveness: 2,
      curious: 4,
    });
    expect(parsed.dimensions).toEqual(parsed.scores);
    expect(parsed.totalScore).toBe(13);
  });

  it("parses missing-question statuses into stable normalized keys", () => {
    const parsed = parseScorecardMarkdown(guthrieScorecard);

    expect(parsed.missingQuestions).toEqual({
      clever_hacky_technical_solution: {
        question: "Clever/hacky technical solution",
        status: "Yes, strong practical answer",
        rawStatus: "**Yes, strong practical answer**",
      },
      hacked_a_non_computer_system: {
        question: "Hacked a non-computer system",
        status: "Yes, very strong answer",
        rawStatus: "**Yes, very strong answer**",
      },
      extreme_competitiveness_outside_work: {
        question: "Extreme competitiveness outside work",
        status: "Yes, weak/moderate answer",
        rawStatus: "**Yes, weak/moderate answer**",
      },
      niche_obscure_top_1_non_technical_topic: {
        question: "Niche/obscure top-1% non-technical topic",
        status: "Yes, strong answer",
        rawStatus: "**Yes, strong answer**",
      },
    });
  });

  it("parses scripted-risk ratings and comment text", () => {
    const parsed = parseScorecardMarkdown(guthrieScorecard);

    expect(parsed.scriptedRisk).toEqual({
      scripted_rehearsed_likelihood: {
        signal: "Scripted / rehearsed likelihood",
        rating: "Low",
        rawRating: "**Low**",
      },
      live_ai_assistance_likelihood: {
        signal: "Live AI-assistance likelihood",
        rating: "Very low",
        rawRating: "**Very low**",
      },
      overall_ai_detection_confidence: {
        signal: "Overall AI-detection confidence",
        rating: "3-8%",
        rawRating: "**3-8%**",
      },
    });
    expect(parsed.comment).toBe("Strong support/FDE-style signal, especially agency and curiosity.");
  });

  it("computes per-dimension absolute error and agreement metrics", () => {
    const expected = parseScorecardMarkdown(guthrieScorecard);
    const actualScores: HumanScorecardLabel["scores"] = {
      problem_solving: 2.5,
      agency: 4,
      competitiveness: 1,
      curious: 3.5,
    };
    const actual: HumanScorecardLabel = {
      ...expected,
      scores: actualScores,
      dimensions: actualScores,
      totalScore: 10.9,
    };

    expect(compareScorecardScores(expected, actual)).toEqual({
      dimensionErrors: [
        {
          category: "problem_solving",
          dimension: "problem_solving",
          expected: 3,
          actual: 2.5,
          absoluteError: 0.5,
          exact: false,
          exactMatch: false,
          withinHalfPoint: true,
        },
        {
          category: "agency",
          dimension: "agency",
          expected: 4,
          actual: 4,
          absoluteError: 0,
          exact: true,
          exactMatch: true,
          withinHalfPoint: true,
        },
        {
          category: "competitiveness",
          dimension: "competitiveness",
          expected: 2,
          actual: 1,
          absoluteError: 1,
          exact: false,
          exactMatch: false,
          withinHalfPoint: false,
        },
        {
          category: "curious",
          dimension: "curious",
          expected: 4,
          actual: 3.5,
          absoluteError: 0.5,
          exact: false,
          exactMatch: false,
          withinHalfPoint: true,
        },
      ],
      meanAbsoluteError: 0.5,
      exactRate: 0.25,
      withinHalfPointRate: 0.75,
    });
  });

  it("compares expected score records to model category scores", () => {
    const expected = parseScorecardMarkdown(guthrieScorecard);

    const comparison = compareScorecardScores(expected.scores, [
      { category: "problem_solving", score: 3 },
      { category: "agency", score: 3.5 },
      { category: "competitiveness", score: 2 },
      { category: "curious", score: 4 },
    ]);

    expect(comparison.meanAbsoluteError).toBe(0.125);
    expect(comparison.exactRate).toBe(0.75);
    expect(comparison.withinHalfPointRate).toBe(1);
  });

  it("prefers final scores table over earlier dimension tables", () => {
    const parsed = parseScorecardMarkdown(`
# Scorecard for Example C

| Dimension | Score | Notes |
| --- | ---: | --- |
| Problem Solving | 1 | Earlier rough score. |
| Agency | 1 | Earlier rough score. |
| Competitiveness | 1 | Earlier rough score. |
| Curious | 1 | Earlier rough score. |

# Final Scores

| Dimension | Score |
| --- | ---: |
| Problem Solving | **2.5 / 4** |
| Agency | **4 / 4** |
| Competitiveness | **2 / 4** |
| Curious | **3.5 / 4** |
| Sum | **12 / 16** |
`);

    expect(parsed.scores).toEqual({
      problem_solving: 2.5,
      agency: 4,
      competitiveness: 2,
      curious: 3.5,
    });
    expect(parsed.totalScore).toBe(12);
  });

  it("rejects scorecards missing required dimensions without echoing transcript content", () => {
    const markdown = `
# Scorecard for Sensitive Candidate

| Dimension | Score | Notes |
| --- | ---: | --- |
| Problem Solving | 3 | Candidate said secret transcript phrase. |
| Agency | 2 | Present. |
| Competitiveness | 2 | Present. |
`;

    expect(() => parseScorecardMarkdown(markdown)).toThrow(
      "Scorecard is missing required dimensions: curious",
    );
  });

  it("rejects malformed final-score tables instead of falling back to earlier scores", () => {
    const markdown = `
# Scorecard for Example C

| Dimension | Score | Notes |
| --- | ---: | --- |
| Problem Solving | 3 | Earlier score. |
| Agency | 4 | Earlier score. |
| Competitiveness | 2 | Earlier score. |
| Curious | 4 | Earlier score. |

# Final Scores

| Dimension | Score |
| --- | ---: |
| Sum | **13 / 16** |
`;

    expect(() => parseScorecardMarkdown(markdown)).toThrow(
      "Scorecard is missing required dimensions: problem_solving, agency, competitiveness, curious",
    );
  });

  it("rejects invalid human score values", () => {
    const markdown = `
# Scorecard for Example C

| Dimension | Score | Notes |
| --- | ---: | --- |
| Problem Solving | 3.25 | Invalid quarter point. |
| Agency | 4 | Present. |
| Competitiveness | 2 | Present. |
| Curious | 4 | Present. |
`;

    expect(() => parseScorecardMarkdown(markdown)).toThrow(
      "Scorecard has invalid scores for dimensions: problem_solving",
    );
  });

  it("rejects invalid comparison score records", () => {
    const expected = parseScorecardMarkdown(guthrieScorecard);

    expect(() =>
      compareScorecardScores(expected.scores, {
        problem_solving: 3,
        agency: Number.NaN,
        competitiveness: 2,
        curious: 4,
      }),
    ).toThrow("Scorecard has invalid scores for dimensions: agency");
  });
});
