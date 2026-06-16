# Weave-Seeded Company Grading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build V1 company-oriented grading so approved role rubrics unlock AI recommendations seeded by Weave historical interview data.

**Architecture:** First port the verified historical Fireflies import path into `main` so Weave recordings, transcripts, and Ashby application matches exist in the shared interview packet model. Then add backend-owned grading profiles, versioned rubrics, deterministic recommendation rules, model-backed session scoring, historical backfill, platform setup UI, and reviewer feedback capture. Keep scoring and recommendation separate: the scorer produces rubric evidence; the recommendation engine deterministically converts scores, confidence, coverage, and warnings into `advance`, `hold`, or `pass`.

**Tech Stack:** Node.js/TypeScript, Fastify, Postgres/RDS migrations, Next.js App Router, WorkOS/AuthKit org authorization, AWS S3 signed artifacts, AWS Bedrock Runtime for model calls, Vitest, Node test runner for platform source tests.

---

## File Structure

Ported historical import files:

- `backend/migrations/011_historical_interview_sources.sql` tracks imported interview sources.
- `backend/src/weave/fireflies/historicalInventory.ts` parses Fireflies S3 inventory.
- `backend/src/weave/fireflies/historicalTranscript.ts` normalizes Fireflies transcript turns.
- `backend/src/weave/fireflies/historicalImportPlan.ts` maps a Fireflies recording to Puddle session, artifact, transcript, and copy rows.
- `backend/src/weave/fireflies/historicalWeaveMatches.ts` loads Weave Ashby match evidence.
- `backend/src/weave/fireflies/historicalImportRepository.ts` writes historical rows.
- `backend/src/weave/fireflies/historicalImportExecutor.ts` lists S3, builds plans, copies assets, and writes rows.
- `backend/src/weave/fireflies/historical-import.ts` exposes the CLI.
- Dashboard read models include `sessions.external_source`, `external_id`, and `source_metadata`.

New grading files:

- `backend/migrations/012_company_grading.sql` creates grading profiles, rubric versions, recommendations, and reviewer feedback.
- `backend/src/grading/types.ts` owns shared backend grading types.
- `backend/src/grading/repository.ts` owns SQL statements for grading state.
- `backend/src/grading/recommendation.ts` owns deterministic recommendation rules.
- `backend/src/grading/rubric.ts` owns the pilot-rubric seed and rubric validation helpers.
- `backend/src/grading/scoring.ts` builds scorer prompts, validates scorer output, and maps transcript turns to recommendation inputs.
- `backend/src/grading/bedrock.ts` adapts AWS Bedrock Converse to the grading model interface.
- `backend/src/grading/routes.ts` registers internal grading API routes.
- `backend/test/grading-*.test.ts` covers the grading domain, repository SQL, recommendation rules, scoring, and routes.
- `platform/lib/grading/server.ts` calls backend grading APIs from server components and API routes.
- `platform/app/api/grading/*/route.ts` proxies setup mutations with WorkOS permission checks.
- `platform/app/dashboard/AshbyOnboardingWizard.tsx` shows grading setup state after Ashby job selection.
- `platform/app/dashboard/roles/[roleId]/rubric/page.tsx` displays real rubric readiness when a profile exists.
- `platform/app/dashboard/interviews/[sessionId]/page.tsx` displays real recommendations when available.
- `platform/tests/grading-source.test.mjs` covers platform source-level auth and UI wiring.

## Task 1: Port Verified Historical Fireflies Import

**Files:**
- Port commits from branch: `historical-fireflies-import`
- Modify/Create files listed in the "Ported historical import files" section
- Test: `backend/test/fireflies-historical-*.test.ts`
- Test: `backend/test/dashboard-interviews.test.ts`
- Test: `platform/tests/org-access-source.test.mjs`
- Test: `platform/tests/ashby-onboarding-source.test.mjs`

- [ ] **Step 1: Confirm only expected local changes exist**

Run:

```bash
git status --short --branch
```

Expected: the branch may show existing user changes such as `package.json` and historical plan docs. Do not discard them.

- [ ] **Step 2: Cherry-pick the verified historical import commits**

Run:

```bash
git cherry-pick ddcc7c0 3e3231f 29be53b 6a49590 84cdd90 6b9aefe 57387bc 07f1675 37783e6 d8b1f47 6dbda06 1ab32c8
```

Expected: each commit applies cleanly onto `main`. If a conflict touches `platform/docs/superpowers/specs/2026-06-15-weave-seeded-company-grading-design.md`, keep the version already committed on `main`.

- [ ] **Step 3: Verify historical import tests**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/fireflies-historical-inventory.test.ts test/fireflies-historical-transcript.test.ts test/fireflies-historical-import-plan.test.ts test/fireflies-historical-weave-matches.test.ts test/fireflies-historical-import-repository.test.ts test/fireflies-historical-import-executor.test.ts test/fireflies-historical-import-cli.test.ts test/dashboard-interviews.test.ts test/migrations.test.ts
```

Expected: PASS.

- [ ] **Step 4: Verify platform source tests**

Run:

```bash
cd platform && node --test tests/org-access-source.test.mjs tests/ashby-onboarding-source.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit handling**

The cherry-pick command creates the original historical import commits. Do not squash them; preserving the verified commit boundaries makes audit and rollback easier.

## Task 2: Add Company Grading Migration

**Files:**
- Create: `backend/migrations/012_company_grading.sql`
- Modify: `backend/test/migrations.test.ts`

- [ ] **Step 1: Write the failing migration test**

Add this test to `backend/test/migrations.test.ts` after the historical source tracking test:

```ts
it("adds company grading tables after historical interview source tracking", () => {
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  const historicalIndex = files.indexOf("011_historical_interview_sources.sql");
  const gradingIndex = files.indexOf("012_company_grading.sql");

  expect(historicalIndex).toBeGreaterThanOrEqual(0);
  expect(gradingIndex).toBeGreaterThan(historicalIndex);

  const migration = readFileSync(join(migrationsDir, "012_company_grading.sql"), "utf-8");
  expect(migration).toContain("CREATE TABLE IF NOT EXISTS role_grading_profiles");
  expect(migration).toContain("CREATE TABLE IF NOT EXISTS role_rubric_versions");
  expect(migration).toContain("CREATE TABLE IF NOT EXISTS interview_recommendations");
  expect(migration).toContain("CREATE TABLE IF NOT EXISTS reviewer_feedback");
  expect(migration).toContain("UNIQUE (organization_id, ashby_job_id)");
  expect(migration).toContain("UNIQUE (session_id, rubric_version_id)");
  expect(migration).toContain("recommendation IN ('advance', 'hold', 'pass')");
  expect(migration).toContain("reviewer_decision IN ('advance', 'hold', 'pass', 'needs_more_review')");
});
```

- [ ] **Step 2: Run the migration test and verify it fails**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/migrations.test.ts
```

Expected: FAIL because `012_company_grading.sql` does not exist.

- [ ] **Step 3: Add the migration**

Create `backend/migrations/012_company_grading.sql`:

```sql
-- 012_company_grading.sql - role grading profiles, rubric versions, recommendations, and reviewer feedback.

CREATE TABLE IF NOT EXISTS role_grading_profiles (
  profile_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  ashby_integration_id TEXT NOT NULL REFERENCES ashby_company_integrations(integration_id) ON DELETE CASCADE,
  ashby_job_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('draft_needed', 'draft_ready', 'approval_required', 'recommendations_active', 'paused')
  ),
  active_rubric_version_id TEXT,
  draft_rubric_version_id TEXT,
  created_by_email TEXT NOT NULL,
  updated_by_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, ashby_job_id)
);

CREATE TABLE IF NOT EXISTS role_rubric_versions (
  rubric_version_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES role_grading_profiles(profile_id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  ashby_job_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'archived')),
  rubric JSONB NOT NULL,
  generation_inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_by_email TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, version)
);

CREATE INDEX IF NOT EXISTS role_rubric_versions_profile_status_idx
  ON role_rubric_versions(profile_id, status, version DESC);

ALTER TABLE role_grading_profiles
  DROP CONSTRAINT IF EXISTS role_grading_profiles_active_rubric_fk,
  ADD CONSTRAINT role_grading_profiles_active_rubric_fk
    FOREIGN KEY (active_rubric_version_id) REFERENCES role_rubric_versions(rubric_version_id) ON DELETE SET NULL;

ALTER TABLE role_grading_profiles
  DROP CONSTRAINT IF EXISTS role_grading_profiles_draft_rubric_fk,
  ADD CONSTRAINT role_grading_profiles_draft_rubric_fk
    FOREIGN KEY (draft_rubric_version_id) REFERENCES role_rubric_versions(rubric_version_id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS interview_recommendations (
  recommendation_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  ashby_job_id TEXT NOT NULL,
  rubric_version_id TEXT NOT NULL REFERENCES role_rubric_versions(rubric_version_id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('historical_fireflies', 'puddle_live', 'manual_retry')),
  recommendation TEXT NOT NULL CHECK (recommendation IN ('advance', 'hold', 'pass')),
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  category_scores JSONB NOT NULL,
  evidence JSONB NOT NULL,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, rubric_version_id)
);

CREATE INDEX IF NOT EXISTS interview_recommendations_org_job_idx
  ON interview_recommendations(organization_id, ashby_job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reviewer_feedback (
  feedback_id TEXT PRIMARY KEY,
  recommendation_id TEXT NOT NULL REFERENCES interview_recommendations(recommendation_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  reviewer_email TEXT NOT NULL,
  reviewer_decision TEXT NOT NULL CHECK (
    reviewer_decision IN ('advance', 'hold', 'pass', 'needs_more_review')
  ),
  override_reason TEXT,
  dimension_feedback JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reviewer_feedback_recommendation_idx
  ON reviewer_feedback(recommendation_id, created_at DESC);
```

- [ ] **Step 4: Run the migration test and verify it passes**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/migrations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add backend/migrations/012_company_grading.sql backend/test/migrations.test.ts
git commit -m "Add company grading schema"
```

## Task 3: Add Grading Types And SQL Repository

**Files:**
- Create: `backend/src/grading/types.ts`
- Create: `backend/src/grading/repository.ts`
- Create: `backend/test/grading-repository.test.ts`

- [ ] **Step 1: Write repository tests**

Create `backend/test/grading-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  gradingProfileUpsertStatement,
  gradingProfilesForIntegrationStatement,
  nextRubricVersionStatement,
  recommendationUpsertStatement,
  reviewerFeedbackInsertStatement,
  rubricVersionInsertStatement,
} from "../src/grading/repository.js";

describe("grading repository", () => {
  it("upserts one profile per organization and Ashby job", () => {
    const stmt = gradingProfileUpsertStatement({
      profileId: "profile_1",
      organizationId: "org_1",
      ashbyIntegrationId: "int_1",
      ashbyJobId: "job_1",
      actorEmail: "admin@example.com",
    });

    expect(stmt.sql).toContain("INSERT INTO role_grading_profiles");
    expect(stmt.sql).toContain("ON CONFLICT (organization_id, ashby_job_id) DO UPDATE");
    expect(stmt.sql).toContain("RETURNING *");
    expect(stmt.params).toEqual([
      "profile_1",
      "org_1",
      "int_1",
      "job_1",
      "draft_needed",
      "admin@example.com",
      "admin@example.com",
    ]);
  });

  it("lists profiles for an Ashby integration", () => {
    const stmt = gradingProfilesForIntegrationStatement("org_1", "int_1");

    expect(stmt.sql).toContain("FROM role_grading_profiles");
    expect(stmt.sql).toContain("organization_id = $1");
    expect(stmt.sql).toContain("ashby_integration_id = $2");
    expect(stmt.params).toEqual(["org_1", "int_1"]);
  });

  it("computes the next rubric version for a profile", () => {
    const stmt = nextRubricVersionStatement("profile_1");

    expect(stmt.sql).toContain("COALESCE(MAX(version), 0) + 1");
    expect(stmt.params).toEqual(["profile_1"]);
  });

  it("inserts rubric versions as JSONB", () => {
    const stmt = rubricVersionInsertStatement({
      rubricVersionId: "rv_1",
      profileId: "profile_1",
      organizationId: "org_1",
      ashbyJobId: "job_1",
      version: 1,
      status: "draft",
      rubric: { script_version: "job_1-v1" },
      generationInputs: { source: "weave" },
    });

    expect(stmt.sql).toContain("INSERT INTO role_rubric_versions");
    expect(stmt.sql).toContain("$8::jsonb");
    expect(stmt.sql).toContain("$9::jsonb");
    expect(stmt.params[7]).toBe(JSON.stringify({ script_version: "job_1-v1" }));
    expect(stmt.params[8]).toBe(JSON.stringify({ source: "weave" }));
  });

  it("upserts recommendations by session and rubric version", () => {
    const stmt = recommendationUpsertStatement({
      recommendationId: "rec_1",
      sessionId: "sess_1",
      organizationId: "org_1",
      ashbyJobId: "job_1",
      rubricVersionId: "rv_1",
      source: "historical_fireflies",
      recommendation: "advance",
      confidence: 0.86,
      categoryScores: [{ category: "problem_solving", score: 4 }],
      evidence: [{ quote: "I shipped it" }],
      warnings: [],
      modelMetadata: { model: "fake" },
    });

    expect(stmt.sql).toContain("INSERT INTO interview_recommendations");
    expect(stmt.sql).toContain("ON CONFLICT (session_id, rubric_version_id) DO UPDATE");
    expect(stmt.params[7]).toBe(0.86);
  });

  it("inserts reviewer feedback", () => {
    const stmt = reviewerFeedbackInsertStatement({
      feedbackId: "fb_1",
      recommendationId: "rec_1",
      sessionId: "sess_1",
      organizationId: "org_1",
      reviewerEmail: "reviewer@example.com",
      reviewerDecision: "hold",
      overrideReason: "Need hiring manager review.",
      dimensionFeedback: { agency: "Too high" },
    });

    expect(stmt.sql).toContain("INSERT INTO reviewer_feedback");
    expect(stmt.params[6]).toBe("hold");
    expect(stmt.params[7]).toBe("Need hiring manager review.");
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-repository.test.ts
```

Expected: FAIL because `backend/src/grading/repository.ts` does not exist.

- [ ] **Step 3: Add shared grading types**

Create `backend/src/grading/types.ts`:

```ts
export type GradingProfileStatus =
  | "draft_needed"
  | "draft_ready"
  | "approval_required"
  | "recommendations_active"
  | "paused";

export type RubricVersionStatus = "draft" | "approved" | "archived";
export type RecommendationValue = "advance" | "hold" | "pass";
export type ReviewerDecision = RecommendationValue | "needs_more_review";
export type RecommendationSource = "historical_fireflies" | "puddle_live" | "manual_retry";

export interface GradingProfileInput {
  readonly profileId: string;
  readonly organizationId: string;
  readonly ashbyIntegrationId: string;
  readonly ashbyJobId: string;
  readonly actorEmail: string;
}

export interface RubricVersionInput {
  readonly rubricVersionId: string;
  readonly profileId: string;
  readonly organizationId: string;
  readonly ashbyJobId: string;
  readonly version: number;
  readonly status: RubricVersionStatus;
  readonly rubric: unknown;
  readonly generationInputs: unknown;
  readonly approvedByEmail?: string | null;
  readonly approvedAt?: string | null;
}

export interface RecommendationInput {
  readonly recommendationId: string;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly ashbyJobId: string;
  readonly rubricVersionId: string;
  readonly source: RecommendationSource;
  readonly recommendation: RecommendationValue;
  readonly confidence: number;
  readonly categoryScores: unknown;
  readonly evidence: unknown;
  readonly warnings: unknown;
  readonly modelMetadata: unknown;
}

export interface ReviewerFeedbackInput {
  readonly feedbackId: string;
  readonly recommendationId: string;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly reviewerEmail: string;
  readonly reviewerDecision: ReviewerDecision;
  readonly overrideReason: string | null;
  readonly dimensionFeedback: unknown;
}
```

- [ ] **Step 4: Add repository statements**

Create `backend/src/grading/repository.ts`:

```ts
import type { SqlStatement } from "../consent/repository.js";
import type {
  GradingProfileInput,
  RecommendationInput,
  ReviewerFeedbackInput,
  RubricVersionInput,
} from "./types.js";

function jsonParam(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function gradingProfileUpsertStatement(input: GradingProfileInput): SqlStatement {
  return {
    sql:
      "INSERT INTO role_grading_profiles " +
      "(profile_id, organization_id, ashby_integration_id, ashby_job_id, status, created_by_email, updated_by_email) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7) " +
      "ON CONFLICT (organization_id, ashby_job_id) DO UPDATE SET " +
      "ashby_integration_id = EXCLUDED.ashby_integration_id, " +
      "updated_by_email = EXCLUDED.updated_by_email, updated_at = now() " +
      "RETURNING *",
    params: [
      input.profileId,
      input.organizationId,
      input.ashbyIntegrationId,
      input.ashbyJobId,
      "draft_needed",
      input.actorEmail,
      input.actorEmail,
    ],
  };
}

export function gradingProfilesForIntegrationStatement(
  organizationId: string,
  ashbyIntegrationId: string,
): SqlStatement {
  return {
    sql:
      "SELECT * FROM role_grading_profiles " +
      "WHERE organization_id = $1 AND ashby_integration_id = $2 " +
      "ORDER BY created_at ASC",
    params: [organizationId, ashbyIntegrationId],
  };
}

export function nextRubricVersionStatement(profileId: string): SqlStatement {
  return {
    sql: "SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM role_rubric_versions WHERE profile_id = $1",
    params: [profileId],
  };
}

export function rubricVersionInsertStatement(input: RubricVersionInput): SqlStatement {
  return {
    sql:
      "INSERT INTO role_rubric_versions " +
      "(rubric_version_id, profile_id, organization_id, ashby_job_id, version, status, approved_by_email, rubric, generation_inputs, approved_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::timestamptz) " +
      "RETURNING *",
    params: [
      input.rubricVersionId,
      input.profileId,
      input.organizationId,
      input.ashbyJobId,
      input.version,
      input.status,
      input.approvedByEmail ?? null,
      jsonParam(input.rubric),
      jsonParam(input.generationInputs),
      input.approvedAt ?? null,
    ],
  };
}

export function recommendationUpsertStatement(input: RecommendationInput): SqlStatement {
  return {
    sql:
      "INSERT INTO interview_recommendations " +
      "(recommendation_id, session_id, organization_id, ashby_job_id, rubric_version_id, source, recommendation, confidence, category_scores, evidence, warnings, model_metadata) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb) " +
      "ON CONFLICT (session_id, rubric_version_id) DO UPDATE SET " +
      "source = EXCLUDED.source, recommendation = EXCLUDED.recommendation, confidence = EXCLUDED.confidence, " +
      "category_scores = EXCLUDED.category_scores, evidence = EXCLUDED.evidence, warnings = EXCLUDED.warnings, " +
      "model_metadata = EXCLUDED.model_metadata, created_at = now() RETURNING *",
    params: [
      input.recommendationId,
      input.sessionId,
      input.organizationId,
      input.ashbyJobId,
      input.rubricVersionId,
      input.source,
      input.recommendation,
      input.confidence,
      jsonParam(input.categoryScores),
      jsonParam(input.evidence),
      jsonParam(input.warnings),
      jsonParam(input.modelMetadata),
    ],
  };
}

export function reviewerFeedbackInsertStatement(input: ReviewerFeedbackInput): SqlStatement {
  return {
    sql:
      "INSERT INTO reviewer_feedback " +
      "(feedback_id, recommendation_id, session_id, organization_id, reviewer_email, reviewer_decision, override_reason, dimension_feedback) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING *",
    params: [
      input.feedbackId,
      input.recommendationId,
      input.sessionId,
      input.organizationId,
      input.reviewerEmail,
      input.reviewerDecision,
      input.overrideReason,
      jsonParam(input.dimensionFeedback),
    ],
  };
}
```

- [ ] **Step 5: Run tests and verify they pass**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-repository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add backend/src/grading/types.ts backend/src/grading/repository.ts backend/test/grading-repository.test.ts
git commit -m "Add grading repository primitives"
```

## Task 4: Add Deterministic Recommendation Engine

**Files:**
- Create: `backend/src/grading/recommendation.ts`
- Create: `backend/test/grading-recommendation.test.ts`

- [ ] **Step 1: Write recommendation tests**

Create `backend/test/grading-recommendation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { recommendInterview } from "../src/grading/recommendation.js";

const baseInput = {
  categoryScores: [
    { category: "problem_solving", score: 4, confidence: 0.9, evidenceQuotes: ["quote"] },
    { category: "agency", score: 3, confidence: 0.84, evidenceQuotes: ["quote"] },
    { category: "competitiveness", score: 3, confidence: 0.8, evidenceQuotes: ["quote"] },
    { category: "curious", score: 3, confidence: 0.82, evidenceQuotes: ["quote"] },
  ],
  bareMinimumRule: "at_least_one_4_and_problem_solving_ge_3",
  minimumConfidence: 0.75,
  severeWarnings: [],
};

describe("recommendInterview", () => {
  it("advances when bare minimum, confidence, and evidence all pass", () => {
    expect(recommendInterview(baseInput)).toEqual({
      recommendation: "advance",
      confidence: 0.84,
      warnings: [],
    });
  });

  it("holds when confidence is low", () => {
    expect(
      recommendInterview({
        ...baseInput,
        categoryScores: [
          { category: "problem_solving", score: 4, confidence: 0.6, evidenceQuotes: ["quote"] },
          { category: "agency", score: 3, confidence: 0.84, evidenceQuotes: ["quote"] },
        ],
      }),
    ).toEqual({
      recommendation: "hold",
      confidence: 0.72,
      warnings: ["low_confidence"],
    });
  });

  it("passes when bare minimum fails with enough evidence", () => {
    expect(
      recommendInterview({
        ...baseInput,
        categoryScores: [
          { category: "problem_solving", score: 2, confidence: 0.9, evidenceQuotes: ["quote"] },
          { category: "agency", score: 3, confidence: 0.9, evidenceQuotes: ["quote"] },
        ],
      }),
    ).toEqual({
      recommendation: "pass",
      confidence: 0.9,
      warnings: [],
    });
  });

  it("holds when severe warnings are present", () => {
    expect(
      recommendInterview({
        ...baseInput,
        severeWarnings: ["severe_integrity_review_required"],
      }),
    ).toEqual({
      recommendation: "hold",
      confidence: 0.84,
      warnings: ["severe_integrity_review_required"],
    });
  });

  it("holds when evidence is missing", () => {
    expect(
      recommendInterview({
        ...baseInput,
        categoryScores: [
          { category: "problem_solving", score: 4, confidence: 0.9, evidenceQuotes: [] },
          { category: "agency", score: 3, confidence: 0.9, evidenceQuotes: ["quote"] },
        ],
      }),
    ).toEqual({
      recommendation: "hold",
      confidence: 0.9,
      warnings: ["missing_evidence"],
    });
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-recommendation.test.ts
```

Expected: FAIL because `backend/src/grading/recommendation.ts` does not exist.

- [ ] **Step 3: Add recommendation engine**

Create `backend/src/grading/recommendation.ts`:

```ts
import type { RecommendationValue } from "./types.js";

export interface RecommendationScore {
  readonly category: string;
  readonly score: number;
  readonly confidence: number;
  readonly evidenceQuotes: readonly string[];
}

export interface RecommendationRuleInput {
  readonly categoryScores: readonly RecommendationScore[];
  readonly bareMinimumRule: "at_least_one_4_and_problem_solving_ge_3" | string;
  readonly minimumConfidence: number;
  readonly severeWarnings: readonly string[];
}

export interface RecommendationRuleOutput {
  readonly recommendation: RecommendationValue;
  readonly confidence: number;
  readonly warnings: readonly string[];
}

export function recommendInterview(input: RecommendationRuleInput): RecommendationRuleOutput {
  const confidence = roundedAverage(input.categoryScores.map((score) => score.confidence));
  const warnings = [
    ...input.severeWarnings,
    ...(confidence < input.minimumConfidence ? ["low_confidence"] : []),
    ...(input.categoryScores.some((score) => score.evidenceQuotes.length === 0) ? ["missing_evidence"] : []),
  ];

  if (warnings.length > 0) {
    return { recommendation: "hold", confidence, warnings };
  }

  if (meetsBareMinimum(input)) {
    return { recommendation: "advance", confidence, warnings };
  }

  return { recommendation: "pass", confidence, warnings };
}

function meetsBareMinimum(input: RecommendationRuleInput): boolean {
  if (input.bareMinimumRule !== "at_least_one_4_and_problem_solving_ge_3") {
    return false;
  }

  const byCategory = new Map(input.categoryScores.map((score) => [score.category, score]));
  const problemSolving = byCategory.get("problem_solving")?.score ?? 0;
  const hasFour = input.categoryScores.some((score) => score.score >= 4);
  return hasFour && problemSolving >= 3;
}

function roundedAverage(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 100) / 100;
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-recommendation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add backend/src/grading/recommendation.ts backend/test/grading-recommendation.test.ts
git commit -m "Add deterministic grading recommendations"
```

## Task 5: Add Rubric Seed And Draft Generator

**Files:**
- Create: `backend/src/grading/rubric.ts`
- Create: `backend/test/grading-rubric.test.ts`

- [ ] **Step 1: Write rubric tests**

Create `backend/test/grading-rubric.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDraftRubric, validateRoleRubric } from "../src/grading/rubric.js";

describe("grading rubric", () => {
  it("builds a draft rubric from the pilot rubric and job context", () => {
    const draft = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });

    expect(draft.script_version).toBe("job_1-v1");
    expect(draft.role.title).toBe("Founding AI Engineer");
    expect(draft.dimensions.map((dimension) => dimension.key)).toEqual([
      "problem_solving",
      "agency",
      "competitiveness",
      "curious",
    ]);
    expect(draft.recommendation_thresholds.minimum_confidence).toBe(0.75);
    expect(draft.generation_context.historical_session_count).toBe(12);
  });

  it("validates a complete rubric", () => {
    const draft = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });

    expect(validateRoleRubric(draft)).toEqual({ ok: true });
  });

  it("rejects rubrics without anchors", () => {
    const draft = buildDraftRubric({
      organizationId: "org_1",
      ashbyJobId: "job_1",
      jobName: "Founding AI Engineer",
      historicalSessionCount: 12,
      matchedApplicationCount: 10,
    });
    const invalid = {
      ...draft,
      dimensions: [{ ...draft.dimensions[0], anchors: { 1: "Only one" } }],
    };

    expect(validateRoleRubric(invalid)).toEqual({
      ok: false,
      error: "Each rubric dimension must define anchors 1, 2, 3, and 4.",
    });
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-rubric.test.ts
```

Expected: FAIL because `backend/src/grading/rubric.ts` does not exist.

- [ ] **Step 3: Add rubric seed and validation**

Create `backend/src/grading/rubric.ts` with the pilot rubric encoded as a TypeScript constant. Keep the category names, meanings, anchors, questions, and bare minimum rule aligned with `rubric/pilot-v1.yaml`.

```ts
type AnchorMap = Record<1 | 2 | 3 | 4, string>;

export interface RoleRubricDimension {
  readonly key: string;
  readonly name: string;
  readonly meaning: string;
  readonly anchors: AnchorMap;
}

export interface RoleRubricQuestion {
  readonly question_id: string;
  readonly verbatim_text: string;
  readonly rubric_categories: readonly string[];
  readonly target_evidence: readonly string[];
}

export interface RoleRubric {
  readonly script_version: string;
  readonly role: {
    readonly organization_id: string;
    readonly ashby_job_id: string;
    readonly title: string;
  };
  readonly dimensions: readonly RoleRubricDimension[];
  readonly questions: readonly RoleRubricQuestion[];
  readonly bare_minimum_rule: "at_least_one_4_and_problem_solving_ge_3";
  readonly recommendation_thresholds: {
    readonly minimum_confidence: number;
  };
  readonly disallowed_signals: readonly string[];
  readonly generation_context: {
    readonly historical_session_count: number;
    readonly matched_application_count: number;
  };
}

export function buildDraftRubric(input: {
  readonly organizationId: string;
  readonly ashbyJobId: string;
  readonly jobName: string;
  readonly historicalSessionCount: number;
  readonly matchedApplicationCount: number;
}): RoleRubric {
  return {
    script_version: `${input.ashbyJobId}-v1`,
    role: {
      organization_id: input.organizationId,
      ashby_job_id: input.ashbyJobId,
      title: input.jobName,
    },
    dimensions: PILOT_DIMENSIONS,
    questions: PILOT_QUESTIONS,
    bare_minimum_rule: "at_least_one_4_and_problem_solving_ge_3",
    recommendation_thresholds: {
      minimum_confidence: 0.75,
    },
    disallowed_signals: [
      "appearance",
      "voice_quality",
      "accent",
      "emotion",
      "facial_expression",
      "race",
      "gender",
      "age",
      "disability",
    ],
    generation_context: {
      historical_session_count: input.historicalSessionCount,
      matched_application_count: input.matchedApplicationCount,
    },
  };
}

export function validateRoleRubric(value: unknown): { ok: true } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: "Rubric must be an object." };
  }
  if (!Array.isArray(value.dimensions) || value.dimensions.length === 0) {
    return { ok: false, error: "Rubric must define at least one dimension." };
  }
  for (const dimension of value.dimensions) {
    if (!isRecord(dimension) || !hasAnchorSet(dimension.anchors)) {
      return { ok: false, error: "Each rubric dimension must define anchors 1, 2, 3, and 4." };
    }
  }
  if (!Array.isArray(value.questions) || value.questions.length === 0) {
    return { ok: false, error: "Rubric must define at least one question." };
  }
  return { ok: true };
}

function hasAnchorSet(value: unknown): value is AnchorMap {
  if (!isRecord(value)) return false;
  return [1, 2, 3, 4].every((level) => typeof value[String(level)] === "string" || typeof value[level] === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const PILOT_DIMENSIONS: readonly RoleRubricDimension[] = [
  {
    key: "problem_solving",
    name: "Problem Solving",
    meaning: "Finds clever, elegant solutions to hard problems.",
    anchors: {
      1: "Downvoted.",
      2: "Found a solution alongside others.",
      3: "Accepted answer on Stack Overflow.",
      4: "Front page on Hacker News.",
    },
  },
  {
    key: "agency",
    name: "Agency",
    meaning: "Stops at nothing to solve a problem.",
    anchors: {
      1: "Does not meet expectations.",
      2: "Does everything expected or asked.",
      3: "Puts in more effort than expected.",
      4: "Hacked or broke rules to solve the problem.",
    },
  },
  {
    key: "competitiveness",
    name: "Competitiveness",
    meaning: "Gets consumed by a desire to win.",
    anchors: {
      1: "Absence of competitiveness.",
      2: "Does not like to lose.",
      3: "Emotionally affected by losing.",
      4: "Competitive to a detrimental degree in some facet of life.",
    },
  },
  {
    key: "curious",
    name: "Curious",
    meaning: "Needs to know the why behind everything, and acts on it.",
    anchors: {
      1: "Absence of curiosity.",
      2: "Signs of curiosity but no action.",
      3: "Very curious about something and takes action.",
      4: "Obsessively curious; becomes an expert.",
    },
  },
];

const PILOT_QUESTIONS: readonly RoleRubricQuestion[] = [
  {
    question_id: "q1",
    verbatim_text: "Can you tell me about a technically complex problem you solved with a clever or hacky solution?",
    rubric_categories: ["problem_solving"],
    target_evidence: [
      "the problem and why it was hard",
      "the solution and why it was clever or elegant",
      "the impact and level of recognition",
    ],
  },
  {
    question_id: "q2",
    verbatim_text: "Can you tell me about the time you hacked a non-computer system to your advantage?",
    rubric_categories: ["agency"],
    target_evidence: [
      "the system and the rules or norms in place",
      "what the candidate did and why it was unconventional",
      "the outcome and what it cost or risked",
    ],
  },
  {
    question_id: "q3",
    verbatim_text: "Can you tell me about an area of your life where your competitiveness became so intense that it cost you something?",
    rubric_categories: ["competitiveness"],
    target_evidence: [
      "the area of life and what winning meant there",
      "how intense the competitiveness became",
      "the concrete cost the candidate paid",
    ],
  },
  {
    question_id: "q4",
    verbatim_text: "Can you tell me about a niche or obscure topic that no one knows about but you are an expert in?",
    rubric_categories: ["curious"],
    target_evidence: [
      "the topic and why it is niche",
      "how the candidate became an expert",
      "evidence of top-1% depth and sustained action",
    ],
  },
];
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-rubric.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add backend/src/grading/rubric.ts backend/test/grading-rubric.test.ts
git commit -m "Add Weave-seeded rubric drafts"
```

## Task 6: Register Grading Profiles From Ashby Job Selection

**Files:**
- Modify: `backend/src/ashby/routes.ts`
- Modify: `backend/test/ashby-routes.test.ts`
- Modify: `backend/test/grading-repository.test.ts`

- [ ] **Step 1: Add an Ashby route test for profile creation**

In `backend/test/ashby-routes.test.ts`, add a route test that posts selected jobs and asserts the backend writes one role grading profile per selected Ashby job. Use the existing route test harness in that file. The assertion must inspect SQL calls and require `INSERT INTO role_grading_profiles`.

Expected test body shape:

```ts
expect(sqlCalls.some((sql) => sql.includes("INSERT INTO role_grading_profiles"))).toBe(true);
expect(sqlCalls.filter((sql) => sql.includes("INSERT INTO role_grading_profiles"))).toHaveLength(2);
```

- [ ] **Step 2: Run the Ashby route test and verify it fails**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/ashby-routes.test.ts
```

Expected: FAIL because selected Ashby jobs do not create grading profiles.

- [ ] **Step 3: Update `backend/src/ashby/routes.ts` imports**

Add:

```ts
import { randomUUID } from "node:crypto";
import { gradingProfileUpsertStatement } from "../grading/repository.js";
```

If `randomUUID` is already imported in the file, only add `gradingProfileUpsertStatement`.

- [ ] **Step 4: Create grading profiles inside the job-selection transaction**

Inside the `/integrations/ashby/onboarding/jobs` transaction, after the `jobs_selected` audit insert, add:

```ts
for (const jobId of jobs) {
  const profile = gradingProfileUpsertStatement({
    profileId: randomUUID(),
    organizationId: identity.organizationId,
    ashbyIntegrationId: integrationId,
    ashbyJobId: jobId,
    actorEmail: reviewerEmail,
  });
  await client.query(profile.sql, [...profile.params]);
}
```

- [ ] **Step 5: Run tests and verify they pass**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/ashby-routes.test.ts test/grading-repository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add backend/src/ashby/routes.ts backend/test/ashby-routes.test.ts
git commit -m "Create grading profiles from Ashby jobs"
```

## Task 7: Add Backend Grading Routes For State, Draft, Approval, And Feedback

**Files:**
- Create: `backend/src/grading/routes.ts`
- Modify: `backend/src/server.ts`
- Create: `backend/test/grading-routes.test.ts`
- Modify: `backend/src/grading/repository.ts`

- [ ] **Step 1: Write route tests**

Create `backend/test/grading-routes.test.ts` with Fastify route tests that use fake DB query functions. Cover:

```ts
it("returns company grading state for an organization");
it("creates a draft rubric for a grading profile");
it("approves a draft rubric and activates recommendations");
it("stores reviewer feedback");
it("rejects missing organization id");
```

Each test must assert the response status and the SQL table touched:

```ts
expect(sqlCalls.some((sql) => sql.includes("role_grading_profiles"))).toBe(true);
expect(sqlCalls.some((sql) => sql.includes("role_rubric_versions"))).toBe(true);
expect(sqlCalls.some((sql) => sql.includes("reviewer_feedback"))).toBe(true);
```

- [ ] **Step 2: Run route tests and verify they fail**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-routes.test.ts
```

Expected: FAIL because `backend/src/grading/routes.ts` does not exist.

- [ ] **Step 3: Add missing repository statements**

Add these functions to `backend/src/grading/repository.ts`:

```ts
export function gradingProfilesForOrganizationStatement(organizationId: string): SqlStatement {
  return {
    sql:
      "SELECT p.*, active.rubric AS active_rubric, draft.rubric AS draft_rubric " +
      "FROM role_grading_profiles p " +
      "LEFT JOIN role_rubric_versions active ON active.rubric_version_id = p.active_rubric_version_id " +
      "LEFT JOIN role_rubric_versions draft ON draft.rubric_version_id = p.draft_rubric_version_id " +
      "WHERE p.organization_id = $1 ORDER BY p.created_at ASC",
    params: [organizationId],
  };
}

export function gradingProfileByIdForUpdateStatement(profileId: string, organizationId: string): SqlStatement {
  return {
    sql:
      "SELECT * FROM role_grading_profiles " +
      "WHERE profile_id = $1 AND organization_id = $2 FOR UPDATE",
    params: [profileId, organizationId],
  };
}

export function gradingProfileDraftUpdateStatement(input: {
  readonly profileId: string;
  readonly draftRubricVersionId: string;
  readonly actorEmail: string;
}): SqlStatement {
  return {
    sql:
      "UPDATE role_grading_profiles SET status = 'draft_ready', draft_rubric_version_id = $2, " +
      "updated_by_email = $3, updated_at = now() WHERE profile_id = $1 RETURNING *",
    params: [input.profileId, input.draftRubricVersionId, input.actorEmail],
  };
}

export function rubricVersionApproveStatement(input: {
  readonly rubricVersionId: string;
  readonly approvedByEmail: string;
}): SqlStatement {
  return {
    sql:
      "UPDATE role_rubric_versions SET status = 'approved', approved_by_email = $2, approved_at = now() " +
      "WHERE rubric_version_id = $1 RETURNING *",
    params: [input.rubricVersionId, input.approvedByEmail],
  };
}

export function gradingProfileActivateStatement(input: {
  readonly profileId: string;
  readonly activeRubricVersionId: string;
  readonly actorEmail: string;
}): SqlStatement {
  return {
    sql:
      "UPDATE role_grading_profiles SET status = 'recommendations_active', active_rubric_version_id = $2, " +
      "draft_rubric_version_id = NULL, updated_by_email = $3, updated_at = now() " +
      "WHERE profile_id = $1 RETURNING *",
    params: [input.profileId, input.activeRubricVersionId, input.actorEmail],
  };
}
```

- [ ] **Step 4: Add grading routes**

Create `backend/src/grading/routes.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { getPool } from "../db/pool.js";
import { buildDraftRubric, validateRoleRubric } from "./rubric.js";
import {
  gradingProfileActivateStatement,
  gradingProfileByIdForUpdateStatement,
  gradingProfileDraftUpdateStatement,
  gradingProfilesForOrganizationStatement,
  nextRubricVersionStatement,
  reviewerFeedbackInsertStatement,
  rubricVersionApproveStatement,
  rubricVersionInsertStatement,
} from "./repository.js";

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function registerGradingRoutes(app: FastifyInstance): void {
  app.post("/grading/company-state", async (request, reply) => {
    const body = objectValue(request.body);
    const organizationId = stringValue(body.organizationId);
    if (!organizationId) {
      return reply.code(400).send({ error: "organizationId is required" });
    }

    const stmt = gradingProfilesForOrganizationStatement(organizationId);
    const { rows } = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.send({ profiles: rows });
  });

  app.post<{ Params: { profileId: string } }>("/grading/profiles/:profileId/draft", async (request, reply) => {
    const body = objectValue(request.body);
    const organizationId = stringValue(body.organizationId);
    const actorEmail = stringValue(body.actorEmail);
    const jobName = stringValue(body.jobName) ?? "Selected Ashby role";
    if (!organizationId || !actorEmail) {
      return reply.code(400).send({ error: "organizationId and actorEmail are required" });
    }

    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const profileStmt = gradingProfileByIdForUpdateStatement(request.params.profileId, organizationId);
      const profileResult = await client.query(profileStmt.sql, [...profileStmt.params]);
      const profile = profileResult.rows[0] as Record<string, unknown> | undefined;
      const ashbyJobId = stringValue(profile?.ashby_job_id);
      if (!profile || !ashbyJobId) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ error: "grading profile not found" });
      }

      const versionStmt = nextRubricVersionStatement(request.params.profileId);
      const versionResult = await client.query(versionStmt.sql, [...versionStmt.params]);
      const version = Number(versionResult.rows[0]?.next_version ?? 1);
      const rubric = buildDraftRubric({
        organizationId,
        ashbyJobId,
        jobName,
        historicalSessionCount: Number(body.historicalSessionCount ?? 0),
        matchedApplicationCount: Number(body.matchedApplicationCount ?? 0),
      });
      const rubricVersionId = randomUUID();
      const insert = rubricVersionInsertStatement({
        rubricVersionId,
        profileId: request.params.profileId,
        organizationId,
        ashbyJobId,
        version,
        status: "draft",
        rubric,
        generationInputs: {
          source: "weave_seeded_pilot",
          historicalSessionCount: body.historicalSessionCount ?? 0,
          matchedApplicationCount: body.matchedApplicationCount ?? 0,
        },
      });
      await client.query(insert.sql, [...insert.params]);
      const update = gradingProfileDraftUpdateStatement({
        profileId: request.params.profileId,
        draftRubricVersionId: rubricVersionId,
        actorEmail,
      });
      await client.query(update.sql, [...update.params]);
      await client.query("COMMIT");
      return reply.code(201).send({ rubricVersionId, rubric });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post<{ Params: { profileId: string } }>("/grading/profiles/:profileId/approve", async (request, reply) => {
    const body = objectValue(request.body);
    const organizationId = stringValue(body.organizationId);
    const actorEmail = stringValue(body.actorEmail);
    const rubricVersionId = stringValue(body.rubricVersionId);
    const rubric = body.rubric;
    if (!organizationId || !actorEmail || !rubricVersionId) {
      return reply.code(400).send({ error: "organizationId, actorEmail, and rubricVersionId are required" });
    }
    const validation = validateRoleRubric(rubric);
    if (!validation.ok) {
      return reply.code(400).send({ error: validation.error });
    }

    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const approve = rubricVersionApproveStatement({ rubricVersionId, approvedByEmail: actorEmail });
      await client.query(approve.sql, [...approve.params]);
      const activate = gradingProfileActivateStatement({
        profileId: request.params.profileId,
        activeRubricVersionId: rubricVersionId,
        actorEmail,
      });
      const activated = await client.query(activate.sql, [...activate.params]);
      await client.query("COMMIT");
      return reply.send({ profile: activated.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post<{ Params: { recommendationId: string } }>("/grading/recommendations/:recommendationId/feedback", async (request, reply) => {
    const body = objectValue(request.body);
    const stmt = reviewerFeedbackInsertStatement({
      feedbackId: randomUUID(),
      recommendationId: request.params.recommendationId,
      sessionId: stringValue(body.sessionId) ?? "",
      organizationId: stringValue(body.organizationId) ?? "",
      reviewerEmail: stringValue(body.reviewerEmail) ?? "",
      reviewerDecision: stringValue(body.reviewerDecision) as "advance" | "hold" | "pass" | "needs_more_review",
      overrideReason: stringValue(body.overrideReason),
      dimensionFeedback: body.dimensionFeedback ?? {},
    });
    const result = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.code(201).send({ feedback: result.rows[0] });
  });
}
```

- [ ] **Step 5: Register routes in `backend/src/server.ts`**

Add:

```ts
import { registerGradingRoutes } from "./grading/routes.js";
```

Inside `buildServer`, after `registerAshbyRoutes(app);`, add:

```ts
registerGradingRoutes(app);
```

- [ ] **Step 6: Run route tests**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-routes.test.ts test/grading-repository.test.ts test/grading-rubric.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add backend/src/grading/routes.ts backend/src/grading/repository.ts backend/src/server.ts backend/test/grading-routes.test.ts
git commit -m "Add grading setup routes"
```

## Task 8: Add Model-Backed Session Scoring

**Files:**
- Create: `backend/src/grading/scoring.ts`
- Create: `backend/src/grading/bedrock.ts`
- Create: `backend/test/grading-scoring.test.ts`

- [ ] **Step 1: Write scorer tests**

Create `backend/test/grading-scoring.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-scoring.test.ts
```

Expected: FAIL because `backend/src/grading/scoring.ts` does not exist.

- [ ] **Step 3: Add scoring core**

Create `backend/src/grading/scoring.ts`:

```ts
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
  readonly model: GradingModel;
}

export interface ParsedCategoryScore {
  readonly category: string;
  readonly score: number;
  readonly confidence: number;
  readonly evidenceQuotes: readonly string[];
  readonly rationale: string;
}

export interface ParsedScoringOutput {
  readonly categoryScores: readonly ParsedCategoryScore[];
  readonly warnings: readonly string[];
}

export function buildScoringPrompt(input: {
  readonly rubric: unknown;
  readonly transcriptTurns: readonly TranscriptTurnLike[];
}): string {
  return [
    "You are Puddle's rubric scorer for a structured hiring interview.",
    "Score only job-related answer content against the provided rubric.",
    "Do not score appearance, voice quality, accent, emotion, facial expression, age, race, gender, disability, or protected-class proxies.",
    "Return strict JSON only with keys category_scores and warnings.",
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
    const confidence = numberValue(score.confidence);
    const evidenceQuotes = Array.isArray(score.evidence_quotes)
      ? score.evidence_quotes.filter((quote): quote is string => typeof quote === "string")
      : [];
    const rationale = stringValue(score.rationale) ?? "";
    if (!category || numericScore === null || confidence === null) {
      throw new Error("Each category score must include category, score, and confidence.");
    }
    return {
      category,
      score: numericScore,
      confidence,
      evidenceQuotes,
      rationale,
    };
  });

  return {
    categoryScores,
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
  };
}

export async function scoreTranscript(input: ScoringInput): Promise<ParsedScoringOutput> {
  const prompt = buildScoringPrompt(input);
  return parseScoringOutput(await input.model.complete(prompt));
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
```

- [ ] **Step 4: Add Bedrock adapter**

Create `backend/src/grading/bedrock.ts`:

```ts
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
    return blocks.map((block) => block.text ?? "").join("");
  }
}
```

- [ ] **Step 5: Run scoring tests**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-scoring.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add backend/src/grading/scoring.ts backend/src/grading/bedrock.ts backend/test/grading-scoring.test.ts
git commit -m "Add model-backed grading scorer"
```

## Task 9: Add Session Recommendation And Historical Backfill

**Files:**
- Modify: `backend/src/grading/repository.ts`
- Modify: `backend/src/grading/routes.ts`
- Create: `backend/test/grading-session-recommendations.test.ts`

- [ ] **Step 1: Write session recommendation tests**

Create `backend/test/grading-session-recommendations.test.ts` covering:

```ts
it("loads a session transcript and active rubric before scoring");
it("stores recommendation output with deterministic recommendation value");
it("returns 409 when a session has no transcript turns");
it("selects historical Fireflies source when sessions.external_source is fireflies");
```

Each test must assert that SQL references:

```text
sessions
transcript_turns
role_grading_profiles
role_rubric_versions
interview_recommendations
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-session-recommendations.test.ts
```

Expected: FAIL because route and repository support is incomplete.

- [ ] **Step 3: Add session scoring repository statements**

Add to `backend/src/grading/repository.ts`:

```ts
export function sessionForRecommendationStatement(sessionId: string, organizationId: string): SqlStatement {
  return {
    sql:
      "SELECT s.session_id, s.org_id, s.external_source, s.source_metadata, " +
      "COALESCE(s.source_metadata #>> '{ashby,selected,jobId}', s.source_metadata #>> '{ashby,selected,ashbyJobId}') AS ashby_job_id " +
      "FROM sessions s WHERE s.session_id = $1 AND s.org_id = $2 LIMIT 1",
    params: [sessionId, organizationId],
  };
}

export function transcriptTurnsForSessionStatement(sessionId: string): SqlStatement {
  return {
    sql:
      "SELECT turn_index AS \"turnIndex\", speaker, text " +
      "FROM transcript_turns WHERE session_id = $1 ORDER BY turn_index ASC",
    params: [sessionId],
  };
}

export function activeRubricForJobStatement(organizationId: string, ashbyJobId: string): SqlStatement {
  return {
    sql:
      "SELECT p.profile_id, p.active_rubric_version_id, r.rubric " +
      "FROM role_grading_profiles p " +
      "JOIN role_rubric_versions r ON r.rubric_version_id = p.active_rubric_version_id " +
      "WHERE p.organization_id = $1 AND p.ashby_job_id = $2 AND p.status = 'recommendations_active' " +
      "LIMIT 1",
    params: [organizationId, ashbyJobId],
  };
}

export function historicalBackfillSessionsStatement(organizationId: string, ashbyJobId: string, limit: number): SqlStatement {
  return {
    sql:
      "SELECT s.session_id FROM sessions s " +
      "LEFT JOIN interview_recommendations rec ON rec.session_id = s.session_id " +
      "WHERE s.org_id = $1 AND s.external_source = 'fireflies' " +
      "AND COALESCE(s.source_metadata #>> '{ashby,selected,jobId}', s.source_metadata #>> '{ashby,selected,ashbyJobId}') = $2 " +
      "AND rec.recommendation_id IS NULL " +
      "ORDER BY s.started_at DESC NULLS LAST LIMIT $3",
    params: [organizationId, ashbyJobId, limit],
  };
}
```

- [ ] **Step 4: Add score-session route**

In `backend/src/grading/routes.ts`, import:

```ts
import { BedrockGradingModel } from "./bedrock.js";
import { recommendInterview } from "./recommendation.js";
import { scoreTranscript } from "./scoring.js";
import {
  activeRubricForJobStatement,
  historicalBackfillSessionsStatement,
  recommendationUpsertStatement,
  sessionForRecommendationStatement,
  transcriptTurnsForSessionStatement,
} from "./repository.js";
```

Add route:

```ts
app.post<{ Params: { sessionId: string } }>("/grading/recommendations/session/:sessionId", async (request, reply) => {
  const body = objectValue(request.body);
  const organizationId = stringValue(body.organizationId);
  if (!organizationId) {
    return reply.code(400).send({ error: "organizationId is required" });
  }

  const sessionStmt = sessionForRecommendationStatement(request.params.sessionId, organizationId);
  const sessionResult = await getPool().query(sessionStmt.sql, [...sessionStmt.params]);
  const session = sessionResult.rows[0] as Record<string, unknown> | undefined;
  const ashbyJobId = stringValue(session?.ashby_job_id);
  if (!session || !ashbyJobId) {
    return reply.code(404).send({ error: "session or Ashby job match not found" });
  }

  const transcriptStmt = transcriptTurnsForSessionStatement(request.params.sessionId);
  const transcriptResult = await getPool().query(transcriptStmt.sql, [...transcriptStmt.params]);
  if (!transcriptResult.rows.length) {
    return reply.code(409).send({ error: "session has no transcript turns" });
  }

  const rubricStmt = activeRubricForJobStatement(organizationId, ashbyJobId);
  const rubricResult = await getPool().query(rubricStmt.sql, [...rubricStmt.params]);
  const activeRubric = rubricResult.rows[0] as Record<string, unknown> | undefined;
  if (!activeRubric) {
    return reply.code(409).send({ error: "recommendations are not active for this Ashby job" });
  }

  const scoring = await scoreTranscript({
    rubric: activeRubric.rubric,
    transcriptTurns: transcriptResult.rows as { speaker: string; text: string; turnIndex: number }[],
    model: new BedrockGradingModel(),
  });
  const ruleOutput = recommendInterview({
    categoryScores: scoring.categoryScores,
    bareMinimumRule: stringValue((activeRubric.rubric as Record<string, unknown>)?.bare_minimum_rule) ?? "at_least_one_4_and_problem_solving_ge_3",
    minimumConfidence: 0.75,
    severeWarnings: scoring.warnings,
  });
  const recommendationId = randomUUID();
  const insert = recommendationUpsertStatement({
    recommendationId,
    sessionId: request.params.sessionId,
    organizationId,
    ashbyJobId,
    rubricVersionId: stringValue(activeRubric.active_rubric_version_id) ?? "",
    source: session.external_source === "fireflies" ? "historical_fireflies" : "puddle_live",
    recommendation: ruleOutput.recommendation,
    confidence: ruleOutput.confidence,
    categoryScores: scoring.categoryScores,
    evidence: scoring.categoryScores.flatMap((score) => score.evidenceQuotes.map((quote) => ({ category: score.category, quote }))),
    warnings: ruleOutput.warnings,
    modelMetadata: { scorer: "bedrock-grading-v1" },
  });
  const saved = await getPool().query(insert.sql, [...insert.params]);
  return reply.code(201).send({ recommendation: saved.rows[0] });
});
```

- [ ] **Step 5: Add backfill route**

Add route:

```ts
app.post("/grading/recommendations/backfill-historical", async (request, reply) => {
  const body = objectValue(request.body);
  const organizationId = stringValue(body.organizationId);
  const ashbyJobId = stringValue(body.ashbyJobId);
  const limit = typeof body.limit === "number" && Number.isFinite(body.limit) ? Math.min(Math.trunc(body.limit), 25) : 10;
  if (!organizationId || !ashbyJobId) {
    return reply.code(400).send({ error: "organizationId and ashbyJobId are required" });
  }
  const stmt = historicalBackfillSessionsStatement(organizationId, ashbyJobId, limit);
  const result = await getPool().query(stmt.sql, [...stmt.params]);
  return reply.send({ queued: result.rows.map((row) => row.session_id) });
});
```

This V1 route returns session IDs for the platform or an operator to score explicitly through `/grading/recommendations/session/:sessionId`. The implementation does not require a queue; operators run bounded batches and retry failed sessions by calling the same session recommendation route.

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/grading-session-recommendations.test.ts test/grading-scoring.test.ts test/grading-recommendation.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add backend/src/grading/repository.ts backend/src/grading/routes.ts backend/test/grading-session-recommendations.test.ts
git commit -m "Add grading session recommendations"
```

## Task 10: Add Platform Grading API Proxies

**Files:**
- Create: `platform/lib/grading/server.ts`
- Create: `platform/app/api/grading/company-state/route.ts`
- Create: `platform/app/api/grading/profiles/[profileId]/draft/route.ts`
- Create: `platform/app/api/grading/profiles/[profileId]/approve/route.ts`
- Create: `platform/app/api/grading/recommendations/[recommendationId]/feedback/route.ts`
- Create: `platform/tests/grading-source.test.mjs`

- [ ] **Step 1: Write platform source tests**

Create `platform/tests/grading-source.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const companyStateRoute = await readFile(new URL("../app/api/grading/company-state/route.ts", import.meta.url), "utf8").catch(() => "");
const draftRoute = await readFile(new URL("../app/api/grading/profiles/[profileId]/draft/route.ts", import.meta.url), "utf8").catch(() => "");
const approveRoute = await readFile(new URL("../app/api/grading/profiles/[profileId]/approve/route.ts", import.meta.url), "utf8").catch(() => "");
const feedbackRoute = await readFile(new URL("../app/api/grading/recommendations/[recommendationId]/feedback/route.ts", import.meta.url), "utf8").catch(() => "");
const serverSource = await readFile(new URL("../lib/grading/server.ts", import.meta.url), "utf8").catch(() => "");

test("grading API proxies derive organization identity server-side", () => {
  for (const source of [companyStateRoute, draftRoute, approveRoute, feedbackRoute]) {
    assert.match(source, /withAuth/);
    assert.match(source, /sessionOrganizationId/);
    assert.doesNotMatch(source, /organizationId:\s*body\.organizationId/);
  }
});

test("grading setup mutations require Ashby onboarding management permission", () => {
  assert.match(draftRoute, /canManageAshbyOnboarding/);
  assert.match(approveRoute, /canManageAshbyOnboarding/);
});

test("grading server helper calls backend grading paths", () => {
  assert.match(serverSource, /\/grading\/company-state/);
  assert.match(serverSource, /\/grading\/profiles\/\$\{encodeURIComponent\(profileId\)\}\/draft/);
  assert.match(serverSource, /\/grading\/profiles\/\$\{encodeURIComponent\(profileId\)\}\/approve/);
});
```

- [ ] **Step 2: Run source tests and verify they fail**

Run:

```bash
cd platform && node --test tests/grading-source.test.mjs
```

Expected: FAIL because grading routes do not exist.

- [ ] **Step 3: Add platform backend helper**

Create `platform/lib/grading/server.ts`:

```ts
import "server-only";

import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

async function postBackend<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${backendBaseUrl()}${path}`, {
    method: "POST",
    headers: backendHeaders(),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : "Backend request failed.";
    throw new Error(error);
  }
  return payload as T;
}

export function getGradingCompanyState(input: { organizationId: string }) {
  return postBackend("/grading/company-state", input);
}

export function draftGradingProfile(profileId: string, input: { organizationId: string; actorEmail: string; jobName?: string }) {
  return postBackend(`/grading/profiles/${encodeURIComponent(profileId)}/draft`, input);
}

export function approveGradingProfile(profileId: string, input: { organizationId: string; actorEmail: string; rubricVersionId: string; rubric: unknown }) {
  return postBackend(`/grading/profiles/${encodeURIComponent(profileId)}/approve`, input);
}

export function submitRecommendationFeedback(recommendationId: string, input: {
  organizationId: string;
  sessionId: string;
  reviewerEmail: string;
  reviewerDecision: string;
  overrideReason: string | null;
  dimensionFeedback: unknown;
}) {
  return postBackend(`/grading/recommendations/${encodeURIComponent(recommendationId)}/feedback`, input);
}
```

- [ ] **Step 4: Add proxy route pattern**

For each route, use this pattern:

```ts
import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { canViewDashboard, sessionOrganizationId } from "@/lib/auth/org-access.mjs";
import { canManageAshbyOnboarding } from "@/lib/auth/ashby-onboarding-admin";
```

`company-state` requires `canViewDashboard`. `draft` and `approve` require `canManageAshbyOnboarding`. `feedback` requires `canViewDashboard`.

Each route must derive:

```ts
const authSession = await withAuth();
const organizationId = sessionOrganizationId(authSession);
const actorEmail = authSession.user?.email;
```

Do not accept `organizationId` or `actorEmail` from the browser body.

- [ ] **Step 5: Run source tests**

Run:

```bash
cd platform && node --test tests/grading-source.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add platform/lib/grading/server.ts platform/app/api/grading platform/tests/grading-source.test.mjs
git commit -m "Add platform grading API proxies"
```

## Task 11: Add Platform Grading Setup UI

**Files:**
- Modify: `platform/app/dashboard/AshbyOnboardingWizard.tsx`
- Modify: `platform/app/dashboard/page.tsx`
- Modify: `platform/app/dashboard/layout.tsx`
- Modify: `platform/tests/ashby-onboarding-source.test.mjs`
- Modify: `platform/tests/grading-source.test.mjs`

- [ ] **Step 1: Add source tests for grading setup UI**

Extend `platform/tests/ashby-onboarding-source.test.mjs` with assertions:

```js
assert.match(wizardSource, /Build hiring bars/);
assert.match(wizardSource, /Approve rubric/);
assert.match(wizardSource, /Recommendations active/);
assert.match(wizardSource, /\/api\/grading\/profiles\/.*\/draft/);
assert.match(wizardSource, /\/api\/grading\/profiles\/.*\/approve/);
```

- [ ] **Step 2: Run source tests and verify they fail**

Run:

```bash
cd platform && node --test tests/ashby-onboarding-source.test.mjs tests/grading-source.test.mjs
```

Expected: FAIL because the wizard does not show grading setup.

- [ ] **Step 3: Pass grading state into dashboard setup**

In the dashboard server component that already loads Ashby state, also call `getGradingCompanyState({ organizationId })` after Ashby state succeeds. Pass the returned profiles into `AshbyOnboardingWizard`.

Use prop shape:

```ts
gradingProfiles?: readonly {
  readonly profile_id: string;
  readonly ashby_job_id: string;
  readonly status: string;
  readonly active_rubric_version_id: string | null;
  readonly draft_rubric_version_id: string | null;
}[];
```

- [ ] **Step 4: Add grading section to `AshbyOnboardingWizard.tsx`**

After the existing sync panel, render a `SectionPanel` block headed `Build hiring bars`.

Required copy:

```text
Build hiring bars
Approve rubric
Recommendations active
```

For each profile:

- show Ashby job ID,
- show status,
- show `Draft rubric` button when status is `draft_needed`,
- show `Approve rubric` button when status is `draft_ready`,
- show `Recommendations active` when status is `recommendations_active`.

Button handlers call:

```ts
await fetch(`/api/grading/profiles/${encodeURIComponent(profile.profile_id)}/draft`, { method: "POST" });
await fetch(`/api/grading/profiles/${encodeURIComponent(profile.profile_id)}/approve`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ rubricVersionId: profile.draft_rubric_version_id, rubric: draftRubric }),
});
```

The V1 UI approves the generated draft returned by the draft endpoint without a full rubric editor. The approval request sends the returned rubric JSON as-is, which makes the setup flow usable before introducing a rubric editing surface.

- [ ] **Step 5: Run platform source tests**

Run:

```bash
cd platform && node --test tests/ashby-onboarding-source.test.mjs tests/grading-source.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Run platform build**

Run:

```bash
pnpm --filter @puddle/platform build
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add platform/app/dashboard/AshbyOnboardingWizard.tsx platform/app/dashboard/page.tsx platform/app/dashboard/layout.tsx platform/tests/ashby-onboarding-source.test.mjs platform/tests/grading-source.test.mjs
git commit -m "Add grading setup to Ashby onboarding"
```

## Task 12: Show Recommendations On Interview Packets

**Files:**
- Modify: `backend/src/dashboard/interviews.ts`
- Modify: `backend/test/dashboard-interviews.test.ts`
- Modify: `platform/app/dashboard/backend-data.ts`
- Modify: `platform/app/dashboard/interviews/[sessionId]/page.tsx`
- Modify: `platform/tests/grading-source.test.mjs`

- [ ] **Step 1: Add dashboard query tests**

Extend `backend/test/dashboard-interviews.test.ts`:

```ts
it("includes interview recommendations in packet detail", () => {
  const stmt = interviewDetailStatement("sess1", "org1");

  expect(stmt.sql).toContain("LEFT JOIN LATERAL");
  expect(stmt.sql).toContain("interview_recommendations");
  expect(stmt.sql).toContain("recommendation");
  expect(stmt.sql).toContain("rubric_version_id");
});
```

- [ ] **Step 2: Run dashboard tests and verify they fail**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/dashboard-interviews.test.ts
```

Expected: FAIL because packet detail does not join recommendations.

- [ ] **Step 3: Add latest recommendation to dashboard read model**

In `backend/src/dashboard/interviews.ts`, add a lateral join to `interviewDetailStatement`:

```sql
LEFT JOIN LATERAL (
  SELECT json_build_object(
    'recommendationId', rec.recommendation_id,
    'recommendation', rec.recommendation,
    'confidence', rec.confidence,
    'rubricVersionId', rec.rubric_version_id,
    'categoryScores', rec.category_scores,
    'evidence', rec.evidence,
    'warnings', rec.warnings,
    'createdAt', rec.created_at
  ) AS item
  FROM interview_recommendations rec
  WHERE rec.session_id = s.session_id
  ORDER BY rec.created_at DESC
  LIMIT 1
) latest_recommendation ON true
```

Add to the selected columns:

```sql
latest_recommendation.item AS recommendation_packet
```

- [ ] **Step 4: Update platform type**

In `platform/app/dashboard/backend-data.ts`, add to `RealInterviewDetail`:

```ts
readonly recommendation_packet: null | {
  readonly recommendationId: string;
  readonly recommendation: "advance" | "hold" | "pass";
  readonly confidence: string | number;
  readonly rubricVersionId: string;
  readonly categoryScores: unknown;
  readonly evidence: unknown;
  readonly warnings: unknown;
  readonly createdAt: string;
};
```

- [ ] **Step 5: Render real recommendation**

In `platform/app/dashboard/interviews/[sessionId]/page.tsx`, in `RealInterviewSessionView`, prefer `realInterview.recommendation_packet?.recommendation` over the derived `meets_bare_minimum` label.

Render a side panel titled `AI recommendation` with:

```text
AI recommendation
Confidence
Rubric version
Reviewer decision
```

Add feedback buttons that post to:

```text
/api/grading/recommendations/{recommendationId}/feedback
```

- [ ] **Step 6: Run tests and build**

Run:

```bash
pnpm --filter @puddle/backend test -- --run test/dashboard-interviews.test.ts
cd platform && node --test tests/grading-source.test.mjs
pnpm --filter @puddle/platform build
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add backend/src/dashboard/interviews.ts backend/test/dashboard-interviews.test.ts platform/app/dashboard/backend-data.ts platform/app/dashboard/interviews/[sessionId]/page.tsx platform/tests/grading-source.test.mjs
git commit -m "Show grading recommendations on interview packets"
```

## Task 13: End-To-End Verification

**Files:**
- Create: `platform/docs/superpowers/verification/2026-06-15-weave-seeded-company-grading.md`

- [ ] **Step 1: Run backend tests**

Run:

```bash
pnpm --filter @puddle/backend test
```

Expected: PASS.

- [ ] **Step 2: Run platform source tests**

Run:

```bash
cd platform && node --test tests/*.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run platform build**

Run:

```bash
pnpm --filter @puddle/platform build
```

Expected: PASS.

- [ ] **Step 4: Run one historical Fireflies dry-run**

Run:

```bash
pnpm --filter @puddle/backend historical-fireflies -- --mode dry-run --org-id org_01KV4FF7KX24B76H7Q57QVB5CT --limit 1
```

Expected output includes:

```text
mode=dry-run
planned_count=1
failed_count=0
```

- [ ] **Step 5: Verify grading API with mocked/local backend data**

Start the backend and platform locally if environment variables are configured:

```bash
pnpm --filter @puddle/backend dev
pnpm --filter @puddle/platform dev
```

Manual browser path:

```text
/dashboard
```

Expected:

- Ashby setup still renders for incomplete companies.
- Selected Ashby jobs show grading profile readiness.
- Draft and approval buttons are visible only for setup admins.
- A real interview packet can display a recommendation when `interview_recommendations` has a row.

- [ ] **Step 6: Write verification note**

Create `platform/docs/superpowers/verification/2026-06-15-weave-seeded-company-grading.md`:

```markdown
# Weave-Seeded Company Grading Verification

## Commands

- `pnpm --filter @puddle/backend test`
- `cd platform && node --test tests/*.test.mjs`
- `pnpm --filter @puddle/platform build`
- `pnpm --filter @puddle/backend historical-fireflies -- --mode dry-run --org-id org_01KV4FF7KX24B76H7Q57QVB5CT --limit 1`

## Result

All automated checks passed.

## Manual Checks

- Dashboard preserves Ashby onboarding behavior.
- Grading setup appears after selected Ashby jobs exist.
- Interview packet renders latest AI recommendation when present.
- Reviewer feedback posts through org-scoped platform proxy.
```

- [ ] **Step 7: Commit verification**

Run:

```bash
git add platform/docs/superpowers/verification/2026-06-15-weave-seeded-company-grading.md
git commit -m "Verify Weave-seeded company grading"
```

## Self-Review Checklist

- Spec coverage:
  - Weave historical import: Task 1.
  - Role grading profiles and rubric versions: Tasks 2, 3, 5, 7.
  - Rubric approval unlocks recommendations: Tasks 7, 9, 11.
  - Historical recommendation backfill: Task 9.
  - New Puddle interview scoring path: Task 9.
  - Reviewer feedback loop: Tasks 7, 10, 12.
  - WorkOS tenant boundary and setup permission: Tasks 10, 11.
  - Interview packet display: Task 12.
- No model fine-tuning is included.
- No automatic hiring action is included.
- No scoring uses protected or disallowed signals.
