# Weave Grading Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline evaluation and calibration harness that uses existing Weave/Puddle graded interviews to measure whether the model-backed rubric scorer matches human scorecards before any fine-tuning or RL work.

**Architecture:** Keep model calls one interview per call, with small batches only at the orchestration/reporting layer. Add explicit grading guidance and three calibration examples to the scoring prompt input, then evaluate predictions against labeled human scores from markdown scorecards, Puddle Ashby scores, or Weave `candidate_evaluations`.

**Tech Stack:** TypeScript, Vitest, existing backend Postgres pools, existing `scoreTranscript`/`BedrockGradingModel`, JSON/JSONL CLI output.

---

## File Structure

- Create `backend/src/grading/evaluation/scorecard.ts`: parse the markdown scorecard format into structured labels and scripted-risk metadata.
- Create `backend/test/grading-evaluation-scorecard.test.ts`: parser and metric tests using compact versions of the provided examples.
- Create `backend/src/grading/evaluation/calibration.ts`: grading guide, calibration examples, prompt input helpers, and safe small-batch utilities.
- Create `backend/test/grading-evaluation-calibration.test.ts`: verifies guidance/examples are included and batch limits are enforced.
- Create `backend/src/grading/evaluation/repository.ts`: SQL statements for locating labeled sessions and Weave labels without cross-database joins.
- Create `backend/test/grading-evaluation-repository.test.ts`: SQL shape and parameter tests.
- Create `backend/src/grading/evaluation/runner.ts`: evaluate labeled interviews one model call at a time, compute agreement/error metrics, and produce JSON-safe reports.
- Create `backend/test/grading-evaluation-runner.test.ts`: runner tests with fake model/scorer and no network.
- Create `backend/src/grading/evaluation/cli.ts`: CLI entry point for dry-run dataset inventory and optional evaluation execution.
- Modify `backend/package.json`: add `grading:evaluate` script.
- Modify `backend/src/grading/scoring.ts`: extend `ScoringInput` with optional grading guide/calibration examples and include them in the prompt.
- Modify `backend/test/grading-scoring.test.ts`: verify scoring prompt includes guide/examples when provided.

## Task 1: Scorecard Parser and Metrics

**Files:**
- Create: `backend/src/grading/evaluation/scorecard.ts`
- Create: `backend/test/grading-evaluation-scorecard.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `backend/test/grading-evaluation-scorecard.test.ts` with tests for:
- parsing dimension scores from a markdown scorecard table,
- parsing missing-question statuses,
- parsing scripted-risk ratings,
- computing per-dimension absolute error and exact/within-half-point agreement.

The fixture should use compact scorecards based on the provided examples:

```ts
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
`;
```

- [ ] **Step 2: Implement parser and metrics**

Implement:

```ts
export type EvaluationDimensionKey = "problem_solving" | "agency" | "competitiveness" | "curious";

export interface HumanScorecardLabel {
  readonly candidateName: string | null;
  readonly scores: Record<EvaluationDimensionKey, number>;
  readonly totalScore: number;
  readonly missingQuestions: Partial<Record<EvaluationDimensionKey, string>>;
  readonly scriptedSignals: Record<string, string>;
  readonly comment: string | null;
}

export interface DimensionError {
  readonly category: EvaluationDimensionKey;
  readonly expected: number;
  readonly actual: number;
  readonly absoluteError: number;
  readonly exact: boolean;
  readonly withinHalfPoint: boolean;
}

export function parseScorecardMarkdown(markdown: string): HumanScorecardLabel;
export function compareScorecardScores(
  expected: Record<EvaluationDimensionKey, number>,
  actual: readonly { readonly category: string; readonly score: number }[],
): { readonly dimensionErrors: readonly DimensionError[]; readonly meanAbsoluteError: number; readonly exactRate: number; readonly withinHalfPointRate: number };
```

Parser requirements:
- accept half-point scores,
- normalize `Curious` to `curious`,
- prefer `Final Scores` table if present, otherwise use the first dimension table,
- reject missing required dimensions with a clear error,
- do not include candidate transcript text in thrown errors.

- [ ] **Step 3: Verify tests**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-evaluation-scorecard.test.ts
```

Expected: tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/grading/evaluation/scorecard.ts backend/test/grading-evaluation-scorecard.test.ts
git commit -m "Add grading scorecard parser"
```

## Task 2: Calibration Guidance and Prompt Inputs

**Files:**
- Create: `backend/src/grading/evaluation/calibration.ts`
- Create: `backend/test/grading-evaluation-calibration.test.ts`
- Modify: `backend/src/grading/scoring.ts`
- Modify: `backend/test/grading-scoring.test.ts`

- [ ] **Step 1: Write failing calibration tests**

Create tests that assert:
- `buildDefaultGradingGuide()` includes the four dimensions, missing-question neutral default rule, scripted-answer detection guidance, and protected-class exclusion reminder.
- `defaultCalibrationExamples()` returns exactly three examples with scores matching the provided scorecards:
  - Example A: 2.5, 2, 2, 1, total 7.5.
  - Example B: 3, 2.5, 3, 2, total 10.5.
  - Example C: 3, 4, 2, 4, total 13.
- `selectCalibrationExamples(examples, 2)` returns at most two examples.
- `buildScoringPrompt` includes provided guide/examples and still includes the rubric/transcript.

- [ ] **Step 2: Implement calibration module**

Implement:

```ts
export interface CalibrationExample {
  readonly id: string;
  readonly summary: string;
  readonly scores: Record<EvaluationDimensionKey, number>;
  readonly missingQuestions: Partial<Record<EvaluationDimensionKey, string>>;
  readonly scriptedRisk: string;
  readonly comment: string;
}

export function buildDefaultGradingGuide(): string;
export function defaultCalibrationExamples(): readonly CalibrationExample[];
export function selectCalibrationExamples(
  examples: readonly CalibrationExample[],
  maxExamples: number,
): readonly CalibrationExample[];
```

Guidance must explicitly state:
- scores are 0-4 in 0.5 increments,
- missing asked question with evasive answer can score low,
- unasked dimension question receives neutral default 2 unless other evidence clearly supports a different score,
- evaluate only job-related evidence,
- scripted/AI-assistance risk is recorded separately and should not inflate or deflate dimension scores unless it affects answer reliability.

- [ ] **Step 3: Extend scoring input**

In `backend/src/grading/scoring.ts`, extend `ScoringInput`:

```ts
readonly gradingGuide?: string;
readonly calibrationExamples?: readonly {
  readonly id: string;
  readonly summary: string;
  readonly scores: Record<string, number>;
  readonly missingQuestions?: Record<string, string>;
  readonly scriptedRisk?: string;
  readonly comment: string;
}[];
```

Prompt requirements:
- include `GRADING_GUIDE` only when provided,
- include `CALIBRATION_EXAMPLES_JSON` only when provided and non-empty,
- preserve strict JSON output shape and protected-class instructions,
- do not batch multiple interview transcripts into one prompt.

- [ ] **Step 4: Verify tests**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-evaluation-calibration.test.ts test/grading-scoring.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/grading/evaluation/calibration.ts backend/test/grading-evaluation-calibration.test.ts backend/src/grading/scoring.ts backend/test/grading-scoring.test.ts
git commit -m "Add grading calibration guidance"
```

## Task 3: Evaluation Dataset Repository

**Files:**
- Create: `backend/src/grading/evaluation/repository.ts`
- Create: `backend/test/grading-evaluation-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Tests should cover SQL statements for:
- Puddle sessions linked to saved `ashby_candidate_scores`.
- Puddle historical Fireflies sessions linked to Weave `candidate_evaluation_id` in `sessions.source_metadata`.
- Weave `candidate_evaluations` lookup by ids.
- Ordered transcript turns by session ids.

- [ ] **Step 2: Implement repository helpers**

Implement:

```ts
export function puddleScoredSessionLabelsStatement(input: {
  readonly organizationId: string;
  readonly ashbyJobId?: string | null;
  readonly limit: number;
}): SqlStatement;

export function historicalSessionEvaluationLinksStatement(input: {
  readonly organizationId: string;
  readonly ashbyJobId?: string | null;
  readonly limit: number;
}): SqlStatement;

export function weaveCandidateEvaluationsByIdStatement(ids: readonly string[]): SqlStatement;

export function transcriptTurnsForEvaluationStatement(sessionIds: readonly string[]): SqlStatement;
```

SQL requirements:
- scope every Puddle query by `organizationId`,
- never select raw candidate email unless needed for joins,
- include `session_id`, `candidate_name`, `ashby_application_id`, `ashby_job_id`, human scores, total score, comments, and source,
- use `source_metadata #>> '{ashby,selected,candidateEvaluationId}'` and fallback `candidate_evaluation_id` paths for historical links,
- cap `limit` at the caller layer, not inside SQL helper.

- [ ] **Step 3: Verify tests**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-evaluation-repository.test.ts
```

Expected: tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/grading/evaluation/repository.ts backend/test/grading-evaluation-repository.test.ts
git commit -m "Add grading evaluation dataset queries"
```

## Task 4: Offline Evaluation Runner

**Files:**
- Create: `backend/src/grading/evaluation/runner.ts`
- Create: `backend/test/grading-evaluation-runner.test.ts`

- [ ] **Step 1: Write failing runner tests**

Tests should verify:
- each interview is scored in a separate `scoreTranscript` call,
- batch size controls orchestration only and never combines transcripts,
- missing confidence is allowed but reported,
- report includes per-interview metrics and aggregate MAE/exact/within-half-point rates,
- output contains no transcript text by default.

- [ ] **Step 2: Implement runner**

Implement:

```ts
export interface LabeledInterviewCase {
  readonly sessionId: string;
  readonly candidateName: string | null;
  readonly ashbyJobId: string;
  readonly transcriptTurns: readonly TranscriptTurnLike[];
  readonly humanScores: Record<EvaluationDimensionKey, number>;
  readonly humanTotalScore: number;
  readonly humanComment?: string;
  readonly source: "puddle_ashby_score" | "weave_candidate_evaluation" | "markdown_scorecard";
}

export interface EvaluationRunOptions {
  readonly batchSize: number;
  readonly calibrationExampleLimit: number;
  readonly includeTranscriptInOutput?: boolean;
}

export async function evaluateLabeledInterviews(input: {
  readonly cases: readonly LabeledInterviewCase[];
  readonly rubric: unknown;
  readonly model: GradingModel;
  readonly options: EvaluationRunOptions;
}): Promise<EvaluationReport>;
```

Runner requirements:
- clamp `batchSize` to 1-5,
- pass only one transcript to `scoreTranscript` at a time,
- include `buildDefaultGradingGuide()` and selected calibration examples,
- compute per-dimension and aggregate metrics,
- preserve warnings and parse/model failures per interview,
- default output must exclude transcript text.

- [ ] **Step 3: Verify tests**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-evaluation-runner.test.ts test/grading-evaluation-scorecard.test.ts test/grading-evaluation-calibration.test.ts
```

Expected: tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/grading/evaluation/runner.ts backend/test/grading-evaluation-runner.test.ts
git commit -m "Add offline grading evaluation runner"
```

## Task 5: Evaluation CLI

**Files:**
- Create: `backend/src/grading/evaluation/cli.ts`
- Modify: `backend/package.json`
- Create: `backend/test/grading-evaluation-cli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Tests should verify argument parsing for:
- `--organization-id`,
- optional `--ashby-job-id`,
- `--limit` default 25 and max 100,
- `--batch-size` default 3 and max 5,
- `--dry-run`,
- `--include-transcript-output` default false.

- [ ] **Step 2: Implement CLI**

CLI modes:
- `--dry-run`: load candidate labels/transcript counts and print dataset inventory without model calls.
- default evaluation mode: load cases, call `evaluateLabeledInterviews`, print JSON report.

CLI safety:
- require `organizationId`,
- never print transcripts unless `--include-transcript-output` is passed,
- use `getPool()` for Puddle and `getWeavePool()` only when Weave evaluation ids are present,
- close pools in `finally`,
- support `PUDDLE_GRADING_EVALUATION_LIMIT` as an env fallback.

Add script:

```json
"grading:evaluate": "node --env-file=../.env.local --import tsx src/grading/evaluation/cli.ts"
```

- [ ] **Step 3: Verify tests**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-evaluation-cli.test.ts test/grading-evaluation-runner.test.ts
pnpm --filter @puddle/backend build
```

Expected: tests and build pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/grading/evaluation/cli.ts backend/test/grading-evaluation-cli.test.ts backend/package.json
git commit -m "Add grading evaluation CLI"
```

## Task 6: Live Inventory Verification

**Files:**
- Create: `platform/docs/superpowers/verification/2026-06-16-weave-grading-evaluation-inventory.md`

- [ ] **Step 1: Run dry-run inventory**

Use whichever connection path is available locally:

```bash
pnpm --filter @puddle/backend grading:evaluate -- --organization-id <weave-org-id> --dry-run --limit 25
```

If direct local DB env vars are missing, use AWS/SSM tunnel guidance from `platform/docs/superpowers/plans/2026-06-15-historical-fireflies-puddle-import.md`, then rerun the dry-run.

- [ ] **Step 2: Record non-sensitive verification**

Create `platform/docs/superpowers/verification/2026-06-16-weave-grading-evaluation-inventory.md` with:
- command shape, with secrets omitted,
- counts of candidate labels found,
- counts of sessions with transcripts,
- counts of labels missing transcript links,
- whether Weave `candidate_evaluations` were available,
- no transcript text and no candidate email addresses.

- [ ] **Step 3: Commit verification**

```bash
git add platform/docs/superpowers/verification/2026-06-16-weave-grading-evaluation-inventory.md
git commit -m "Verify Weave grading evaluation inventory"
```

## Final Verification

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-evaluation-scorecard.test.ts test/grading-evaluation-calibration.test.ts test/grading-evaluation-repository.test.ts test/grading-evaluation-runner.test.ts test/grading-evaluation-cli.test.ts test/grading-scoring.test.ts
pnpm --filter @puddle/backend build
```

Expected:
- all focused tests pass,
- backend TypeScript build passes,
- git status contains only pre-existing unrelated local files unless Task 6 intentionally created the verification doc.

## Self-Review

- Spec coverage: the plan builds parser, grading guide/examples, DB label discovery, one-interview-at-a-time evaluation, CLI, and live inventory verification.
- Placeholder scan: no unfinished placeholder text or unspecified implementation blocks remain.
- Type consistency: `EvaluationDimensionKey`, `CalibrationExample`, `LabeledInterviewCase`, and `EvaluationRunOptions` are defined once and reused across tasks.
- Scope check: no model training, fine-tuning, or RL is included; this plan produces the evidence needed to decide whether those are justified later.
