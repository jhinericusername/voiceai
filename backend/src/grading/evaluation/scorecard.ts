export type EvaluationDimensionKey =
  | "problem_solving"
  | "agency"
  | "competitiveness"
  | "curious";

export interface MissingQuestionStatus {
  readonly question: string;
  readonly status: string;
  readonly rawStatus: string;
}

export interface ScriptedRiskRating {
  readonly signal: string;
  readonly rating: string;
  readonly rawRating: string;
}

export interface HumanScorecardLabel {
  readonly candidateName: string | null;
  readonly scores: Record<EvaluationDimensionKey, number>;
  readonly dimensions: Record<EvaluationDimensionKey, number>;
  readonly missingQuestions: Record<string, MissingQuestionStatus>;
  readonly scriptedRisk: Record<string, ScriptedRiskRating>;
  readonly scriptedSignals: Record<string, string>;
  readonly totalScore: number;
  readonly comment: string | null;
}

export interface DimensionError {
  readonly category: EvaluationDimensionKey;
  readonly dimension: EvaluationDimensionKey;
  readonly expected: number;
  readonly actual: number;
  readonly absoluteError: number;
  readonly exact: boolean;
  readonly exactMatch: boolean;
  readonly withinHalfPoint: boolean;
}

export interface ScoreComparison {
  readonly dimensionErrors: readonly DimensionError[];
  readonly meanAbsoluteError: number;
  readonly exactRate: number;
  readonly withinHalfPointRate: number;
}

interface MarkdownTable {
  readonly heading: string | null;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

const DIMENSION_KEYS: readonly EvaluationDimensionKey[] = [
  "problem_solving",
  "agency",
  "competitiveness",
  "curious",
];

const DIMENSION_NAME_BY_NORMALIZED = new Map<string, EvaluationDimensionKey>([
  ["problem solving", "problem_solving"],
  ["agency", "agency"],
  ["competitiveness", "competitiveness"],
  ["curious", "curious"],
]);

export function parseScorecardMarkdown(markdown: string): HumanScorecardLabel {
  const firstScores: Partial<Record<EvaluationDimensionKey, number>> = {};
  const finalScores: Partial<Record<EvaluationDimensionKey, number>> = {};
  const missingQuestions: Record<string, MissingQuestionStatus> = {};
  const scriptedRisk: Record<string, ScriptedRiskRating> = {};
  let totalScore: number | null = null;
  let sawFinalScoreTable = false;

  for (const table of extractMarkdownTables(markdown)) {
    if (isDimensionScoreTable(table)) {
      const finalTable = isFinalScoreTable(table);
      if (finalTable) {
        sawFinalScoreTable = true;
      }
      const target = finalTable ? finalScores : firstScores;
      for (const row of table.rows) {
        const label = cellText(row[0] ?? "");
        const score = parseNumericScore(row[1] ?? "");
        const dimension = dimensionKey(label);
        if (dimension && score !== null) {
          target[dimension] = score;
          continue;
        }
        if (finalTable && isTotalLabel(label) && score !== null) {
          totalScore = score;
        }
      }
      continue;
    }

    if (isMissingQuestionTable(table)) {
      for (const row of table.rows) {
        const question = cellText(row[0] ?? "");
        const rawStatus = (row[1] ?? "").trim();
        if (!question || !rawStatus) {
          continue;
        }
        missingQuestions[slugify(question)] = {
          question,
          status: cellText(rawStatus),
          rawStatus,
        };
      }
      continue;
    }

    if (isScriptedRiskTable(table)) {
      for (const row of table.rows) {
        const signal = cellText(row[0] ?? "");
        const rawRating = (row[1] ?? "").trim();
        if (!signal || !rawRating) {
          continue;
        }
        scriptedRisk[slugify(signal)] = {
          signal,
          rating: cellText(rawRating),
          rawRating,
        };
      }
    }
  }

  const selectedScores = sawFinalScoreTable ? finalScores : firstScores;
  const scores = requireCompleteScores(selectedScores);
  const comment = parseComment(markdown);

  return {
    candidateName: parseCandidateName(markdown),
    scores,
    dimensions: scores,
    missingQuestions,
    scriptedRisk,
    scriptedSignals: Object.fromEntries(
      Object.entries(scriptedRisk).map(([key, value]) => [key, value.rating]),
    ),
    totalScore: totalScore ?? sumScores(scores),
    comment: comment || null,
  };
}

export function compareScorecardScores(
  expected: Record<EvaluationDimensionKey, number> | HumanScorecardLabel,
  actual:
    | readonly { readonly category: string; readonly score: number }[]
    | Record<EvaluationDimensionKey, number>
    | HumanScorecardLabel,
): ScoreComparison {
  const expectedScores = scoreRecord(expected);
  const actualScores = actualScoreRecord(actual);
  const dimensionErrors = DIMENSION_KEYS.map((dimension) => {
    const expectedScore = expectedScores[dimension];
    const actualScore = actualScores[dimension];
    const absoluteError = roundMetric(Math.abs(expectedScore - actualScore));
    const exact = expectedScore === actualScore;

    return {
      category: dimension,
      dimension,
      expected: expectedScore,
      actual: actualScore,
      absoluteError,
      exact,
      exactMatch: exact,
      withinHalfPoint: absoluteError <= 0.5,
    };
  });

  return {
    dimensionErrors,
    meanAbsoluteError: roundMetric(
      dimensionErrors.reduce((sum, error) => sum + error.absoluteError, 0) / dimensionErrors.length,
    ),
    exactRate: roundMetric(
      dimensionErrors.filter((error) => error.exact).length / dimensionErrors.length,
    ),
    withinHalfPointRate: roundMetric(
      dimensionErrors.filter((error) => error.withinHalfPoint).length / dimensionErrors.length,
    ),
  };
}

function extractMarkdownTables(markdown: string): MarkdownTable[] {
  const tables: MarkdownTable[] = [];
  const lines = markdown.split(/\r?\n/);
  let currentHeading: string | null = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const heading = parseHeading(line);
    if (heading !== null) {
      currentHeading = heading;
      index += 1;
      continue;
    }

    if (!isTableLine(line)) {
      index += 1;
      continue;
    }

    const start = index;
    const tableLines: string[] = [];
    while (index < lines.length && isTableLine(lines[index] ?? "")) {
      tableLines.push(lines[index] ?? "");
      index += 1;
    }

    const parsed = parseTableLines(tableLines, currentHeading);
    if (parsed !== null) {
      tables.push(parsed);
    } else {
      index = start + 1;
    }
  }

  return tables;
}

function parseTableLines(lines: readonly string[], heading: string | null): MarkdownTable | null {
  if (lines.length < 2) {
    return null;
  }

  const headers = splitMarkdownRow(lines[0] ?? "");
  const separator = splitMarkdownRow(lines[1] ?? "");
  if (!headers.length || !isSeparatorRow(separator)) {
    return null;
  }

  return {
    heading,
    headers: headers.map(cellText),
    rows: lines.slice(2).map(splitMarkdownRow),
  };
}

function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim();
  const withoutLeadingPipe = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutTrailingPipe = withoutLeadingPipe.endsWith("|")
    ? withoutLeadingPipe.slice(0, -1)
    : withoutLeadingPipe;
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const char of withoutTrailingPipe) {
    if (escaped) {
      cell += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      cell += char;
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function isTableLine(line: string): boolean {
  return line.trim().startsWith("|");
}

function parseHeading(line: string): string | null {
  const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
  return match ? cellText(match[1] ?? "") : null;
}

function isDimensionScoreTable(table: MarkdownTable): boolean {
  const headers = normalizedHeaders(table);
  return headers.includes("dimension") && headers.includes("score");
}

function isMissingQuestionTable(table: MarkdownTable): boolean {
  const headers = normalizedHeaders(table);
  return headers.includes("question") && headers.some((header) => header === "asked");
}

function isScriptedRiskTable(table: MarkdownTable): boolean {
  const headers = normalizedHeaders(table);
  return headers.includes("signal") && headers.includes("rating");
}

function isFinalScoreTable(table: MarkdownTable): boolean {
  return normalizeText(table.heading ?? "").includes("final scores");
}

function normalizedHeaders(table: MarkdownTable): string[] {
  return table.headers.map((header) => normalizeText(header));
}

function dimensionKey(label: string): EvaluationDimensionKey | null {
  return DIMENSION_NAME_BY_NORMALIZED.get(normalizeText(label)) ?? null;
}

function requireCompleteScores(
  scores: Partial<Record<EvaluationDimensionKey, number>>,
): Record<EvaluationDimensionKey, number> {
  const missing = DIMENSION_KEYS.filter((dimension) => typeof scores[dimension] !== "number");
  if (missing.length > 0) {
    throw new Error(`Scorecard is missing required dimensions: ${missing.join(", ")}`);
  }
  const invalid = DIMENSION_KEYS.filter((dimension) => !isValidScore(scores[dimension] as number));
  if (invalid.length > 0) {
    throw new Error(`Scorecard has invalid scores for dimensions: ${invalid.join(", ")}`);
  }
  return {
    problem_solving: scores.problem_solving as number,
    agency: scores.agency as number,
    competitiveness: scores.competitiveness as number,
    curious: scores.curious as number,
  };
}

function scoreRecord(
  value: Record<EvaluationDimensionKey, number> | HumanScorecardLabel,
): Record<EvaluationDimensionKey, number> {
  return requireCompleteScores("scores" in value ? value.scores : value);
}

function actualScoreRecord(
  value:
    | readonly { readonly category: string; readonly score: number }[]
    | Record<EvaluationDimensionKey, number>
    | HumanScorecardLabel,
): Record<EvaluationDimensionKey, number> {
  if (isCategoryScoreArray(value)) {
    const scores: Partial<Record<EvaluationDimensionKey, number>> = {};
    for (const item of value) {
      const dimension = dimensionKey(item.category);
      if (dimension && Number.isFinite(item.score)) {
        scores[dimension] = item.score;
      }
    }
    return requireCompleteScores(scores);
  }
  return scoreRecord(value);
}

function isCategoryScoreArray(
  value:
    | readonly { readonly category: string; readonly score: number }[]
    | Record<EvaluationDimensionKey, number>
    | HumanScorecardLabel,
): value is readonly { readonly category: string; readonly score: number }[] {
  return Array.isArray(value);
}

function sumScores(scores: Record<EvaluationDimensionKey, number>): number {
  return roundMetric(DIMENSION_KEYS.reduce((sum, dimension) => sum + scores[dimension], 0));
}

function isTotalLabel(label: string): boolean {
  const normalized = normalizeText(label);
  return normalized === "sum" || normalized === "total" || normalized === "final score";
}

function parseNumericScore(value: string): number | null {
  const text = cellText(value);
  const match = text.match(/^([+-]?\d+(?:\.\d+)?)(?:\s*\/\s*\d+(?:\.\d+)?)?$/);
  if (!match) {
    return null;
  }
  const score = Number(match[1]);
  return Number.isFinite(score) ? score : null;
}

function isValidScore(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 4 && Number.isInteger(value * 2);
}

function parseCandidateName(markdown: string): string | null {
  for (const line of markdown.split(/\r?\n/)) {
    const heading = parseHeading(line);
    const match = heading?.match(/^Scorecard\s+for\s+(.+)$/i);
    if (match) {
      const name = cellText(match[1] ?? "");
      return name || null;
    }
  }
  return null;
}

function parseComment(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const commentLines: string[] = [];
  let inComment = false;

  for (const line of lines) {
    const heading = parseHeading(line);
    if (heading !== null) {
      if (inComment) {
        break;
      }
      inComment = normalizeText(heading) === "comment";
      continue;
    }
    if (inComment) {
      commentLines.push(line);
    }
  }

  return trimBlankLines(commentLines).map(cellText).join("\n").trim();
}

function trimBlankLines(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]?.trim()) {
    start += 1;
  }
  while (end > start && !lines[end - 1]?.trim()) {
    end -= 1;
  }
  return lines.slice(start, end);
}

function cellText(value: string): string {
  return value
    .replace(/\\([*_`|\\])/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .trim();
}

function normalizeText(value: string): string {
  return cellText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function slugify(value: string): string {
  return normalizeText(value).replace(/\s+/g, "_");
}

function roundMetric(value: number): number {
  return Number(value.toFixed(10));
}
