# Weave Candidate Evaluation Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Weave candidate evaluation ratings and comments into Puddle RDS, expose them in the candidate/interview dashboards, and add a durable AWS ingestion path for future Supabase events without adding Supabase reads to normal app runtime.

**Architecture:** Supabase pushes insert/update events and backfill events to a generic AWS ingress route. The backend validates the webhook secret, enqueues events to SQS, and a worker upserts Weave evaluations into Puddle RDS through a Weave-specific adapter. Dashboards read imported evaluations from Puddle RDS only.

**Tech Stack:** TypeScript, Fastify, Postgres/RDS, Vitest, Next.js 16, AWS CDK, ECS Fargate, SQS, Supabase SQL `pg_net`.

---

## File Structure

- Create `backend/migrations/019_weave_candidate_evaluation_imports.sql`: provenance table for imported Weave evaluations.
- Modify `backend/test/migrations.test.ts`: migration ordering and provenance-table assertions.
- Create `backend/src/weave/candidate-evaluations/payload.ts`: source event parsing, validation, score normalization, and stable payload hash.
- Create `backend/src/weave/candidate-evaluations/repository.ts`: SQL statements for integration lookup, application upsert, role-profile upsert, score upsert, provenance upsert, imported dashboard read models.
- Create `backend/src/weave/candidate-evaluations/processor.ts`: transaction boundary that applies one validated evaluation event idempotently.
- Create `backend/src/weave/candidate-evaluations/routes.ts`: Fastify ingress route that validates webhook secret and enqueues to SQS.
- Create `backend/src/weave/candidate-evaluations/worker.ts`: SQS worker that processes queued events and deletes only successfully processed messages.
- Create `backend/src/weave/candidate-evaluations/cli.ts`: controlled local processor for dry-run/apply against JSONL event files.
- Create `backend/test/weave-candidate-evaluations-payload.test.ts`: parser/hash/validation tests.
- Create `backend/test/weave-candidate-evaluations-repository.test.ts`: SQL statement tests.
- Create `backend/test/weave-candidate-evaluations-processor.test.ts`: transaction/idempotency tests with fake DB.
- Create `backend/test/weave-candidate-evaluations-routes.test.ts`: webhook auth and enqueue tests.
- Create `backend/test/weave-candidate-evaluations-worker.test.ts`: SQS receive/delete/failure tests.
- Modify `backend/src/server.ts`: register the new ingestion route.
- Modify `backend/package.json`: add worker and CLI scripts.
- Modify `backend/src/ashby/repository.ts`: include latest imported evaluation in active pipeline roles/applications.
- Modify `backend/src/ashby/routes.ts`: map imported evaluation JSON into active pipeline response.
- Modify `backend/test/ashby-repository.test.ts`: source tests for imported-evaluation joins.
- Modify `backend/src/dashboard/interviews.ts`: include imported evaluation JSON on interview detail by source evaluation ID or Ashby application ID.
- Modify `backend/test/dashboard-interviews.test.ts`: source tests for imported evaluation join.
- Modify `platform/lib/ashby/server.ts`: add imported-evaluation types for active pipeline candidates.
- Modify `platform/app/dashboard/roles/ActivePipelineDashboard.tsx`: show compact score/comment signal in candidate rows.
- Modify `platform/app/dashboard/roles/[roleId]/candidates/[candidateId]/page.tsx`: show imported Weave evaluation section.
- Modify `platform/app/dashboard/backend-data.ts`: add imported evaluation type to interview detail.
- Modify `platform/app/dashboard/interviews/[sessionId]/page.tsx`: show imported Weave evaluation section.
- Modify `platform/tests/dashboard-foundation-source.test.mjs`: assert dashboard reads/display Puddle imported evaluation fields and does not import Supabase.
- Modify `infra/lib/infra-stack.ts`: add generic external integration SQS/DLQ, secret, worker task, outputs, grants.
- Modify `infra/test/infra.test.ts`: assert SQS/DLQ/secret/env/worker IAM behavior.
- Create `supabase/weave_candidate_evaluation_hooks.sql`: committed Supabase SQL hook and backfill emitter, not applied automatically.
- Create `docs/runbooks/weave-candidate-evaluation-sync.md`: deployment/backfill/verification runbook with manual gates.

## Manual Gates

Manual approval is required before:

- applying `backend/migrations/019_weave_candidate_evaluation_imports.sql` to production RDS,
- deploying the CDK infrastructure changes,
- writing the AWS webhook secret into Supabase Vault or enabling the Supabase trigger,
- running the full historical production backfill.

Implementation may add files and tests before those gates, but it must not apply production database, AWS, or Supabase changes without explicit approval.

### Task 1: Add Puddle RDS Provenance Migration

**Files:**
- Create: `backend/migrations/019_weave_candidate_evaluation_imports.sql`
- Modify: `backend/test/migrations.test.ts`

- [ ] **Step 1: Write the failing migration test**

Add this test block after the current migration-order tests in `backend/test/migrations.test.ts`:

```ts
  it("adds Weave candidate evaluation import provenance after interviewer AI control migrations", () => {
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
    const aiEndedIndex = files.indexOf("018_interviewer_ai_control_ended_state.sql");
    const weaveImportIndex = files.indexOf("019_weave_candidate_evaluation_imports.sql");

    expect(aiEndedIndex).toBeGreaterThanOrEqual(0);
    expect(weaveImportIndex).toBeGreaterThan(aiEndedIndex);

    const migration = readFileSync(
      join(migrationsDir, "019_weave_candidate_evaluation_imports.sql"),
      "utf-8",
    );
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS weave_candidate_evaluation_imports");
    expect(migration).toContain("source_evaluation_id TEXT PRIMARY KEY");
    expect(migration).toContain("organization_id TEXT NOT NULL");
    expect(migration).toContain("integration_id TEXT NOT NULL");
    expect(migration).toContain("application_id TEXT NOT NULL");
    expect(migration).toContain("score_id TEXT");
    expect(migration).toContain("source_payload_hash TEXT NOT NULL");
    expect(migration).toContain("sync_status TEXT NOT NULL");
    expect(migration).toContain("sync_status IN ('synced', 'failed')");
    expect(migration).toContain("FOREIGN KEY (integration_id, application_id)");
    expect(migration).toContain("REFERENCES ashby_applications(integration_id, application_id)");
    expect(migration).toContain("FOREIGN KEY (score_id)");
    expect(migration).toContain("REFERENCES ashby_candidate_scores(score_id)");
    expect(migration).toContain("weave_candidate_evaluation_imports_org_job_idx");
    expect(migration).toContain("weave_candidate_evaluation_imports_application_idx");
  });
```

- [ ] **Step 2: Run the failing migration test**

Run:

```bash
npm --prefix backend test -- migrations.test.ts
```

Expected: FAIL because `019_weave_candidate_evaluation_imports.sql` does not exist.

- [ ] **Step 3: Add the migration**

Create `backend/migrations/019_weave_candidate_evaluation_imports.sql`:

```sql
-- 019_weave_candidate_evaluation_imports.sql - source lineage for imported Weave candidate evaluations.

CREATE TABLE IF NOT EXISTS weave_candidate_evaluation_imports (
  source_evaluation_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  ashby_candidate_id TEXT,
  ashby_job_id TEXT NOT NULL,
  role_profile_id TEXT,
  score_id TEXT,
  source_created_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  source_payload_hash TEXT NOT NULL,
  last_event_id TEXT,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_status TEXT NOT NULL CHECK (sync_status IN ('synced', 'failed')),
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (integration_id, application_id)
    REFERENCES ashby_applications(integration_id, application_id)
    ON DELETE CASCADE,
  FOREIGN KEY (score_id)
    REFERENCES ashby_candidate_scores(score_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS weave_candidate_evaluation_imports_org_job_idx
  ON weave_candidate_evaluation_imports(organization_id, ashby_job_id, source_updated_at DESC);

CREATE INDEX IF NOT EXISTS weave_candidate_evaluation_imports_application_idx
  ON weave_candidate_evaluation_imports(integration_id, application_id, source_updated_at DESC);

CREATE INDEX IF NOT EXISTS weave_candidate_evaluation_imports_score_idx
  ON weave_candidate_evaluation_imports(score_id)
  WHERE score_id IS NOT NULL;
```

- [ ] **Step 4: Run the migration test**

Run:

```bash
npm --prefix backend test -- migrations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/019_weave_candidate_evaluation_imports.sql backend/test/migrations.test.ts
git commit -m "Add Weave evaluation import provenance migration"
```

### Task 2: Parse And Validate Weave Evaluation Events

**Files:**
- Create: `backend/src/weave/candidate-evaluations/payload.ts`
- Create: `backend/test/weave-candidate-evaluations-payload.test.ts`

- [ ] **Step 1: Write failing payload tests**

Create `backend/test/weave-candidate-evaluations-payload.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  stableWeaveEvaluationPayloadHash,
  validateWeaveCandidateEvaluationEvent,
  weaveReviewerEmail,
} from "../src/weave/candidate-evaluations/payload.js";

const row = {
  id: "71108f3c-43a9-4832-ae9e-3c6e6e712d08",
  candidate_name: "Maya Chen",
  interview_date: "2026-06-30",
  problem_solving: 3.5,
  agency: 4,
  competitiveness: "2.5",
  curious: 3,
  sum: 13,
  comments: "Strong product instincts.",
  ashby_application_id: "app_123",
  ashby_candidate_id: "cand_123",
  ashby_job_id: "job_123",
  created_at: "2026-06-30T12:00:00.000Z",
  updated_at: "2026-07-01T00:33:54.000Z",
};

describe("Weave candidate evaluation payloads", () => {
  it("validates Supabase webhook events and normalizes scores", () => {
    const result = validateWeaveCandidateEvaluationEvent({
      eventId: "evt_1",
      source: "weave_supabase_candidate_evaluation",
      operation: "UPDATE",
      record: row,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.evaluation).toMatchObject({
      sourceEvaluationId: row.id,
      candidateName: "Maya Chen",
      problemSolving: 3.5,
      agency: 4,
      competitiveness: 2.5,
      curiosity: 3,
      totalScore: 13,
      comments: "Strong product instincts.",
      ashbyApplicationId: "app_123",
      ashbyCandidateId: "cand_123",
      ashbyJobId: "job_123",
    });
  });

  it("rejects missing Ashby identifiers", () => {
    const result = validateWeaveCandidateEvaluationEvent({
      eventId: "evt_1",
      source: "weave_supabase_candidate_evaluation",
      operation: "INSERT",
      record: { ...row, ashby_application_id: "" },
    });

    expect(result).toEqual({
      ok: false,
      reason: "ashby_application_id is required",
    });
  });

  it("rejects scores outside the target candidate score range", () => {
    const result = validateWeaveCandidateEvaluationEvent({
      eventId: "evt_1",
      source: "weave_supabase_candidate_evaluation",
      operation: "UPDATE",
      record: { ...row, agency: 4.2 },
    });

    expect(result).toEqual({
      ok: false,
      reason: "agency must be a score from 0 to 4 in 0.5 increments",
    });
  });

  it("uses a stable reviewer identity per source evaluation", () => {
    expect(weaveReviewerEmail(row.id)).toBe(
      "weave-import+71108f3c43a94832ae9e3c6e6e712d08@puddle.system",
    );
  });

  it("hashes equivalent payloads deterministically", () => {
    expect(stableWeaveEvaluationPayloadHash({ b: 2, a: 1 })).toBe(
      stableWeaveEvaluationPayloadHash({ a: 1, b: 2 }),
    );
  });
});
```

- [ ] **Step 2: Run the failing payload test**

Run:

```bash
npm --prefix backend test -- weave-candidate-evaluations-payload.test.ts
```

Expected: FAIL because `payload.ts` does not exist.

- [ ] **Step 3: Add payload parsing code**

Create `backend/src/weave/candidate-evaluations/payload.ts`:

```ts
import { createHash } from "node:crypto";

export type WeaveCandidateEvaluationOperation = "INSERT" | "UPDATE";

export interface WeaveCandidateEvaluation {
  readonly sourceEvaluationId: string;
  readonly candidateName: string;
  readonly interviewDate: string | null;
  readonly problemSolving: number;
  readonly agency: number;
  readonly competitiveness: number;
  readonly curiosity: number;
  readonly totalScore: number;
  readonly comments: string;
  readonly ashbyApplicationId: string;
  readonly ashbyCandidateId: string;
  readonly ashbyJobId: string;
  readonly sourceCreatedAt: string | null;
  readonly sourceUpdatedAt: string | null;
  readonly rawRecord: Record<string, unknown>;
}

export interface WeaveCandidateEvaluationEvent {
  readonly eventId: string;
  readonly source: "weave_supabase_candidate_evaluation";
  readonly operation: WeaveCandidateEvaluationOperation;
  readonly evaluation: WeaveCandidateEvaluation;
}

export type WeaveCandidateEvaluationValidation =
  | { readonly ok: true; readonly event: WeaveCandidateEvaluationEvent }
  | { readonly ok: false; readonly reason: string };

export function validateWeaveCandidateEvaluationEvent(
  value: unknown,
): WeaveCandidateEvaluationValidation {
  const event = recordValue(value);
  if (!event) return invalid("event must be an object");
  if (stringValue(event.source) !== "weave_supabase_candidate_evaluation") {
    return invalid("source must be weave_supabase_candidate_evaluation");
  }

  const eventId = stringValue(event.eventId ?? event.event_id) ?? "";
  if (!eventId) return invalid("eventId is required");

  const operation = stringValue(event.operation);
  if (operation !== "INSERT" && operation !== "UPDATE") {
    return invalid("operation must be INSERT or UPDATE");
  }

  const record = recordValue(event.record);
  if (!record) return invalid("record must be an object");

  const sourceEvaluationId = requiredString(record.id, "id");
  if (!sourceEvaluationId.ok) return sourceEvaluationId;
  const candidateName = requiredString(record.candidate_name, "candidate_name");
  if (!candidateName.ok) return candidateName;
  const ashbyApplicationId = requiredString(record.ashby_application_id, "ashby_application_id");
  if (!ashbyApplicationId.ok) return ashbyApplicationId;
  const ashbyCandidateId = requiredString(record.ashby_candidate_id, "ashby_candidate_id");
  if (!ashbyCandidateId.ok) return ashbyCandidateId;
  const ashbyJobId = requiredString(record.ashby_job_id, "ashby_job_id");
  if (!ashbyJobId.ok) return ashbyJobId;

  const problemSolving = scoreValue(record.problem_solving, "problem_solving");
  if (!problemSolving.ok) return problemSolving;
  const agency = scoreValue(record.agency, "agency");
  if (!agency.ok) return agency;
  const competitiveness = scoreValue(record.competitiveness, "competitiveness");
  if (!competitiveness.ok) return competitiveness;
  const curiosity = scoreValue(record.curious, "curious");
  if (!curiosity.ok) return curiosity;

  const totalScore =
    problemSolving.value + agency.value + competitiveness.value + curiosity.value;

  return {
    ok: true,
    event: {
      eventId,
      source: "weave_supabase_candidate_evaluation",
      operation,
      evaluation: {
        sourceEvaluationId: sourceEvaluationId.value,
        candidateName: candidateName.value,
        interviewDate: stringValue(record.interview_date),
        problemSolving: problemSolving.value,
        agency: agency.value,
        competitiveness: competitiveness.value,
        curiosity: curiosity.value,
        totalScore,
        comments: stringValue(record.comments) ?? "",
        ashbyApplicationId: ashbyApplicationId.value,
        ashbyCandidateId: ashbyCandidateId.value,
        ashbyJobId: ashbyJobId.value,
        sourceCreatedAt: stringValue(record.created_at),
        sourceUpdatedAt: stringValue(record.updated_at),
        rawRecord: record,
      },
    },
  };
}

export function weaveReviewerEmail(sourceEvaluationId: string): string {
  return `weave-import+${sourceEvaluationId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}@puddle.system`;
}

export function stableWeaveEvaluationPayloadHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredString(
  value: unknown,
  label: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string } {
  const text = stringValue(value);
  return text ? { ok: true, value: text } : invalid(`${label} is required`);
}

function scoreValue(
  value: unknown,
  label: string,
): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly reason: string } {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < 0 || number > 4 || !Number.isInteger(number * 2)) {
    return invalid(`${label} must be a score from 0 to 4 in 0.5 increments`);
  }
  return { ok: true, value: number };
}

function invalid(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}
```

- [ ] **Step 4: Run the payload test**

Run:

```bash
npm --prefix backend test -- weave-candidate-evaluations-payload.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/weave/candidate-evaluations/payload.ts backend/test/weave-candidate-evaluations-payload.test.ts
git commit -m "Add Weave evaluation payload validation"
```

### Task 3: Add Repository Statements And Processor

**Files:**
- Create: `backend/src/weave/candidate-evaluations/repository.ts`
- Create: `backend/src/weave/candidate-evaluations/processor.ts`
- Create: `backend/test/weave-candidate-evaluations-repository.test.ts`
- Create: `backend/test/weave-candidate-evaluations-processor.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `backend/test/weave-candidate-evaluations-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  importedApplicationUpsertStatement,
  importedEvaluationForApplicationStatement,
  importedEvaluationForSessionStatement,
  importedScoreUpsertStatement,
  provenanceUpsertStatement,
  weaveIntegrationForOrganizationStatement,
  weaveRoleProfileUpsertStatement,
} from "../src/weave/candidate-evaluations/repository.js";

describe("Weave candidate evaluation repository statements", () => {
  it("looks up the org-scoped Ashby integration", () => {
    const stmt = weaveIntegrationForOrganizationStatement("org_1");
    expect(stmt.sql).toContain("FROM ashby_company_integrations");
    expect(stmt.sql).toContain("WHERE organization_id = $1");
    expect(stmt.params).toEqual(["org_1"]);
  });

  it("upserts imported applications without pretending they are active Ashby rows", () => {
    const stmt = importedApplicationUpsertStatement({
      integrationId: "int_1",
      applicationId: "app_1",
      candidateId: "cand_1",
      candidateName: "Maya Chen",
      jobId: "job_1",
      sourceUpdatedAt: "2026-07-01T00:00:00.000Z",
      rawPayload: { id: "eval_1" },
    });

    expect(stmt.sql).toContain("INSERT INTO ashby_applications");
    expect(stmt.sql).toContain("ON CONFLICT (integration_id, application_id)");
    expect(stmt.sql).toContain("status = CASE WHEN ashby_applications.status = 'Active'");
    expect(stmt.params).toEqual([
      "app_1",
      "int_1",
      "cand_1",
      "Maya Chen",
      null,
      "job_1",
      "Weave evaluation",
      "Weave Supabase",
      "ImportedEvaluation",
      "2026-07-01T00:00:00.000Z",
      JSON.stringify({ id: "eval_1" }),
    ]);
  });

  it("upserts role profiles for missing imported jobs", () => {
    const stmt = weaveRoleProfileUpsertStatement({
      profileId: "role_1",
      organizationId: "org_1",
      integrationId: "int_1",
      ashbyJobId: "job_1",
      actorEmail: "weave-import@puddle.system",
    });

    expect(stmt.sql).toContain("INSERT INTO role_grading_profiles");
    expect(stmt.sql).toContain("ON CONFLICT (organization_id, ashby_job_id)");
    expect(stmt.params).toEqual([
      "role_1",
      "org_1",
      "int_1",
      "job_1",
      "draft_needed",
      "weave-import@puddle.system",
      "weave-import@puddle.system",
    ]);
  });

  it("upserts one candidate score per source evaluation", () => {
    const stmt = importedScoreUpsertStatement({
      scoreId: "score_eval_1",
      integrationId: "int_1",
      applicationId: "app_1",
      roleId: "job_1",
      reviewerEmail: "weave-import+eval1@puddle.system",
      problemSolving: 3,
      agency: 4,
      competitiveness: 2.5,
      curiosity: 3.5,
      comments: "Good signal.",
    });

    expect(stmt.sql).toContain("INSERT INTO ashby_candidate_scores");
    expect(stmt.sql).toContain("ON CONFLICT (integration_id, application_id, reviewer_email)");
    expect(stmt.sql).toContain("RETURNING score_id, total_score");
    expect(stmt.params).toEqual([
      "score_eval_1",
      "int_1",
      "app_1",
      "job_1",
      "weave-import+eval1@puddle.system",
      3,
      4,
      2.5,
      3.5,
      13,
      "Good signal.",
    ]);
  });

  it("upserts provenance rows idempotently", () => {
    const stmt = provenanceUpsertStatement({
      sourceEvaluationId: "eval_1",
      organizationId: "org_1",
      integrationId: "int_1",
      applicationId: "app_1",
      ashbyCandidateId: "cand_1",
      ashbyJobId: "job_1",
      roleProfileId: "role_1",
      scoreId: "score_1",
      sourceCreatedAt: "2026-06-30T12:00:00.000Z",
      sourceUpdatedAt: "2026-07-01T00:00:00.000Z",
      sourcePayloadHash: "hash_1",
      lastEventId: "evt_1",
      syncStatus: "synced",
      syncError: null,
    });

    expect(stmt.sql).toContain("INSERT INTO weave_candidate_evaluation_imports");
    expect(stmt.sql).toContain("ON CONFLICT (source_evaluation_id) DO UPDATE SET");
    expect(stmt.sql).toContain("WHERE weave_candidate_evaluation_imports.source_updated_at IS NULL");
  });

  it("builds dashboard read model statements for applications and sessions", () => {
    expect(importedEvaluationForApplicationStatement("int_1", "app_1").sql).toContain(
      "FROM weave_candidate_evaluation_imports imp",
    );
    expect(importedEvaluationForSessionStatement("sess_1", "org_1").sql).toContain(
      "candidateEvaluationId",
    );
  });
});
```

- [ ] **Step 2: Write failing processor tests**

Create `backend/test/weave-candidate-evaluations-processor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { processWeaveCandidateEvaluationEvent } from "../src/weave/candidate-evaluations/processor.js";
import type { WeaveCandidateEvaluationEvent } from "../src/weave/candidate-evaluations/payload.js";

const event: WeaveCandidateEvaluationEvent = {
  eventId: "evt_1",
  source: "weave_supabase_candidate_evaluation",
  operation: "UPDATE",
  evaluation: {
    sourceEvaluationId: "eval_1",
    candidateName: "Maya Chen",
    interviewDate: "2026-06-30",
    problemSolving: 3,
    agency: 4,
    competitiveness: 2.5,
    curiosity: 3.5,
    totalScore: 13,
    comments: "Good signal.",
    ashbyApplicationId: "app_1",
    ashbyCandidateId: "cand_1",
    ashbyJobId: "job_1",
    sourceCreatedAt: "2026-06-30T12:00:00.000Z",
    sourceUpdatedAt: "2026-07-01T00:00:00.000Z",
    rawRecord: { id: "eval_1" },
  },
};

class FakeClient {
  readonly calls: readonly [string, readonly unknown[]][] = [];
  private readonly mutableCalls: [string, readonly unknown[]][] = [];

  async query(sql: string, params: readonly unknown[] = []) {
    this.mutableCalls.push([sql, params]);
    (this as { calls: readonly [string, readonly unknown[]][] }).calls = this.mutableCalls;
    if (sql.includes("FROM ashby_company_integrations")) {
      return { rows: [{ integration_id: "int_1" }] };
    }
    if (sql.includes("INSERT INTO role_grading_profiles")) {
      return { rows: [{ profile_id: "role_1" }] };
    }
    if (sql.includes("INSERT INTO ashby_candidate_scores")) {
      return { rows: [{ score_id: "score_1", total_score: 13 }] };
    }
    return { rows: [] };
  }

  release(): void {}
}

class FakePool {
  readonly client = new FakeClient();
  async connect() {
    return this.client;
  }
}

describe("Weave candidate evaluation processor", () => {
  it("applies one event inside a transaction and records provenance", async () => {
    const pool = new FakePool();
    const result = await processWeaveCandidateEvaluationEvent({
      pool,
      organizationId: "org_1",
      event,
    });

    expect(result).toEqual({
      status: "synced",
      sourceEvaluationId: "eval_1",
      applicationId: "app_1",
      scoreId: "score_1",
    });
    expect(pool.client.calls.map(([sql]) => sql)).toEqual(
      expect.arrayContaining(["BEGIN", "COMMIT"]),
    );
    expect(pool.client.calls.some(([sql]) => sql.includes("ROLLBACK"))).toBe(false);
    expect(pool.client.calls.some(([sql]) => sql.includes("INSERT INTO weave_candidate_evaluation_imports"))).toBe(true);
  });

  it("rolls back when the org integration is missing", async () => {
    class MissingIntegrationClient extends FakeClient {
      async query(sql: string, params: readonly unknown[] = []) {
        if (sql.includes("FROM ashby_company_integrations")) {
          return { rows: [] };
        }
        return super.query(sql, params);
      }
    }
    const client = new MissingIntegrationClient();
    const pool = { connect: async () => client };

    await expect(
      processWeaveCandidateEvaluationEvent({ pool, organizationId: "org_1", event }),
    ).rejects.toThrow("No Ashby integration found for organization org_1");

    expect(client.calls.map(([sql]) => sql)).toEqual(
      expect.arrayContaining(["BEGIN", "ROLLBACK"]),
    );
  });
});
```

- [ ] **Step 3: Run failing repository and processor tests**

Run:

```bash
npm --prefix backend test -- weave-candidate-evaluations-repository.test.ts weave-candidate-evaluations-processor.test.ts
```

Expected: FAIL because repository and processor modules do not exist.

- [ ] **Step 4: Add repository code**

Create `backend/src/weave/candidate-evaluations/repository.ts` with exported SQL builders named in the tests. Use `jsonParam(value: unknown): string` and deterministic IDs:

```ts
import { createHash, randomUUID } from "node:crypto";
import type { SqlStatement } from "../../consent/repository.js";

export const WEAVE_IMPORT_ACTOR_EMAIL = "weave-import@puddle.system";

export function stableTargetId(prefix: string, sourceId: string): string {
  return `${prefix}_${createHash("sha256").update(sourceId).digest("hex").slice(0, 32)}`;
}

export function weaveIntegrationForOrganizationStatement(organizationId: string): SqlStatement {
  return {
    sql:
      "SELECT integration_id FROM ashby_company_integrations " +
      "WHERE organization_id = $1 LIMIT 1 FOR UPDATE",
    params: [organizationId],
  };
}

export function importedApplicationUpsertStatement(input: {
  readonly integrationId: string;
  readonly applicationId: string;
  readonly candidateId: string;
  readonly candidateName: string;
  readonly jobId: string;
  readonly sourceUpdatedAt: string | null;
  readonly rawPayload: unknown;
}): SqlStatement {
  return {
    sql:
      "INSERT INTO ashby_applications " +
      "(application_id, integration_id, candidate_id, candidate_name, candidate_email, job_id, current_stage, source, status, ashby_updated_at, raw_payload) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::jsonb) " +
      "ON CONFLICT (integration_id, application_id) DO UPDATE SET " +
      "candidate_id = COALESCE(NULLIF(ashby_applications.candidate_id, ''), EXCLUDED.candidate_id), " +
      "candidate_name = COALESCE(NULLIF(ashby_applications.candidate_name, ''), EXCLUDED.candidate_name), " +
      "job_id = EXCLUDED.job_id, " +
      "current_stage = COALESCE(ashby_applications.current_stage, EXCLUDED.current_stage), " +
      "source = COALESCE(ashby_applications.source, EXCLUDED.source), " +
      "status = CASE WHEN ashby_applications.status = 'Active' THEN ashby_applications.status ELSE EXCLUDED.status END, " +
      "ashby_updated_at = GREATEST(COALESCE(ashby_applications.ashby_updated_at, EXCLUDED.ashby_updated_at), EXCLUDED.ashby_updated_at), " +
      "raw_payload = ashby_applications.raw_payload || jsonb_build_object('weaveCandidateEvaluation', EXCLUDED.raw_payload), " +
      "updated_at = now()",
    params: [
      input.applicationId,
      input.integrationId,
      input.candidateId,
      input.candidateName,
      null,
      input.jobId,
      "Weave evaluation",
      "Weave Supabase",
      "ImportedEvaluation",
      input.sourceUpdatedAt,
      jsonParam(input.rawPayload),
    ],
  };
}

export function weaveRoleProfileUpsertStatement(input: {
  readonly profileId?: string;
  readonly organizationId: string;
  readonly integrationId: string;
  readonly ashbyJobId: string;
  readonly actorEmail?: string;
}): SqlStatement {
  const actorEmail = input.actorEmail ?? WEAVE_IMPORT_ACTOR_EMAIL;
  return {
    sql:
      "INSERT INTO role_grading_profiles " +
      "(profile_id, organization_id, ashby_integration_id, ashby_job_id, status, created_by_email, updated_by_email) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7) " +
      "ON CONFLICT (organization_id, ashby_job_id) DO UPDATE SET " +
      "ashby_integration_id = EXCLUDED.ashby_integration_id, " +
      "updated_by_email = EXCLUDED.updated_by_email, updated_at = now() " +
      "RETURNING profile_id",
    params: [
      input.profileId ?? stableTargetId("role", `${input.organizationId}:${input.ashbyJobId}`),
      input.organizationId,
      input.integrationId,
      input.ashbyJobId,
      "draft_needed",
      actorEmail,
      actorEmail,
    ],
  };
}

export function importedScoreUpsertStatement(input: {
  readonly scoreId?: string;
  readonly integrationId: string;
  readonly applicationId: string;
  readonly roleId: string;
  readonly reviewerEmail: string;
  readonly problemSolving: number;
  readonly agency: number;
  readonly competitiveness: number;
  readonly curiosity: number;
  readonly comments: string;
}): SqlStatement {
  const totalScore =
    input.problemSolving + input.agency + input.competitiveness + input.curiosity;
  return {
    sql:
      "INSERT INTO ashby_candidate_scores " +
      "(score_id, integration_id, application_id, role_id, reviewer_email, problem_solving, agency, competitiveness, curiosity, total_score, comments) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) " +
      "ON CONFLICT (integration_id, application_id, reviewer_email) DO UPDATE SET " +
      "role_id = EXCLUDED.role_id, problem_solving = EXCLUDED.problem_solving, agency = EXCLUDED.agency, " +
      "competitiveness = EXCLUDED.competitiveness, curiosity = EXCLUDED.curiosity, total_score = EXCLUDED.total_score, " +
      "comments = EXCLUDED.comments, updated_at = now() RETURNING score_id, total_score",
    params: [
      input.scoreId ?? randomUUID(),
      input.integrationId,
      input.applicationId,
      input.roleId,
      input.reviewerEmail,
      input.problemSolving,
      input.agency,
      input.competitiveness,
      input.curiosity,
      totalScore,
      input.comments,
    ],
  };
}

export function provenanceUpsertStatement(input: {
  readonly sourceEvaluationId: string;
  readonly organizationId: string;
  readonly integrationId: string;
  readonly applicationId: string;
  readonly ashbyCandidateId: string;
  readonly ashbyJobId: string;
  readonly roleProfileId: string | null;
  readonly scoreId: string | null;
  readonly sourceCreatedAt: string | null;
  readonly sourceUpdatedAt: string | null;
  readonly sourcePayloadHash: string;
  readonly lastEventId: string;
  readonly syncStatus: "synced" | "failed";
  readonly syncError: string | null;
}): SqlStatement {
  return {
    sql:
      "INSERT INTO weave_candidate_evaluation_imports " +
      "(source_evaluation_id, organization_id, integration_id, application_id, ashby_candidate_id, ashby_job_id, role_profile_id, score_id, source_created_at, source_updated_at, source_payload_hash, last_event_id, sync_status, sync_error) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11, $12, $13, $14) " +
      "ON CONFLICT (source_evaluation_id) DO UPDATE SET " +
      "organization_id = EXCLUDED.organization_id, integration_id = EXCLUDED.integration_id, application_id = EXCLUDED.application_id, " +
      "ashby_candidate_id = EXCLUDED.ashby_candidate_id, ashby_job_id = EXCLUDED.ashby_job_id, role_profile_id = EXCLUDED.role_profile_id, " +
      "score_id = EXCLUDED.score_id, source_created_at = EXCLUDED.source_created_at, source_updated_at = EXCLUDED.source_updated_at, " +
      "source_payload_hash = EXCLUDED.source_payload_hash, last_event_id = EXCLUDED.last_event_id, " +
      "last_synced_at = now(), sync_status = EXCLUDED.sync_status, sync_error = EXCLUDED.sync_error, updated_at = now() " +
      "WHERE weave_candidate_evaluation_imports.source_updated_at IS NULL " +
      "OR EXCLUDED.source_updated_at IS NULL " +
      "OR EXCLUDED.source_updated_at >= weave_candidate_evaluation_imports.source_updated_at",
    params: [
      input.sourceEvaluationId,
      input.organizationId,
      input.integrationId,
      input.applicationId,
      input.ashbyCandidateId,
      input.ashbyJobId,
      input.roleProfileId,
      input.scoreId,
      input.sourceCreatedAt,
      input.sourceUpdatedAt,
      input.sourcePayloadHash,
      input.lastEventId,
      input.syncStatus,
      input.syncError,
    ],
  };
}

export function importedEvaluationForApplicationStatement(
  integrationId: string,
  applicationId: string,
): SqlStatement {
  return {
    sql:
      "SELECT imp.source_evaluation_id, imp.source_updated_at, sc.problem_solving, sc.agency, sc.competitiveness, sc.curiosity, sc.total_score, sc.comments " +
      "FROM weave_candidate_evaluation_imports imp " +
      "JOIN ashby_candidate_scores sc ON sc.score_id = imp.score_id " +
      "WHERE imp.integration_id = $1 AND imp.application_id = $2 " +
      "ORDER BY imp.source_updated_at DESC NULLS LAST, imp.last_synced_at DESC LIMIT 1",
    params: [integrationId, applicationId],
  };
}

export function importedEvaluationForSessionStatement(sessionId: string, orgId: string): SqlStatement {
  return {
    sql:
      "SELECT imp.source_evaluation_id, imp.source_updated_at, sc.problem_solving, sc.agency, sc.competitiveness, sc.curiosity, sc.total_score, sc.comments " +
      "FROM sessions s " +
      "JOIN ashby_company_integrations integration ON integration.organization_id = s.org_id " +
      "JOIN weave_candidate_evaluation_imports imp ON imp.organization_id = s.org_id " +
      "AND (imp.source_evaluation_id = NULLIF(s.source_metadata #>> '{ashby,selected,candidateEvaluationId}', '') " +
      "OR imp.application_id = NULLIF(s.source_metadata #>> '{ashby,selected,applicationId}', '')) " +
      "JOIN ashby_candidate_scores sc ON sc.score_id = imp.score_id " +
      "WHERE s.session_id = $1 AND s.org_id = $2 " +
      "ORDER BY CASE WHEN imp.source_evaluation_id = NULLIF(s.source_metadata #>> '{ashby,selected,candidateEvaluationId}', '') THEN 0 ELSE 1 END, " +
      "imp.source_updated_at DESC NULLS LAST LIMIT 1",
    params: [sessionId, orgId],
  };
}

function jsonParam(value: unknown): string {
  return JSON.stringify(value ?? null);
}
```

- [ ] **Step 5: Add processor code**

Create `backend/src/weave/candidate-evaluations/processor.ts`:

```ts
import type { Pool, PoolClient } from "pg";
import {
  stableWeaveEvaluationPayloadHash,
  weaveReviewerEmail,
  type WeaveCandidateEvaluationEvent,
} from "./payload.js";
import {
  importedApplicationUpsertStatement,
  importedScoreUpsertStatement,
  provenanceUpsertStatement,
  stableTargetId,
  weaveIntegrationForOrganizationStatement,
  weaveRoleProfileUpsertStatement,
} from "./repository.js";

export interface ProcessWeaveCandidateEvaluationInput {
  readonly pool: Pick<Pool, "connect">;
  readonly organizationId: string;
  readonly event: WeaveCandidateEvaluationEvent;
}

export interface ProcessWeaveCandidateEvaluationResult {
  readonly status: "synced";
  readonly sourceEvaluationId: string;
  readonly applicationId: string;
  readonly scoreId: string;
}

type QueryClient = Pick<PoolClient, "query" | "release">;

export async function processWeaveCandidateEvaluationEvent(
  input: ProcessWeaveCandidateEvaluationInput,
): Promise<ProcessWeaveCandidateEvaluationResult> {
  const client = (await input.pool.connect()) as QueryClient;
  let committed = false;
  const evaluation = input.event.evaluation;
  try {
    await client.query("BEGIN");

    const integrationStmt = weaveIntegrationForOrganizationStatement(input.organizationId);
    const integrationResult = await client.query(integrationStmt.sql, [...integrationStmt.params]);
    const integrationId = stringValue(integrationResult.rows[0]?.integration_id);
    if (!integrationId) {
      throw new Error(`No Ashby integration found for organization ${input.organizationId}`);
    }

    const applicationStmt = importedApplicationUpsertStatement({
      integrationId,
      applicationId: evaluation.ashbyApplicationId,
      candidateId: evaluation.ashbyCandidateId,
      candidateName: evaluation.candidateName,
      jobId: evaluation.ashbyJobId,
      sourceUpdatedAt: evaluation.sourceUpdatedAt,
      rawPayload: evaluation.rawRecord,
    });
    await client.query(applicationStmt.sql, [...applicationStmt.params]);

    const roleStmt = weaveRoleProfileUpsertStatement({
      organizationId: input.organizationId,
      integrationId,
      ashbyJobId: evaluation.ashbyJobId,
    });
    const roleResult = await client.query(roleStmt.sql, [...roleStmt.params]);
    const roleProfileId = stringValue(roleResult.rows[0]?.profile_id);

    const scoreId = stableTargetId("score", evaluation.sourceEvaluationId);
    const scoreStmt = importedScoreUpsertStatement({
      scoreId,
      integrationId,
      applicationId: evaluation.ashbyApplicationId,
      roleId: evaluation.ashbyJobId,
      reviewerEmail: weaveReviewerEmail(evaluation.sourceEvaluationId),
      problemSolving: evaluation.problemSolving,
      agency: evaluation.agency,
      competitiveness: evaluation.competitiveness,
      curiosity: evaluation.curiosity,
      comments: evaluation.comments,
    });
    const scoreResult = await client.query(scoreStmt.sql, [...scoreStmt.params]);
    const returnedScoreId = stringValue(scoreResult.rows[0]?.score_id) ?? scoreId;

    const provenanceStmt = provenanceUpsertStatement({
      sourceEvaluationId: evaluation.sourceEvaluationId,
      organizationId: input.organizationId,
      integrationId,
      applicationId: evaluation.ashbyApplicationId,
      ashbyCandidateId: evaluation.ashbyCandidateId,
      ashbyJobId: evaluation.ashbyJobId,
      roleProfileId,
      scoreId: returnedScoreId,
      sourceCreatedAt: evaluation.sourceCreatedAt,
      sourceUpdatedAt: evaluation.sourceUpdatedAt,
      sourcePayloadHash: stableWeaveEvaluationPayloadHash(evaluation.rawRecord),
      lastEventId: input.event.eventId,
      syncStatus: "synced",
      syncError: null,
    });
    await client.query(provenanceStmt.sql, [...provenanceStmt.params]);

    await client.query("COMMIT");
    committed = true;
    return {
      status: "synced",
      sourceEvaluationId: evaluation.sourceEvaluationId,
      applicationId: evaluation.ashbyApplicationId,
      scoreId: returnedScoreId,
    };
  } catch (error) {
    if (!committed) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
```

- [ ] **Step 6: Run repository and processor tests**

Run:

```bash
npm --prefix backend test -- weave-candidate-evaluations-repository.test.ts weave-candidate-evaluations-processor.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/weave/candidate-evaluations/repository.ts backend/src/weave/candidate-evaluations/processor.ts backend/test/weave-candidate-evaluations-repository.test.ts backend/test/weave-candidate-evaluations-processor.test.ts
git commit -m "Add Weave evaluation import processor"
```

### Task 4: Add Webhook Ingress Route And SQS Worker

**Files:**
- Create: `backend/src/weave/candidate-evaluations/routes.ts`
- Create: `backend/src/weave/candidate-evaluations/worker.ts`
- Create: `backend/test/weave-candidate-evaluations-routes.test.ts`
- Create: `backend/test/weave-candidate-evaluations-worker.test.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Write failing route test**

Create `backend/test/weave-candidate-evaluations-routes.test.ts` with tests for:

```ts
import Fastify from "fastify";
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { describe, expect, it } from "vitest";
import { registerWeaveCandidateEvaluationRoutes } from "../src/weave/candidate-evaluations/routes.js";

describe("Weave candidate evaluation ingress route", () => {
  it("rejects requests without the configured secret", async () => {
    const app = Fastify();
    registerWeaveCandidateEvaluationRoutes(app, {
      env: {
        WEAVE_CANDIDATE_EVALUATION_WEBHOOK_SECRET: "secret",
        WEAVE_CANDIDATE_EVALUATION_QUEUE_URL: "https://sqs.example/queue",
        WEAVE_CANDIDATE_EVALUATION_ORG_ID: "org_1",
      },
      sqs: { send: async () => ({}) },
    });

    const response = await app.inject({
      method: "POST",
      url: "/integrations/external/weave/candidate-evaluations",
      payload: { record: {} },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid webhook secret" });
  });

  it("validates and enqueues candidate evaluation events", async () => {
    const commands: unknown[] = [];
    const app = Fastify();
    registerWeaveCandidateEvaluationRoutes(app, {
      env: {
        WEAVE_CANDIDATE_EVALUATION_WEBHOOK_SECRET: "secret",
        WEAVE_CANDIDATE_EVALUATION_QUEUE_URL: "https://sqs.example/queue",
        WEAVE_CANDIDATE_EVALUATION_ORG_ID: "org_1",
      },
      sqs: {
        send: async (command) => {
          commands.push(command);
          return { MessageId: "msg_1" };
        },
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/integrations/external/weave/candidate-evaluations",
      headers: { "x-puddle-webhook-secret": "secret" },
      payload: {
        eventId: "evt_1",
        source: "weave_supabase_candidate_evaluation",
        operation: "INSERT",
        record: {
          id: "eval_1",
          candidate_name: "Maya Chen",
          problem_solving: 3,
          agency: 4,
          competitiveness: 2,
          curious: 3,
          comments: "Good.",
          ashby_application_id: "app_1",
          ashby_candidate_id: "cand_1",
          ashby_job_id: "job_1",
          created_at: "2026-06-30T00:00:00.000Z",
          updated_at: "2026-07-01T00:00:00.000Z",
        },
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "queued", messageId: "msg_1" });
    expect(commands[0]).toBeInstanceOf(SendMessageCommand);
    expect((commands[0] as SendMessageCommand).input.QueueUrl).toBe("https://sqs.example/queue");
    expect(JSON.parse(String((commands[0] as SendMessageCommand).input.MessageBody))).toMatchObject({
      organizationId: "org_1",
      event: { eventId: "evt_1" },
    });
  });
});
```

- [ ] **Step 2: Write failing worker test**

Create `backend/test/weave-candidate-evaluations-worker.test.ts` with tests that inject fake SQS and fake processor:

```ts
import { DeleteMessageCommand, ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import { describe, expect, it } from "vitest";
import {
  processWeaveCandidateEvaluationMessage,
  runWeaveCandidateEvaluationWorker,
} from "../src/weave/candidate-evaluations/worker.js";

describe("Weave candidate evaluation worker", () => {
  it("processes valid messages and deletes them", async () => {
    const commands: unknown[] = [];
    const sqs = { send: async (command: unknown) => { commands.push(command); return {}; } };
    const processed: unknown[] = [];

    await processWeaveCandidateEvaluationMessage({
      sqs,
      queueUrl: "https://sqs.example/queue",
      message: {
        body: JSON.stringify({
          organizationId: "org_1",
          event: {
            eventId: "evt_1",
            source: "weave_supabase_candidate_evaluation",
            operation: "UPDATE",
            evaluation: {
              sourceEvaluationId: "eval_1",
              candidateName: "Maya Chen",
              interviewDate: null,
              problemSolving: 3,
              agency: 4,
              competitiveness: 2,
              curiosity: 3,
              totalScore: 12,
              comments: "Good.",
              ashbyApplicationId: "app_1",
              ashbyCandidateId: "cand_1",
              ashbyJobId: "job_1",
              sourceCreatedAt: null,
              sourceUpdatedAt: "2026-07-01T00:00:00.000Z",
              rawRecord: { id: "eval_1" },
            },
          },
        }),
        receiptHandle: "receipt_1",
      },
      processEvent: async (input) => {
        processed.push(input);
        return { status: "synced", sourceEvaluationId: "eval_1", applicationId: "app_1", scoreId: "score_1" };
      },
    });

    expect(processed).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(DeleteMessageCommand);
  });

  it("polls SQS once when once is true", async () => {
    const commands: unknown[] = [];
    await runWeaveCandidateEvaluationWorker({
      once: true,
      env: {
        WEAVE_CANDIDATE_EVALUATION_QUEUE_URL: "https://sqs.example/queue",
      },
      sqs: {
        send: async (command) => {
          commands.push(command);
          return { Messages: [] };
        },
      },
      pool: { connect: async () => { throw new Error("no db expected"); } },
      write: () => undefined,
    });

    expect(commands[0]).toBeInstanceOf(ReceiveMessageCommand);
  });
});
```

- [ ] **Step 3: Run failing route and worker tests**

Run:

```bash
npm --prefix backend test -- weave-candidate-evaluations-routes.test.ts weave-candidate-evaluations-worker.test.ts
```

Expected: FAIL because route and worker modules do not exist.

- [ ] **Step 4: Implement route and worker**

Create `routes.ts` and `worker.ts` using the same injection style as `fireflies/live-ingestion-worker.ts`. The route must:

- read `WEAVE_CANDIDATE_EVALUATION_WEBHOOK_SECRET`,
- read `WEAVE_CANDIDATE_EVALUATION_QUEUE_URL`,
- read `WEAVE_CANDIDATE_EVALUATION_ORG_ID`,
- compare header `x-puddle-webhook-secret` to the secret with `timingSafeEqual`,
- call `validateWeaveCandidateEvaluationEvent`,
- enqueue `{ organizationId, event }` with `SendMessageCommand`,
- return `202`.

The worker must:

- read `WEAVE_CANDIDATE_EVALUATION_QUEUE_URL`,
- receive messages with `ReceiveMessageCommand`,
- parse `{ organizationId, event }`,
- call `processWeaveCandidateEvaluationEvent({ pool: getPool(), organizationId, event })`,
- delete messages only after successful processing,
- keep payloads out of failure logs by using a single-line `safeErrorMessage`.

- [ ] **Step 5: Register server route and package scripts**

In `backend/src/server.ts`, add:

```ts
import { registerWeaveCandidateEvaluationRoutes } from "./weave/candidate-evaluations/routes.js";
```

and call:

```ts
  registerWeaveCandidateEvaluationRoutes(app);
```

after `registerGradingRoutes(app);`.

In `backend/package.json`, add scripts:

```json
"weave:candidate-evaluations": "node --env-file=../.env.local --import tsx src/weave/candidate-evaluations/cli.ts",
"weave:candidate-evaluations-worker": "node --env-file=../.env.local --import tsx src/weave/candidate-evaluations/worker.ts",
"weave:candidate-evaluations-worker:prod": "node dist/weave/candidate-evaluations/worker.js"
```

- [ ] **Step 6: Run route, worker, and server tests**

Run:

```bash
npm --prefix backend test -- weave-candidate-evaluations-routes.test.ts weave-candidate-evaluations-worker.test.ts server.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/weave/candidate-evaluations/routes.ts backend/src/weave/candidate-evaluations/worker.ts backend/src/server.ts backend/package.json backend/test/weave-candidate-evaluations-routes.test.ts backend/test/weave-candidate-evaluations-worker.test.ts
git commit -m "Add Weave evaluation webhook ingestion"
```

### Task 5: Add Controlled JSONL Backfill CLI

**Files:**
- Create: `backend/src/weave/candidate-evaluations/cli.ts`
- Create: `backend/test/weave-candidate-evaluations-cli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Create tests that write a temporary JSONL file under `/tmp`, run the exported CLI function with `dryRun: true`, and assert:

```ts
expect(result).toMatchObject({
  mode: "dry-run",
  readCount: 2,
  validCount: 1,
  invalidCount: 1,
  syncedCount: 0,
});
```

Add an apply-mode fake processor test that asserts one valid event calls the processor once.

- [ ] **Step 2: Run failing CLI test**

Run:

```bash
npm --prefix backend test -- weave-candidate-evaluations-cli.test.ts
```

Expected: FAIL because `cli.ts` does not exist.

- [ ] **Step 3: Implement CLI**

Create `backend/src/weave/candidate-evaluations/cli.ts` that:

- accepts `--input <path>`,
- accepts `--organization-id <org_id>`,
- accepts `--dry-run`,
- accepts `--apply`,
- reads one JSON object per line,
- validates each object using `validateWeaveCandidateEvaluationEvent`,
- prints aggregate counts only,
- in apply mode calls `processWeaveCandidateEvaluationEvent`,
- closes the DB pool when it created the pool.

The CLI should not contain Supabase client code. The backfill source is a JSONL event export or Supabase SQL emitter that POSTs to the AWS ingress. Normal app code never imports Supabase.

- [ ] **Step 4: Run CLI tests**

Run:

```bash
npm --prefix backend test -- weave-candidate-evaluations-cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/weave/candidate-evaluations/cli.ts backend/test/weave-candidate-evaluations-cli.test.ts backend/package.json
git commit -m "Add Weave evaluation backfill CLI"
```

### Task 6: Expose Imported Evaluations In Backend Dashboard Read Models

**Files:**
- Modify: `backend/src/ashby/repository.ts`
- Modify: `backend/src/ashby/routes.ts`
- Modify: `backend/test/ashby-repository.test.ts`
- Modify: `backend/src/dashboard/interviews.ts`
- Modify: `backend/test/dashboard-interviews.test.ts`

- [ ] **Step 1: Write failing backend dashboard tests**

In `backend/test/ashby-repository.test.ts`, add assertions that:

```ts
const stmt = activePipelineApplicationsStatement({
  integrationId: "int_1",
  selectedJobIds: ["job_1"],
  limit: 100,
});
expect(stmt.sql).toContain("weave_candidate_evaluation_imports");
expect(stmt.sql).toContain("latest_imported_evaluation");
expect(stmt.sql).toContain("status = 'Active' OR imported_evaluation.source_evaluation_id IS NOT NULL");
```

In `backend/test/dashboard-interviews.test.ts`, extend the interview detail test:

```ts
expect(stmt.sql).toContain("imported_evaluation.item AS imported_evaluation");
expect(stmt.sql).toContain("weave_candidate_evaluation_imports imp");
expect(stmt.sql).toContain("candidateEvaluationId");
expect(stmt.sql).toContain("applicationId");
```

- [ ] **Step 2: Run failing backend dashboard tests**

Run:

```bash
npm --prefix backend test -- ashby-repository.test.ts dashboard-interviews.test.ts
```

Expected: FAIL because imported-evaluation joins are missing.

- [ ] **Step 3: Modify Ashby active pipeline SQL**

Change `activePipelineRolesStatement` so its selected jobs CTE includes both configured jobs and imported evaluation jobs:

```sql
WITH selected_jobs AS (
  SELECT unnest($2::text[]) AS job_id
  UNION
  SELECT DISTINCT ashby_job_id AS job_id
  FROM weave_candidate_evaluation_imports
  WHERE integration_id = $1
)
```

Change `activePipelineApplicationsStatement` to left join a lateral latest imported evaluation:

```sql
LEFT JOIN LATERAL (
  SELECT imp.source_evaluation_id, imp.source_updated_at, sc.problem_solving, sc.agency,
         sc.competitiveness, sc.curiosity, sc.total_score, sc.comments
  FROM weave_candidate_evaluation_imports imp
  JOIN ashby_candidate_scores sc ON sc.score_id = imp.score_id
  WHERE imp.integration_id = a.integration_id AND imp.application_id = a.application_id
  ORDER BY imp.source_updated_at DESC NULLS LAST, imp.last_synced_at DESC
  LIMIT 1
) imported_evaluation ON true
```

Select:

```sql
json_build_object(
  'sourceEvaluationId', imported_evaluation.source_evaluation_id,
  'sourceUpdatedAt', imported_evaluation.source_updated_at,
  'problemSolving', imported_evaluation.problem_solving,
  'agency', imported_evaluation.agency,
  'competitiveness', imported_evaluation.competitiveness,
  'curiosity', imported_evaluation.curiosity,
  'totalScore', imported_evaluation.total_score,
  'comments', imported_evaluation.comments
) AS latest_imported_evaluation
```

Filter with:

```sql
AND (a.status = 'Active' OR imported_evaluation.source_evaluation_id IS NOT NULL)
```

- [ ] **Step 4: Map imported evaluation JSON in Ashby routes**

Add `latest_imported_evaluation` to `ActivePipelineApplicationRow`, add `latestImportedEvaluation` to `ActivePipelineCandidate`, and map JSON only when `sourceEvaluationId` is present.

- [ ] **Step 5: Modify interview detail SQL**

In `backend/src/dashboard/interviews.ts`, add `imported_evaluation.item AS imported_evaluation` to the select list and a lateral join that finds the latest imported evaluation by:

- `source_metadata.ashby.selected.candidateEvaluationId`, or
- `source_metadata.ashby.selected.applicationId`.

- [ ] **Step 6: Run backend dashboard tests**

Run:

```bash
npm --prefix backend test -- ashby-repository.test.ts dashboard-interviews.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/ashby/repository.ts backend/src/ashby/routes.ts backend/test/ashby-repository.test.ts backend/src/dashboard/interviews.ts backend/test/dashboard-interviews.test.ts
git commit -m "Expose imported Weave evaluations in backend read models"
```

### Task 7: Display Imported Evaluations In Platform Dashboards

**Files:**
- Modify: `platform/lib/ashby/server.ts`
- Modify: `platform/app/dashboard/roles/ActivePipelineDashboard.tsx`
- Modify: `platform/app/dashboard/roles/[roleId]/candidates/[candidateId]/page.tsx`
- Modify: `platform/app/dashboard/backend-data.ts`
- Modify: `platform/app/dashboard/interviews/[sessionId]/page.tsx`
- Modify: `platform/tests/dashboard-foundation-source.test.mjs`

- [ ] **Step 1: Write failing platform source tests**

In `platform/tests/dashboard-foundation-source.test.mjs`, add tests that assert:

```js
test("candidate dashboard surfaces imported Weave evaluation scores from backend data", () => {
  assert.match(activePipelineSource, /latestImportedEvaluation/);
  assert.match(activePipelineSource, /Imported Weave evaluation/);
  assert.match(roleCandidateSource, /latestImportedEvaluation/);
  assert.match(roleCandidateSource, /Weave evaluation/);
  assert.match(roleCandidateSource, /problemSolving/);
  assert.doesNotMatch(activePipelineSource, /supabase/i);
  assert.doesNotMatch(roleCandidateSource, /supabase/i);
});

test("interview detail surfaces imported Weave evaluations without Supabase reads", () => {
  assert.match(backendDataSource, /imported_evaluation/);
  assert.match(interviewDetailSource, /imported_evaluation/);
  assert.match(interviewDetailSource, /Imported Weave evaluation/);
  assert.doesNotMatch(backendDataSource, /supabase/i);
  assert.doesNotMatch(interviewDetailSource, /supabase/i);
});
```

- [ ] **Step 2: Run failing platform source tests**

Run:

```bash
npm --prefix platform test -- dashboard-foundation-source.test.mjs
```

Expected: FAIL because UI/types do not contain imported-evaluation fields yet.

- [ ] **Step 3: Add platform types**

In `platform/lib/ashby/server.ts`, add:

```ts
export interface ImportedWeaveEvaluation {
  readonly sourceEvaluationId: string;
  readonly sourceUpdatedAt: string | null;
  readonly problemSolving: string | number;
  readonly agency: string | number;
  readonly competitiveness: string | number;
  readonly curiosity: string | number;
  readonly totalScore: string | number;
  readonly comments: string;
}
```

Add:

```ts
readonly latestImportedEvaluation: ImportedWeaveEvaluation | null;
```

to `AshbyActivePipelineCandidate`.

In `platform/app/dashboard/backend-data.ts`, add the same shape under `RealInterviewDetail` as:

```ts
readonly imported_evaluation: ImportedWeaveEvaluation | null;
```

- [ ] **Step 4: Update active pipeline rows**

In `ActivePipelineDashboard.tsx`, render a compact score pill when `candidate.latestImportedEvaluation` is present:

```tsx
{candidate.latestImportedEvaluation ? (
  <StatusPill status={`Weave ${formatScore(candidate.latestImportedEvaluation.totalScore)}/16`} />
) : null}
```

Add local `formatScore(value: string | number): string` that trims trailing `.0`.

- [ ] **Step 5: Update candidate detail page**

In `platform/app/dashboard/roles/[roleId]/candidates/[candidateId]/page.tsx`, add a `SectionPanel` after `Application profile` when `selectedCandidate.latestImportedEvaluation` exists. Render total score, four dimensions, source updated date, and comments. Keep text inside existing compact panel styles.

- [ ] **Step 6: Update interview detail page**

In `platform/app/dashboard/interviews/[sessionId]/page.tsx`, add a `SectionPanel` inside `InterviewPlaybackReview` before `AI recommendation` when `realInterview.imported_evaluation` exists. Render the same imported evaluation fields and label it `Imported Weave evaluation`.

- [ ] **Step 7: Run platform source tests**

Run:

```bash
npm --prefix platform test -- dashboard-foundation-source.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add platform/lib/ashby/server.ts platform/app/dashboard/roles/ActivePipelineDashboard.tsx 'platform/app/dashboard/roles/[roleId]/candidates/[candidateId]/page.tsx' platform/app/dashboard/backend-data.ts 'platform/app/dashboard/interviews/[sessionId]/page.tsx' platform/tests/dashboard-foundation-source.test.mjs
git commit -m "Show imported Weave evaluations in dashboards"
```

### Task 8: Add Generic External Integration Infrastructure In CDK

**Files:**
- Modify: `infra/lib/infra-stack.ts`
- Modify: `infra/test/infra.test.ts`

- [ ] **Step 1: Write failing CDK tests**

In `infra/test/infra.test.ts`, extend the backend-service test to assert:

```ts
template.hasResourceProperties("AWS::SQS::Queue", {
  QueueName: "puddle-videoagent-external-integration-ingress",
  SqsManagedSseEnabled: true,
});
template.hasResourceProperties("AWS::SQS::Queue", {
  QueueName: "puddle-videoagent-external-integration-ingress-dlq",
  SqsManagedSseEnabled: true,
});
template.hasResourceProperties("AWS::SecretsManager::Secret", {
  Name: Match.stringLikeRegexp("/integrations/external/webhook-secret$"),
});
template.hasResourceProperties("AWS::ECS::TaskDefinition", {
  ContainerDefinitions: Match.arrayWith([
    Match.objectLike({
      Name: "weave-candidate-evaluations-worker",
      Command: ["node", "dist/weave/candidate-evaluations/worker.js"],
      Environment: Match.arrayWith([
        Match.objectLike({ Name: "WEAVE_CANDIDATE_EVALUATION_ORG_ID" }),
        Match.objectLike({ Name: "WEAVE_CANDIDATE_EVALUATION_QUEUE_URL" }),
      ]),
      Secrets: Match.arrayWith([
        Match.objectLike({ Name: "WEAVE_CANDIDATE_EVALUATION_WEBHOOK_SECRET" }),
      ]),
    }),
  ]),
});
```

- [ ] **Step 2: Run failing infra tests**

Run:

```bash
npm --prefix infra test -- infra.test.ts
```

Expected: FAIL because generic queue/secret/worker resources do not exist.

- [ ] **Step 3: Implement CDK resources**

In `infra/lib/infra-stack.ts`:

- add `externalIntegrationWebhookSecret` to `RuntimeSecrets`,
- add path `integrations/external/webhook-secret`,
- create SQS queue `external-integration-ingress` and DLQ `external-integration-ingress-dlq` in the main stack,
- grant `sendMessage` to backend task role,
- grant `consumeMessages` to backend task role for the worker,
- pass queue URL and secret to backend container env/secrets,
- create a `WeaveCandidateEvaluationsWorkerTaskDefinition`,
- create a `WeaveCandidateEvaluationsWorkerService`,
- output queue URL, DLQ URL, task definition ARN, and secret name.

Do not create a Weave-only stack. The queue name and secret are generic; only the worker container command and env source adapter are Weave-specific.

- [ ] **Step 4: Run infra tests**

Run:

```bash
npm --prefix infra test -- infra.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/lib/infra-stack.ts infra/test/infra.test.ts
git commit -m "Add external integration ingress infrastructure"
```

### Task 9: Add Supabase Hook SQL And Runbook

**Files:**
- Create: `supabase/weave_candidate_evaluation_hooks.sql`
- Create: `docs/runbooks/weave-candidate-evaluation-sync.md`

- [ ] **Step 1: Write SQL hook file**

Create `supabase/weave_candidate_evaluation_hooks.sql`:

```sql
-- Weave Supabase -> Puddle AWS candidate evaluation outbound hook.
-- Apply only after the AWS endpoint and webhook secret are deployed.

create extension if not exists pg_net with schema public;
create extension if not exists supabase_vault with schema vault;

create or replace function public.puddle_candidate_evaluation_webhook_v1_for_record(
  evaluation_row public.candidate_evaluations,
  operation_name text
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  webhook_url text;
  webhook_secret text;
  event_id text;
begin
  select decrypted_secret
    into webhook_url
    from vault.decrypted_secrets
    where name = 'puddle_weave_candidate_evaluation_webhook_url'
    limit 1;

  select decrypted_secret
    into webhook_secret
    from vault.decrypted_secrets
    where name = 'puddle_weave_candidate_evaluation_webhook_secret'
    limit 1;

  if webhook_url is null or webhook_secret is null then
    raise exception 'Puddle candidate evaluation webhook URL and secret must be set in Vault';
  end if;

  event_id := gen_random_uuid()::text;

  perform net.http_post(
    url := webhook_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-puddle-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'eventId', event_id,
      'source', 'weave_supabase_candidate_evaluation',
      'operation', operation_name,
      'record', to_jsonb(evaluation_row)
    ),
    timeout_milliseconds := 5000
  );

  return;
end;
$$;

create or replace function public.puddle_candidate_evaluation_webhook_v1()
returns trigger
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  perform public.puddle_candidate_evaluation_webhook_v1_for_record(new, tg_op);
  return new;
end;
$$;

drop trigger if exists puddle_candidate_evaluation_webhook_v1 on public.candidate_evaluations;

create trigger puddle_candidate_evaluation_webhook_v1
after insert or update on public.candidate_evaluations
for each row
execute function public.puddle_candidate_evaluation_webhook_v1();

create or replace function public.puddle_backfill_candidate_evaluations_v1(batch_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  sent_count integer := 0;
  evaluation_row public.candidate_evaluations%rowtype;
begin
  for evaluation_row in
    select *
    from public.candidate_evaluations
    where ashby_application_id is not null
      and ashby_candidate_id is not null
      and ashby_job_id is not null
    order by updated_at nulls last, created_at nulls last, id
    limit batch_limit
  loop
    perform public.puddle_candidate_evaluation_webhook_v1_for_record(evaluation_row, 'UPDATE');
    sent_count := sent_count + 1;
  end loop;

  return sent_count;
end;
$$;
```

- [ ] **Step 2: Write runbook**

Create `docs/runbooks/weave-candidate-evaluation-sync.md` with:

- prerequisite checks,
- CDK synth command,
- RDS migration command gate,
- AWS secret rotation instructions,
- Supabase Vault secret insert SQL,
- Supabase hook apply gate,
- dry-run JSONL CLI command,
- Supabase backfill emitter command,
- CloudWatch/SQS/DLQ checks,
- final Puddle RDS verification SQL.

Include this verification SQL:

```sql
select count(*) as imported_evaluations
from weave_candidate_evaluation_imports
where organization_id = 'org_01KV4FF7KX24B76H7Q57QVB5CT'
  and sync_status = 'synced';

select count(*) as imported_scores
from ashby_candidate_scores s
join weave_candidate_evaluation_imports imp on imp.score_id = s.score_id
where imp.organization_id = 'org_01KV4FF7KX24B76H7Q57QVB5CT';
```

- [ ] **Step 3: Run source checks**

Run:

```bash
test -f supabase/weave_candidate_evaluation_hooks.sql
test -f docs/runbooks/weave-candidate-evaluation-sync.md
rg -n "supabase-js|createClient|NEXT_PUBLIC_SUPABASE" backend/src platform/app platform/lib
```

Expected: first two commands exit 0. The `rg` command should not show new runtime Supabase client usage from this work.

- [ ] **Step 4: Commit**

```bash
git add supabase/weave_candidate_evaluation_hooks.sql docs/runbooks/weave-candidate-evaluation-sync.md
git commit -m "Document Weave evaluation Supabase hook setup"
```

### Task 10: Full Verification Before Any Production Gate

**Files:**
- No source files.

- [ ] **Step 1: Run backend targeted tests**

Run:

```bash
npm --prefix backend test -- migrations.test.ts weave-candidate-evaluations-payload.test.ts weave-candidate-evaluations-repository.test.ts weave-candidate-evaluations-processor.test.ts weave-candidate-evaluations-routes.test.ts weave-candidate-evaluations-worker.test.ts weave-candidate-evaluations-cli.test.ts ashby-repository.test.ts dashboard-interviews.test.ts server.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run backend build**

Run:

```bash
npm --prefix backend run build
```

Expected: PASS.

- [ ] **Step 3: Run platform source tests**

Run:

```bash
npm --prefix platform test -- dashboard-foundation-source.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Run infra tests**

Run:

```bash
npm --prefix infra test -- infra.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run CDK synth**

Run:

```bash
npm --prefix infra run build
npx --prefix infra cdk synth -c deployBackendService=true -c liveKitUrl=wss://livekit.example
```

Expected: synth completes and includes the generic external integration queue, DLQ, secret, backend env vars, and Weave candidate evaluation worker task definition.

- [ ] **Step 6: Confirm production gates remain closed**

Verify no command has applied:

- production RDS migration,
- production CDK deploy,
- Supabase SQL hook,
- full backfill.

Record this in the final implementation summary.

## Plan Self-Review

- Spec coverage: schema provenance, generic AWS ingress, Weave adapter, SQS worker, Supabase outbound hook, backfill support, dashboard visibility, and verification gates are each covered by a task.
- Marker scan: no open implementation markers remain.
- Type consistency: imported evaluation fields use `sourceEvaluationId`, `sourceUpdatedAt`, `problemSolving`, `agency`, `competitiveness`, `curiosity`, `totalScore`, and `comments` consistently across backend and platform.
