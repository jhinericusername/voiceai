import type { EvaluationDimensionKey } from "./scorecard.js";
import {
  defaultDimensionScoreAnchors,
  type DimensionScoreAnchors,
} from "../prompts/dimension-score-anchors.js";

export interface CalibrationExample {
  readonly id: string;
  readonly summary: string;
  readonly scores: Record<EvaluationDimensionKey, number>;
  readonly missingQuestions: Partial<Record<EvaluationDimensionKey, string>>;
  readonly scriptedRisk: string;
  readonly comment: string;
  readonly totalScore: number;
  readonly transcriptExcerpt?: string;
}

export interface ScoringCalibrationInput {
  readonly gradingGuide: string;
  readonly dimensionScoreAnchors: DimensionScoreAnchors;
  readonly calibrationExamples: readonly CalibrationExample[];
}

export function buildDefaultGradingGuide(): string {
  return [
    "Grade the candidate on exactly the dimensions provided in RUBRIC_JSON.dimensions.",
    "Scores are 1-4 for each dimension in 0.5 increments, where 2 is neutral/default signal and 4 is exceptional signal.",
    "Missing question neutral default: if a calibration question was genuinely not asked, use 2 for that dimension unless other job-related evidence directly supports a score.",
    "If the calibration question was asked but the candidate dodged it or answered a different question, score the observed answer; it can be low.",
    "Scripted/AI-answer risk should be assessed separately from the dimension scores; only reduce dimension scores when the answer reliability or evidence itself is weak.",
    "Use only job-related answer content; do not infer ability or score from protected characteristics or proxies. Job-related means relevant to the active role rubric dimensions, not limited to workplace examples; hobby, sport, gaming, craft, and personal-domain answers are rubric-relevant when they answer the scripted question.",
    "Prefer concrete evidence and practical specificity over buzzword-heavy summaries.",
    "If the transcript appears incomplete, contains only logistics/company Q&A, or references rubric questions asked in another call, add a warning and use the missing-question neutral default instead of forcing low scores from missing evidence.",
    "Avoid score compression. This rubric is intentionally sharp: when the transcript gives concrete high-end evidence, use 3.5 or 4 rather than pulling strong candidates back toward 2 or 2.5. A score of 2 is neutral/light signal, not a safe fallback for detailed positive evidence.",
    "Problem solving calibration: reward clever, practical, technically constrained solutions the candidate personally drove. A 3 usually has a real constraint, real implementation, and clear tradeoff; a 4 needs unusual elegance, novelty, frontier technical depth, or exceptional external signal. Problem Solving 4 does not require public proof such as Hacker News/front-page validation if the answer itself would make strong engineers noticeably impressed.",
    "Agency calibration: Agency 4 requires concrete rule-breaking, loophole exploitation, or institution/process manipulation to get a desired outcome. Agency 3 can be unusually persistent effort or a creative non-computer/process hack without clear rule-breaking. Do not award high agency for technical/product hacks, founder background, customer coordination, or general ambition unless the non-computer/human-system agency evidence is actually present.",
    "Competitiveness calibration: Competitiveness 4 requires cost, identity-level obsession, top-percentile competition, or years of life domination. It can be self-imposed rather than formal competition when there is a concrete win condition and real cost. Competitiveness 3 requires deliberate training, real stakes, emotional loss response, or sustained competitive behavior. Do not infer high competitiveness from founder background or general ambition alone.",
    "Curious calibration: Curious 4 can come from hobby/domain expertise, including non-CS or work-adjacent domains, when the candidate shows top-percentile depth, independent action, or lived-in expertise. Curious 4 does not require credentials; unusual retained mechanics, hands-on experimentation, and lived expertise can be enough. Top-percentile gaming, sports, or hobby knowledge can count when supported by concrete depth/actions. Self-claimed top-percentile status without concrete detail should usually cap at 3. Curious 3 shows active exploration and follow-through without clear expert-level depth.",
  ].join("\n");
}

export function defaultCalibrationExamples(): readonly CalibrationExample[] {
  return [
    {
      id: "example_a",
      summary: "Practical migration automation with neutral agency, weak curiosity, and light competitiveness.",
      scores: {
        problem_solving: 2.5,
        agency: 2,
        competitiveness: 2,
        curious: 1,
      },
      missingQuestions: {
        agency: "The non-computer system hack question was not asked.",
      },
      totalScore: 7.5,
      scriptedRisk: "low_moderate",
      comment:
        "Useful practical migration automation supports a 2.5 in problem_solving. The agency question was not asked, so agency uses the neutral default of 2. Competitiveness showed recreational participation rather than strong competitive drive. The curiosity question was asked, but the answer did not establish niche or top-tier knowledge, so curious is low.",
    },
    {
      id: "example_b",
      summary: "Strong applied ML architecture with partial agency, good athletic competitiveness, and neutral curiosity.",
      scores: {
        problem_solving: 3,
        agency: 2.5,
        competitiveness: 3,
        curious: 2,
      },
      missingQuestions: {
        curious: "The niche/top-percentile curiosity question was not asked.",
      },
      totalScore: 10.5,
      scriptedRisk: "high",
      comment:
        "Strong but high-level graph and streaming fraud ML architecture supports a 3 in problem_solving. The non-computer hack answer described work or process automation, giving partial agency signal. Tournament badminton with deliberate practice supports a 3 in competitiveness. The curiosity question was not asked, so curious uses the neutral default of 2.",
    },
    {
      id: "example_c",
      summary: "Practical robotics support workaround, strong system hack, light competitiveness, and strong niche knowledge.",
      scores: {
        problem_solving: 3,
        agency: 4,
        competitiveness: 2,
        curious: 4,
      },
      missingQuestions: {},
      totalScore: 13,
      scriptedRisk: "very_low",
      comment:
        "A practical robotics support workaround supports a 3 in problem_solving. A strong healthcare deductible system hack supports a 4 in agency. Light ping-pong competitiveness supports a 2 in competitiveness. Strong niche goat-farming knowledge supports a 4 in curious.",
    },
  ];
}

export function selectCalibrationExamples(
  examples: readonly CalibrationExample[],
  maxExamples: number,
): readonly CalibrationExample[] {
  if (!Number.isFinite(maxExamples) || maxExamples <= 0) {
    return [];
  }
  return examples.slice(0, Math.trunc(maxExamples));
}

export function clampEvaluationBatchSize(value: number, options: { min?: number; max?: number } = {}): number {
  const min = options.min ?? 1;
  const max = options.max ?? 5;
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function buildScoringCalibrationInput(): ScoringCalibrationInput {
  return {
    gradingGuide: buildDefaultGradingGuide(),
    dimensionScoreAnchors: defaultDimensionScoreAnchors(),
    calibrationExamples: defaultCalibrationExamples(),
  };
}

export function calibrationExamplesFromExport(
  value: unknown,
  options: { readonly maxTranscriptChars?: number } = {},
): readonly CalibrationExample[] {
  const maxTranscriptChars = Math.max(0, Math.trunc(options.maxTranscriptChars ?? 4000));
  const examples = exportExamples(value);
  return examples.flatMap((example) => {
    if (!isRecord(example)) {
      return [];
    }
    const id = stringValue(example.id);
    const scores = scoreRecordValue(example.scores);
    const totalScore = numberValue(example.totalScore);
    if (!id || !scores || totalScore === null) {
      return [];
    }

    const comment = stringValue(example.comment) ?? "Human grader score labels from exported Weave calibration data.";
    const transcriptExcerpt = transcriptExcerptFromExportExample(example, maxTranscriptChars);
    return [
      {
        id,
        summary: `Real graded calibration example (${id}) with human total ${totalScore}.`,
        scores,
        missingQuestions: {},
        scriptedRisk: "unknown",
        comment,
        totalScore,
        ...(transcriptExcerpt ? { transcriptExcerpt } : {}),
      },
    ];
  });
}

function exportExamples(value: unknown): readonly unknown[] {
  if (!isRecord(value)) {
    return [];
  }
  const sample = value.sample;
  if (!isRecord(sample) || !Array.isArray(sample.examples)) {
    return [];
  }
  return sample.examples;
}

function transcriptExcerptFromExportExample(
  example: Record<string, unknown>,
  maxTranscriptChars: number,
): string | null {
  if (maxTranscriptChars === 0 || !Array.isArray(example.transcriptTurns)) {
    return null;
  }
  const transcript = example.transcriptTurns
    .flatMap((turn) => {
      if (!isRecord(turn)) {
        return [];
      }
      const speaker = stringValue(turn.speaker);
      const text = stringValue(turn.text);
      return speaker && text ? [`${speaker.toUpperCase()}: ${text}`] : [];
    })
    .join("\n");
  if (!transcript) {
    return null;
  }
  return transcript.length <= maxTranscriptChars
    ? transcript
    : `${transcript.slice(0, maxTranscriptChars).trimEnd()}\n[truncated]`;
}

function scoreRecordValue(value: unknown): Record<EvaluationDimensionKey, number> | null {
  if (!isRecord(value)) {
    return null;
  }
  const problemSolving = numberValue(value.problem_solving);
  const agency = numberValue(value.agency);
  const competitiveness = numberValue(value.competitiveness);
  const curious = numberValue(value.curious);
  if (
    problemSolving === null ||
    agency === null ||
    competitiveness === null ||
    curious === null
  ) {
    return null;
  }
  return {
    problem_solving: problemSolving,
    agency,
    competitiveness,
    curious,
  };
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
