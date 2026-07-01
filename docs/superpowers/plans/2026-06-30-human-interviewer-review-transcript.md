# Human Interviewer Review Transcript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest human interviewer speech from LiveKit and show it in the dashboard transcript panel while keeping grading isolated to the existing candidate/AI transcript.

**Architecture:** Add a review-only transcript table and internal ingestion endpoint. Mirror existing agent/candidate turns into that table, ingest human interviewer audio through a LiveKit worker sidecar STT path, and make dashboard detail read the review transcript when available. The grading route continues to read only `transcript_turns`.

**Tech Stack:** TypeScript/Fastify/Postgres migrations/Vitest for backend, Python LiveKit Agents/Deepgram/pytest for worker ingestion, Next.js source-tested dashboard UI.

---

## Implementation Notes

The approved spec described a `turnIndex` input, but the implementation should assign display `turn_index` on the backend. This is safer because agent/candidate turns and human interviewer STT turns are emitted by independent producers. The ingest API accepts a source-local `sourceSequence`, then the backend serializes insertion per session and assigns a monotonic `turn_index`.

Use `source` + `sourceSequence` for idempotency. The route should run inside a transaction and call `pg_advisory_xact_lock(hashtext(sessionId))` before inserting so concurrent producers cannot collide on `turn_index`.

Do not apply migrations automatically. Creating the migration file is fine; running it against shared databases remains a manual-gate operation.

---

## File Structure

### Backend

- Create `backend/migrations/019_review_transcript_turns.sql`
  - Defines `review_transcript_turns`.
  - Keeps grading table `transcript_turns` unchanged.

- Create `backend/src/reviewTranscripts/repository.ts`
  - Owns `ReviewTranscriptSpeaker`, input types, validation, advisory lock statement, upsert statement.
  - Keeps review transcript SQL out of generic streaming artifact validation.

- Modify `backend/src/internal/routes.ts`
  - Adds `POST /internal/sessions/:sessionId/review-transcript-turns`.
  - Uses the repository validation and upsert statements.

- Modify `backend/src/dashboard/interviews.ts`
  - Adds dashboard read model support for review transcript turns.
  - Falls back to `transcript_turns` for older sessions.

- Modify `backend/test/migrations.test.ts`
  - Verifies migration order and table constraints.

- Create `backend/test/review-transcripts.test.ts`
  - Tests validation and SQL generation.

- Modify `backend/test/dashboard-interviews.test.ts`
  - Verifies dashboard detail uses review transcript rows with fallback.

### Agent

- Modify `agent/src/agent/worker/backend_client.py`
  - Adds `post_review_transcript_turn`.

- Modify `agent/src/agent/controller/realtime/runner.py`
  - Adds optional `emit_review_transcript_turn`.
  - Mirrors agent/candidate turns to the review transcript stream.

- Create `agent/src/agent/worker/review_transcript.py`
  - Contains human interviewer identity matching.
  - Contains STT event normalization.
  - Contains sidecar class that subscribes to LiveKit interviewer audio and emits review transcript turns.

- Modify `agent/src/agent/worker/entrypoint.py`
  - Builds the review transcript emitter and sidecar.
  - Wires runner mirror emission.
  - Starts/stops the sidecar around the realtime session.

- Modify `agent/tests/test_backend_client.py`
  - Tests review transcript posting/buffering.

- Modify `agent/tests/test_realtime_runner.py`
  - Tests mirror emission for agent/candidate turns.

- Create `agent/tests/test_review_transcript.py`
  - Tests identity filtering, STT event normalization, and final segment emission.

- Modify `agent/tests/test_worker_entrypoint.py`
  - Tests worker wiring of review transcript emission and sidecar construction.

### Platform

- Modify `platform/app/dashboard/backend-data.ts`
  - Extends detail transcript type to include `human_interviewer`, `source`, `participantIdentity`, and `trackSid`.

- Modify `platform/app/dashboard/interviews/[sessionId]/InterviewPlaybackReview.tsx`
  - Renders `human_interviewer` with a clear label.
  - Renames AI label from ambiguous `Interviewer` to `AI interviewer`.

- Modify `platform/tests/dashboard-foundation-source.test.mjs`
  - Source-test the third speaker label and union support.

---

### Task 1: Backend Migration For Review Transcript Turns

**Files:**
- Create: `backend/migrations/019_review_transcript_turns.sql`
- Modify: `backend/test/migrations.test.ts`

- [ ] **Step 1: Write the failing migration test**

Add this test after the `018_interviewer_ai_control_ended_state.sql` test in `backend/test/migrations.test.ts`:

```ts
  it("adds review-only transcript turns after interviewer AI control ended state", () => {
    const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
    const aiEndedIndex = files.indexOf("018_interviewer_ai_control_ended_state.sql");
    const reviewTranscriptIndex = files.indexOf("019_review_transcript_turns.sql");

    expect(aiEndedIndex).toBeGreaterThanOrEqual(0);
    expect(reviewTranscriptIndex).toBeGreaterThan(aiEndedIndex);

    const migration = readFileSync(
      join(migrationsDir, "019_review_transcript_turns.sql"),
      "utf-8",
    );
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS review_transcript_turns");
    expect(migration).toContain("session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE");
    expect(migration).toContain("speaker TEXT NOT NULL CHECK (speaker IN ('agent', 'candidate', 'human_interviewer'))");
    expect(migration).toContain("UNIQUE (session_id, source, source_sequence)");
    expect(migration).toContain("review_transcript_turns_session_order_idx");
    expect(migration).not.toContain("ALTER TABLE transcript_turns");
  });
```

- [ ] **Step 2: Run the migration test and verify it fails**

Run:

```bash
cd backend && pnpm vitest run test/migrations.test.ts
```

Expected: FAIL because `019_review_transcript_turns.sql` does not exist.

- [ ] **Step 3: Add the migration**

Create `backend/migrations/019_review_transcript_turns.sql`:

```sql
-- 019_review_transcript_turns.sql - review-only transcript rows for dashboard display.

CREATE TABLE IF NOT EXISTS review_transcript_turns (
  session_id           TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  turn_index           INTEGER NOT NULL,
  speaker              TEXT NOT NULL CHECK (speaker IN ('agent', 'candidate', 'human_interviewer')),
  text                 TEXT NOT NULL,
  occurred_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  offset_ms            INTEGER,
  source               TEXT NOT NULL,
  source_sequence      INTEGER NOT NULL,
  participant_identity TEXT,
  track_sid            TEXT,
  question_id          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, turn_index),
  UNIQUE (session_id, source, source_sequence)
);

CREATE INDEX IF NOT EXISTS review_transcript_turns_session_order_idx
  ON review_transcript_turns(session_id, turn_index);

CREATE INDEX IF NOT EXISTS review_transcript_turns_participant_idx
  ON review_transcript_turns(session_id, participant_identity);
```

- [ ] **Step 4: Run the migration test and verify it passes**

Run:

```bash
cd backend && pnpm vitest run test/migrations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/019_review_transcript_turns.sql backend/test/migrations.test.ts
git commit -m "feat: add review transcript migration"
```

---

### Task 2: Backend Review Transcript Repository

**Files:**
- Create: `backend/src/reviewTranscripts/repository.ts`
- Create: `backend/test/review-transcripts.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `backend/test/review-transcripts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  reviewTranscriptSessionLockStatement,
  reviewTranscriptTurnUpsertStatement,
  validateReviewTranscriptTurn,
  type ReviewTranscriptTurnBody,
} from "../src/reviewTranscripts/repository.js";

const reviewTurn: ReviewTranscriptTurnBody = {
  sourceSequence: 7,
  speaker: "human_interviewer",
  text: "I am going to let the AI ask the next question.",
  occurredAt: "2026-06-30T20:15:31.000Z",
  offsetMs: 93000,
  source: "livekit:human-interviewer",
  participantIdentity: "interviewer-sess1-user1",
  trackSid: "TR_AM123",
  questionId: "q2",
};

function expectInvalid(result: { ok: true } | { ok: false; reason: string }): void {
  expect(result.ok).toBe(false);
}

describe("review transcript turn validation", () => {
  it("accepts a valid human interviewer review turn", () => {
    expect(validateReviewTranscriptTurn(reviewTurn)).toEqual({ ok: true });
  });

  it("accepts agent and candidate review turns", () => {
    expect(validateReviewTranscriptTurn({ ...reviewTurn, speaker: "agent" })).toEqual({ ok: true });
    expect(validateReviewTranscriptTurn({ ...reviewTurn, speaker: "candidate" })).toEqual({ ok: true });
  });

  it("rejects malformed review turn bodies", () => {
    for (const body of [null, "turn", 1, [], false]) {
      expectInvalid(validateReviewTranscriptTurn(body));
    }
  });

  it("rejects invalid fields", () => {
    expectInvalid(validateReviewTranscriptTurn({ ...reviewTurn, sourceSequence: -1 }));
    expectInvalid(validateReviewTranscriptTurn({ ...reviewTurn, sourceSequence: 1.5 }));
    expectInvalid(validateReviewTranscriptTurn({ ...reviewTurn, speaker: "interviewer" }));
    expectInvalid(validateReviewTranscriptTurn({ ...reviewTurn, text: "" }));
    expectInvalid(validateReviewTranscriptTurn({ ...reviewTurn, source: " " }));
    expectInvalid(validateReviewTranscriptTurn({ ...reviewTurn, occurredAt: "not-a-date" }));
    expectInvalid(validateReviewTranscriptTurn({ ...reviewTurn, offsetMs: -1 }));
    expectInvalid(validateReviewTranscriptTurn({ ...reviewTurn, participantIdentity: "" }));
    expectInvalid(validateReviewTranscriptTurn({ ...reviewTurn, trackSid: " " }));
    expectInvalid(validateReviewTranscriptTurn({ ...reviewTurn, questionId: "" }));
  });
});

describe("review transcript turn SQL", () => {
  it("locks a session before assigning review turn order", () => {
    const statement = reviewTranscriptSessionLockStatement("sess1");

    expect(statement.sql).toContain("pg_advisory_xact_lock");
    expect(statement.sql).toContain("hashtext($1)");
    expect(statement.params).toEqual(["sess1"]);
  });

  it("upserts by source and source sequence while assigning a session-local turn index", () => {
    const statement = reviewTranscriptTurnUpsertStatement("sess1", reviewTurn);

    expect(statement.sql).toContain("INSERT INTO review_transcript_turns");
    expect(statement.sql).toContain("COALESCE((SELECT MAX(turn_index) + 1 FROM review_transcript_turns WHERE session_id = $1), 0)");
    expect(statement.sql).toContain("ON CONFLICT (session_id, source, source_sequence) DO UPDATE SET");
    expect(statement.sql).toContain("RETURNING session_id, turn_index");
    expect(statement.params).toEqual([
      "sess1",
      "human_interviewer",
      "I am going to let the AI ask the next question.",
      "2026-06-30T20:15:31.000Z",
      93000,
      "livekit:human-interviewer",
      7,
      "interviewer-sess1-user1",
      "TR_AM123",
      "q2",
    ]);
  });
});
```

- [ ] **Step 2: Run the repository tests and verify they fail**

Run:

```bash
cd backend && pnpm vitest run test/review-transcripts.test.ts
```

Expected: FAIL because `src/reviewTranscripts/repository.ts` does not exist.

- [ ] **Step 3: Implement the repository**

Create `backend/src/reviewTranscripts/repository.ts`:

```ts
import type { SqlStatement } from "../consent/repository.js";

export type ReviewTranscriptSpeaker = "agent" | "candidate" | "human_interviewer";

export interface ReviewTranscriptTurnBody {
  readonly sourceSequence: number;
  readonly speaker: ReviewTranscriptSpeaker;
  readonly text: string;
  readonly occurredAt?: string;
  readonly offsetMs?: number | null;
  readonly source?: string;
  readonly participantIdentity?: string | null;
  readonly trackSid?: string | null;
  readonly questionId?: string | null;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isReviewSpeaker(value: unknown): value is ReviewTranscriptSpeaker {
  return value === "agent" || value === "candidate" || value === "human_interviewer";
}

function isIsoDateString(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validateOptionalString(value: unknown, reason: string): ValidationResult {
  if (value === undefined || value === null) {
    return { ok: true };
  }
  return isNonEmptyString(value) ? { ok: true } : { ok: false, reason };
}

export function validateReviewTranscriptTurn(body: unknown): ValidationResult {
  if (!isRecord(body)) {
    return { ok: false, reason: "body must be an object" };
  }
  if (!isNonNegativeInteger(body.sourceSequence)) {
    return { ok: false, reason: "sourceSequence must be a non-negative integer" };
  }
  if (!isReviewSpeaker(body.speaker)) {
    return { ok: false, reason: "speaker must be agent, candidate, or human_interviewer" };
  }
  if (!isNonEmptyString(body.text)) {
    return { ok: false, reason: "text is required" };
  }
  if (body.occurredAt !== undefined && !isIsoDateString(body.occurredAt)) {
    return { ok: false, reason: "occurredAt must be a valid ISO date string" };
  }
  if (body.offsetMs !== undefined && body.offsetMs !== null && !isNonNegativeInteger(body.offsetMs)) {
    return { ok: false, reason: "offsetMs must be a non-negative integer" };
  }
  const source = validateOptionalString(body.source, "source must be a non-empty string when provided");
  if (!source.ok) return source;
  const participantIdentity = validateOptionalString(
    body.participantIdentity,
    "participantIdentity must be a non-empty string when provided",
  );
  if (!participantIdentity.ok) return participantIdentity;
  const trackSid = validateOptionalString(body.trackSid, "trackSid must be a non-empty string when provided");
  if (!trackSid.ok) return trackSid;
  const questionId = validateOptionalString(body.questionId, "questionId must be a non-empty string when provided");
  if (!questionId.ok) return questionId;
  return { ok: true };
}

export function reviewTranscriptSessionLockStatement(sessionId: string): SqlStatement {
  return {
    sql: "SELECT pg_advisory_xact_lock(hashtext($1))",
    params: [sessionId],
  };
}

export function reviewTranscriptTurnUpsertStatement(
  sessionId: string,
  body: ReviewTranscriptTurnBody,
): SqlStatement {
  return {
    sql:
      "INSERT INTO review_transcript_turns " +
      "(session_id, turn_index, speaker, text, occurred_at, offset_ms, source, source_sequence, " +
      "participant_identity, track_sid, question_id) " +
      "VALUES ($1, COALESCE((SELECT MAX(turn_index) + 1 FROM review_transcript_turns WHERE session_id = $1), 0), " +
      "$2, $3, COALESCE($4::timestamptz, now()), $5, $6, $7, $8, $9, $10) " +
      "ON CONFLICT (session_id, source, source_sequence) DO UPDATE SET " +
      "speaker = EXCLUDED.speaker, text = EXCLUDED.text, occurred_at = EXCLUDED.occurred_at, " +
      "offset_ms = EXCLUDED.offset_ms, participant_identity = EXCLUDED.participant_identity, " +
      "track_sid = EXCLUDED.track_sid, question_id = EXCLUDED.question_id, updated_at = now() " +
      "RETURNING session_id, turn_index",
    params: [
      sessionId,
      body.speaker,
      body.text,
      body.occurredAt ?? null,
      body.offsetMs ?? null,
      body.source?.trim() || "livekit:review",
      body.sourceSequence,
      body.participantIdentity?.trim() || null,
      body.trackSid?.trim() || null,
      body.questionId?.trim() || null,
    ],
  };
}
```

- [ ] **Step 4: Run the repository tests and verify they pass**

Run:

```bash
cd backend && pnpm vitest run test/review-transcripts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/reviewTranscripts/repository.ts backend/test/review-transcripts.test.ts
git commit -m "feat: add review transcript repository"
```

---

### Task 3: Backend Internal Review Transcript Route

**Files:**
- Modify: `backend/src/internal/routes.ts`
- Modify: `backend/test/review-transcripts.test.ts`

- [ ] **Step 1: Write failing route tests**

Append these tests to `backend/test/review-transcripts.test.ts`:

```ts
import { buildServer } from "../src/server.js";
import { getPool } from "../src/db/pool.js";

vi.mock("../src/db/pool.js", () => ({
  getPool: vi.fn(),
}));

describe("review transcript route", () => {
  it("persists a review transcript turn inside a locked transaction", async () => {
    const queries: { sql: string; params: readonly unknown[] }[] = [];
    const client = {
      query: vi.fn(async (sql: string, params: readonly unknown[] = []) => {
        queries.push({ sql, params });
        return { rows: [{ session_id: "sess1", turn_index: 0 }], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    vi.mocked(getPool).mockReturnValue({
      connect: vi.fn(async () => client),
    } as never);
    const app = buildServer({ host: "wss://lk.example", apiKey: "key", apiSecret: "secret" });

    const response = await app.inject({
      method: "POST",
      url: "/internal/sessions/sess1/review-transcript-turns",
      payload: {
        sourceSequence: 0,
        speaker: "human_interviewer",
        text: "I will hand it to the AI.",
        source: "livekit:human-interviewer",
        participantIdentity: "interviewer-sess1-user1",
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true, turnIndex: 0 });
    expect(queries.map((query) => query.sql)).toEqual([
      "BEGIN",
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      expect.stringContaining("INSERT INTO review_transcript_turns"),
      "COMMIT",
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rejects invalid review transcript payloads", async () => {
    const app = buildServer({ host: "wss://lk.example", apiKey: "key", apiSecret: "secret" });

    const response = await app.inject({
      method: "POST",
      url: "/internal/sessions/sess1/review-transcript-turns",
      payload: {
        sourceSequence: 0,
        speaker: "interviewer",
        text: "bad speaker",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("speaker must be agent, candidate, or human_interviewer");
  });
});
```

Add `vi` to the Vitest import at the top:

```ts
import { describe, expect, it, vi } from "vitest";
```

- [ ] **Step 2: Run the route tests and verify they fail**

Run:

```bash
cd backend && pnpm vitest run test/review-transcripts.test.ts
```

Expected: FAIL because the route is not registered.

- [ ] **Step 3: Implement the route**

In `backend/src/internal/routes.ts`, add imports:

```ts
import {
  reviewTranscriptSessionLockStatement,
  reviewTranscriptTurnUpsertStatement,
  validateReviewTranscriptTurn,
  type ReviewTranscriptTurnBody,
} from "../reviewTranscripts/repository.js";
```

Add this route inside `registerInternalSessionRoutes`, near the existing transcript route:

```ts
  app.post<{ Params: InternalSessionParams; Body: unknown }>(
    "/internal/sessions/:sessionId/review-transcript-turns",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        return reply.code(400).send({ error: "missing session id" });
      }

      const validation = validateReviewTranscriptTurn(request.body ?? {});
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.reason });
      }

      const body = request.body as ReviewTranscriptTurnBody;
      const row = await withInternalSessionTransaction(async (client) => {
        const lock = reviewTranscriptSessionLockStatement(sessionId);
        await client.query(lock.sql, [...lock.params]);
        const upsert = reviewTranscriptTurnUpsertStatement(sessionId, body);
        const result = await client.query<{ readonly turn_index: number }>(
          upsert.sql,
          [...upsert.params],
        );
        return result.rows[0];
      });

      return reply.code(202).send({ ok: true, turnIndex: row?.turn_index ?? null });
    },
  );
```

- [ ] **Step 4: Run the route tests and verify they pass**

Run:

```bash
cd backend && pnpm vitest run test/review-transcripts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/internal/routes.ts backend/test/review-transcripts.test.ts
git commit -m "feat: add review transcript ingestion route"
```

---

### Task 4: Dashboard Backend Read Model Uses Review Transcript

**Files:**
- Modify: `backend/src/dashboard/interviews.ts`
- Modify: `backend/test/dashboard-interviews.test.ts`

- [ ] **Step 1: Write failing dashboard SQL tests**

Add these expectations to the `"queries one interview packet detail"` test in `backend/test/dashboard-interviews.test.ts`:

```ts
    expect(stmt.sql).toContain("review_transcript_turns");
    expect(stmt.sql).toContain("COALESCE(review_transcript_turns.items, transcript_turns.items, '[]'::json) AS transcript_turns");
    expect(stmt.sql).toContain("'participantIdentity', ordered.participant_identity");
    expect(stmt.sql).toContain("'trackSid', ordered.track_sid");
    expect(stmt.sql).toContain("'source', ordered.source");
```

- [ ] **Step 2: Run the dashboard test and verify it fails**

Run:

```bash
cd backend && pnpm vitest run test/dashboard-interviews.test.ts
```

Expected: FAIL because the query does not mention `review_transcript_turns`.

- [ ] **Step 3: Update `interviewDetailStatement`**

In `backend/src/dashboard/interviews.ts`, replace the selected transcript expression:

```ts
      "COALESCE(transcript_turns.items, '[]'::json) AS transcript_turns " +
```

with:

```ts
      "COALESCE(review_transcript_turns.items, transcript_turns.items, '[]'::json) AS transcript_turns " +
```

Add a new lateral before the existing `transcript_turns` lateral:

```ts
      "LEFT JOIN LATERAL (" +
      "SELECT json_agg(json_build_object(" +
      "'turnIndex', ordered.turn_index, 'speaker', ordered.speaker, " +
      "'questionId', ordered.question_id, 'text', ordered.text, " +
      "'occurredAt', ordered.occurred_at, 'offsetMs', ordered.offset_ms, " +
      "'source', ordered.source, 'participantIdentity', ordered.participant_identity, " +
      "'trackSid', ordered.track_sid" +
      ") ORDER BY ordered.turn_index) AS items " +
      "FROM (SELECT turn_index, speaker, question_id, text, occurred_at, offset_ms, " +
      "source, participant_identity, track_sid " +
      "FROM review_transcript_turns WHERE session_id = s.session_id ORDER BY turn_index) ordered" +
      ") review_transcript_turns ON true " +
```

Keep the existing `transcript_turns` lateral unchanged for fallback.

- [ ] **Step 4: Run the dashboard test and verify it passes**

Run:

```bash
cd backend && pnpm vitest run test/dashboard-interviews.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/dashboard/interviews.ts backend/test/dashboard-interviews.test.ts
git commit -m "feat: surface review transcript in dashboard detail"
```

---

### Task 5: Platform Transcript Panel Supports Human Interviewer

**Files:**
- Modify: `platform/app/dashboard/backend-data.ts`
- Modify: `platform/app/dashboard/interviews/[sessionId]/InterviewPlaybackReview.tsx`
- Modify: `platform/tests/dashboard-foundation-source.test.mjs`

- [ ] **Step 1: Write failing platform source tests**

Add this test to `platform/tests/dashboard-foundation-source.test.mjs` near the other interview detail tests:

```js
test("interview transcript panel labels AI, candidate, and human interviewer turns", () => {
  assert.match(backendDataSource, /"agent" \| "candidate" \| "human_interviewer"/);
  assert.match(interviewPlaybackReviewSource, /Human interviewer/);
  assert.match(interviewPlaybackReviewSource, /AI interviewer/);
  assert.match(interviewPlaybackReviewSource, /human_interviewer/);
});
```

- [ ] **Step 2: Run the platform source test and verify it fails**

Run:

```bash
cd platform && node --test tests/dashboard-foundation-source.test.mjs
```

Expected: FAIL because `human_interviewer` and `AI interviewer` are not present.

- [ ] **Step 3: Update platform transcript types**

In `platform/app/dashboard/backend-data.ts`, replace the `transcript_turns` speaker type:

```ts
    readonly speaker: "agent" | "candidate";
```

with:

```ts
    readonly speaker: "agent" | "candidate" | "human_interviewer";
    readonly source?: string | null;
    readonly participantIdentity?: string | null;
    readonly trackSid?: string | null;
```

- [ ] **Step 4: Update the transcript panel speaker union and labels**

In `platform/app/dashboard/interviews/[sessionId]/InterviewPlaybackReview.tsx`, replace the local `TranscriptTurn` speaker type:

```ts
  readonly speaker: "agent" | "candidate";
```

with:

```ts
  readonly speaker: "agent" | "candidate" | "human_interviewer";
```

Replace `formatSpeaker`:

```ts
function formatSpeaker(value: "agent" | "candidate"): string {
  return value === "agent" ? "Interviewer" : "Candidate";
}
```

with:

```ts
function formatSpeaker(value: "agent" | "candidate" | "human_interviewer"): string {
  if (value === "agent") {
    return "AI interviewer";
  }
  if (value === "human_interviewer") {
    return "Human interviewer";
  }
  return "Candidate";
}
```

Replace the card color condition:

```tsx
turn.speaker === "candidate" ? "border-cyan-200 bg-cyan-50/40" : "border-slate-200 bg-slate-50",
```

with:

```tsx
turn.speaker === "candidate"
  ? "border-cyan-200 bg-cyan-50/40"
  : turn.speaker === "human_interviewer"
    ? "border-amber-200 bg-amber-50/45"
    : "border-slate-200 bg-slate-50",
```

- [ ] **Step 5: Run the platform source test and verify it passes**

Run:

```bash
cd platform && node --test tests/dashboard-foundation-source.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add platform/app/dashboard/backend-data.ts platform/app/dashboard/interviews/[sessionId]/InterviewPlaybackReview.tsx platform/tests/dashboard-foundation-source.test.mjs
git commit -m "feat: show human interviewer transcript turns"
```

---

### Task 6: Backend Client Supports Review Transcript Posts

**Files:**
- Modify: `agent/src/agent/worker/backend_client.py`
- Modify: `agent/tests/test_backend_client.py`

- [ ] **Step 1: Write failing backend client test**

Add this test to `agent/tests/test_backend_client.py`:

```py
async def test_post_review_transcript_turn_posts_payload() -> None:
    transport = FakeTransport()
    client = BackendClient(session_id="sess_123", transport=transport)
    payload = {
        "sourceSequence": 0,
        "speaker": "human_interviewer",
        "text": "I will hand it over to the AI.",
    }

    await client.post_review_transcript_turn(payload)

    assert transport.posts == [
        (
            "/internal/sessions/sess_123/review-transcript-turns",
            payload,
        )
    ]
```

Use the existing `FakeTransport` helper in that test file.

- [ ] **Step 2: Run the backend client test and verify it fails**

Run:

```bash
cd agent && uv run pytest tests/test_backend_client.py::test_post_review_transcript_turn_posts_payload -q
```

Expected: FAIL because `BackendClient.post_review_transcript_turn` does not exist.

- [ ] **Step 3: Implement `post_review_transcript_turn`**

In `agent/src/agent/worker/backend_client.py`, add this method after `post_transcript_turn`:

```py
    async def post_review_transcript_turn(self, payload: dict[str, Any]) -> None:
        await self._post_or_buffer(
            PendingPost(
                f"/internal/sessions/{self._session_id}/review-transcript-turns",
                payload,
            )
        )
```

- [ ] **Step 4: Run the backend client test and verify it passes**

Run:

```bash
cd agent && uv run pytest tests/test_backend_client.py::test_post_review_transcript_turn_posts_payload -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/worker/backend_client.py agent/tests/test_backend_client.py
git commit -m "feat: add review transcript backend client"
```

---

### Task 7: Realtime Runner Mirrors Agent And Candidate Turns To Review Transcript

**Files:**
- Modify: `agent/src/agent/controller/realtime/runner.py`
- Modify: `agent/tests/test_realtime_runner.py`

- [ ] **Step 1: Write failing runner test**

Add this test to `agent/tests/test_realtime_runner.py`:

```py
async def test_realtime_runner_emits_review_transcript_for_agent_and_candidate_turns() -> None:
    review_payloads: list[dict[str, object]] = []

    async def emit_review(payload: dict[str, object]) -> None:
        review_payloads.append(payload)

    session = FakeRealtimeSession(
        [
            OutputTranscript(text="Welcome."),
            InputTranscript(text="I built the import worker."),
        ]
    )
    runner = RealtimeInterviewRunner(
        rubric=RUBRIC,
        session=session,
        guardrail_monitor=FakeGuardrailMonitor(),
        event_log=EventLog(session_id="sess1", path=None),
        clock_now=FakeClock().now,
        emit_review_transcript_turn=emit_review,
        control_tools_enabled=False,
    )

    await runner.run(session_id="sess1")

    assert review_payloads == [
        {
            "sourceSequence": 0,
            "speaker": "agent",
            "text": "Welcome.",
            "questionId": None,
            "source": "realtime:agent",
        },
        {
            "sourceSequence": 1,
            "speaker": "candidate",
            "text": "I built the import worker.",
            "questionId": None,
            "source": "realtime:candidate",
        },
    ]
```

Use the existing imports and helpers already present in `agent/tests/test_realtime_runner.py`: `FakeRealtimeSession`, `OutputTranscript`, `InputTranscript`, `EventLog`, and `RUBRIC`. Add only the `review_payloads` emitter and the runner constructor argument shown above.

- [ ] **Step 2: Run the runner test and verify it fails**

Run:

```bash
cd agent && uv run pytest tests/test_realtime_runner.py::test_realtime_runner_emits_review_transcript_for_agent_and_candidate_turns -q
```

Expected: FAIL because `emit_review_transcript_turn` is not accepted by `RealtimeInterviewRunner`.

- [ ] **Step 3: Implement mirror emission**

In `agent/src/agent/controller/realtime/runner.py`, add a constructor parameter:

```py
        emit_review_transcript_turn: ArtifactEmitter | None = None,
```

Store it:

```py
        self._emit_review_transcript_turn = emit_review_transcript_turn or _noop_emit
```

In `_append_turn`, after the existing `_emit_best_effort("transcript_turn", ...)`, add:

```py
        await _emit_best_effort(
            "review_transcript_turn",
            self._emit_review_transcript_turn,
            {
                "sourceSequence": turn_index,
                "speaker": speaker,
                "text": text,
                "questionId": self._current_question_id,
                "source": "realtime:agent" if speaker == "agent" else "realtime:candidate",
            },
        )
```

- [ ] **Step 4: Run the runner test and verify it passes**

Run:

```bash
cd agent && uv run pytest tests/test_realtime_runner.py::test_realtime_runner_emits_review_transcript_for_agent_and_candidate_turns -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/controller/realtime/runner.py agent/tests/test_realtime_runner.py
git commit -m "feat: mirror realtime transcript for review"
```

---

### Task 8: Human Interviewer Review Transcript Sidecar

**Files:**
- Create: `agent/src/agent/worker/review_transcript.py`
- Create: `agent/tests/test_review_transcript.py`

- [ ] **Step 1: Write failing sidecar unit tests**

Create `agent/tests/test_review_transcript.py`:

```py
from __future__ import annotations

from types import SimpleNamespace

from agent.worker.review_transcript import (
    HumanInterviewerTranscriptSidecar,
    final_transcript_text,
    is_final_transcript_event,
    is_human_interviewer_identity,
)


def test_is_human_interviewer_identity_matches_only_interviewer_prefix() -> None:
    assert is_human_interviewer_identity("interviewer-sess-user1") is True
    assert is_human_interviewer_identity("candidate-invite1") is False
    assert is_human_interviewer_identity("puddle-interviewer-sess1") is False
    assert is_human_interviewer_identity("") is False


def test_final_transcript_event_helpers_accept_common_shapes() -> None:
    direct = SimpleNamespace(type="final_transcript", text="Welcome from the host.")
    nested = SimpleNamespace(
        type="final_transcript",
        alternatives=[SimpleNamespace(text="I will hand it to the AI.")],
    )
    interim = SimpleNamespace(type="interim_transcript", text="still typing")

    assert is_final_transcript_event(direct) is True
    assert final_transcript_text(direct) == "Welcome from the host."
    assert final_transcript_text(nested) == "I will hand it to the AI."
    assert is_final_transcript_event(interim) is False
    assert final_transcript_text(interim) == "still typing"


async def test_sidecar_emits_final_human_interviewer_segments() -> None:
    emitted: list[dict[str, object]] = []
    events = [
        SimpleNamespace(type="interim_transcript", text="I will"),
        SimpleNamespace(type="final_transcript", text="I will hand it to the AI."),
    ]

    class FakeStream:
        def __init__(self) -> None:
            self.frames: list[object] = []

        async def __aenter__(self) -> "FakeStream":
            return self

        async def __aexit__(self, *_exc: object) -> None:
            return None

        def push_frame(self, frame: object) -> None:
            self.frames.append(frame)

        def end_input(self) -> None:
            return None

        def __aiter__(self) -> "FakeStream":
            self._iter = iter(events)
            return self

        async def __anext__(self) -> object:
            try:
                return next(self._iter)
            except StopIteration:
                raise StopAsyncIteration

    class FakeStt:
        def stream(self) -> FakeStream:
            return FakeStream()

    sidecar = HumanInterviewerTranscriptSidecar(
        emit_review_turn=lambda payload: emitted.append(payload),
        stt_factory=lambda: FakeStt(),
        audio_stream_factory=lambda _participant: [SimpleNamespace(frame=object())],
    )

    await sidecar.transcribe_participant(SimpleNamespace(identity="interviewer-sess1-user1"))

    assert emitted == [
        {
            "sourceSequence": 0,
            "speaker": "human_interviewer",
            "text": "I will hand it to the AI.",
            "source": "livekit:human-interviewer",
            "participantIdentity": "interviewer-sess1-user1",
        }
    ]


async def test_sidecar_ignores_non_interviewer_participants() -> None:
    emitted: list[dict[str, object]] = []
    sidecar = HumanInterviewerTranscriptSidecar(
        emit_review_turn=lambda payload: emitted.append(payload),
        stt_factory=lambda: object(),
        audio_stream_factory=lambda _participant: [],
    )

    await sidecar.transcribe_participant(SimpleNamespace(identity="candidate-invite1"))

    assert emitted == []
```

- [ ] **Step 2: Run the sidecar tests and verify they fail**

Run:

```bash
cd agent && uv run pytest tests/test_review_transcript.py -q
```

Expected: FAIL because `agent.worker.review_transcript` does not exist.

- [ ] **Step 3: Implement the sidecar module**

Create `agent/src/agent/worker/review_transcript.py`:

```py
from __future__ import annotations

import asyncio
import contextlib
import inspect
import logging
from collections.abc import Awaitable, Callable, Iterable
from typing import Any

logger = logging.getLogger(__name__)

_INTERVIEWER_PREFIX = "interviewer-"
_SOURCE = "livekit:human-interviewer"

ReviewEmit = Callable[[dict[str, object]], Awaitable[None] | None]
SttFactory = Callable[[], Any]
AudioStreamFactory = Callable[[Any], Any]


def is_human_interviewer_identity(identity: str) -> bool:
    return identity.startswith(_INTERVIEWER_PREFIX)


def is_final_transcript_event(event: Any) -> bool:
    event_type = str(getattr(event, "type", "")).lower()
    return "final" in event_type


def final_transcript_text(event: Any) -> str:
    text = str(getattr(event, "text", "") or getattr(event, "transcript", "") or "").strip()
    if text:
        return text
    alternatives = getattr(event, "alternatives", None)
    if alternatives:
        first = alternatives[0]
        return str(getattr(first, "text", "") or getattr(first, "transcript", "") or "").strip()
    return ""


class HumanInterviewerTranscriptSidecar:
    def __init__(
        self,
        *,
        emit_review_turn: ReviewEmit,
        stt_factory: SttFactory,
        audio_stream_factory: AudioStreamFactory | None = None,
    ) -> None:
        self._emit_review_turn = emit_review_turn
        self._stt_factory = stt_factory
        self._audio_stream_factory = audio_stream_factory or self._livekit_audio_stream
        self._source_sequence = 0
        self._tasks: set[asyncio.Task[None]] = set()
        self._room: Any | None = None

    def start(self, room: Any) -> None:
        self._room = room
        room.on("participant_connected", self._on_participant_connected)
        for participant in list(getattr(room, "remote_participants", {}).values()):
            self._schedule_participant(participant)

    async def aclose(self) -> None:
        if self._room is not None:
            with contextlib.suppress(Exception):
                self._room.off("participant_connected", self._on_participant_connected)
        for task in list(self._tasks):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

    def _on_participant_connected(self, participant: Any) -> None:
        self._schedule_participant(participant)

    def _schedule_participant(self, participant: Any) -> None:
        identity = str(getattr(participant, "identity", ""))
        if not is_human_interviewer_identity(identity):
            return
        task = asyncio.create_task(self.transcribe_participant(participant))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def transcribe_participant(self, participant: Any) -> None:
        identity = str(getattr(participant, "identity", ""))
        if not is_human_interviewer_identity(identity):
            return
        try:
            await self._transcribe_interviewer(participant, identity)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning(
                "human interviewer transcription failed",
                extra={"participant": identity},
                exc_info=True,
            )

    async def _transcribe_interviewer(self, participant: Any, identity: str) -> None:
        stt = self._stt_factory()
        audio_stream = self._audio_stream_factory(participant)
        async with stt.stream() as stream:
            async def forward_audio() -> None:
                async for audio_event in _async_iter(audio_stream):
                    frame = getattr(audio_event, "frame", audio_event)
                    stream.push_frame(frame)
                end_input = getattr(stream, "end_input", None)
                if callable(end_input):
                    end_input()

            forward_task = asyncio.create_task(forward_audio())
            try:
                async for event in stream:
                    if not is_final_transcript_event(event):
                        continue
                    text = final_transcript_text(event)
                    if not text:
                        continue
                    await self._emit(
                        {
                            "sourceSequence": self._next_sequence(),
                            "speaker": "human_interviewer",
                            "text": text,
                            "source": _SOURCE,
                            "participantIdentity": identity,
                        }
                    )
            finally:
                forward_task.cancel()
                await asyncio.gather(forward_task, return_exceptions=True)

    def _next_sequence(self) -> int:
        value = self._source_sequence
        self._source_sequence += 1
        return value

    async def _emit(self, payload: dict[str, object]) -> None:
        result = self._emit_review_turn(payload)
        if inspect.isawaitable(result):
            await result

    @staticmethod
    def _livekit_audio_stream(participant: Any) -> Any:
        from livekit import rtc

        return rtc.AudioStream.from_participant(
            participant=participant,
            track_source=rtc.TrackSource.SOURCE_MICROPHONE,
        )


async def _async_iter(value: Any) -> Any:
    if hasattr(value, "__aiter__"):
        async for item in value:
            yield item
        return
    if isinstance(value, Iterable):
        for item in value:
            yield item
```

- [ ] **Step 4: Run the sidecar tests and verify they pass**

Run:

```bash
cd agent && uv run pytest tests/test_review_transcript.py -q
cd agent && uv run ruff check src/agent/worker/review_transcript.py tests/test_review_transcript.py
```

Expected: PASS for pytest and no Ruff errors.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/worker/review_transcript.py agent/tests/test_review_transcript.py
git commit -m "feat: add human interviewer transcript sidecar"
```

---

### Task 9: Worker Wires Review Transcript Sidecar

**Files:**
- Modify: `agent/src/agent/worker/entrypoint.py`
- Modify: `agent/tests/test_worker_entrypoint.py`

- [ ] **Step 1: Write failing worker wiring test**

In `agent/tests/test_worker_entrypoint.py`, update `test_realtime_run_interview_builds_runner_and_finalizes`.

Add storage for sidecars and a fake room:

```py
    sidecars: list[object] = []
    fake_room = object()
```

Add a fake sidecar class inside the test:

```py
    class FakeSidecar:
        def __init__(self, **kwargs: object) -> None:
            self.kwargs = kwargs
            self.started_rooms: list[object] = []
            self.closed = False
            sidecars.append(self)

        def start(self, room: object) -> None:
            self.started_rooms.append(room)

        async def aclose(self) -> None:
            self.closed = True
```

Add this method to the fake backend client in `test_realtime_run_interview_builds_runner_and_finalizes`:

```py
        async def post_review_transcript_turn(self, _payload: dict[str, object]) -> None:
            calls.append("review_transcript")
```

Add this method to the fake backend client in `test_realtime_run_interview_posts_disconnected_finalization`:

```py
        async def post_review_transcript_turn(self, _p: dict[str, object]) -> None:
            pass
```

Patch sidecar and Deepgram builder:

```py
    monkeypatch.setattr(ep, "_deepgram_api_key", lambda: "dg-key")
    monkeypatch.setattr(ep, "HumanInterviewerTranscriptSidecar", FakeSidecar)
    monkeypatch.setattr(ep, "build_deepgram_stt", lambda _api_key: object())
```

Update the call in `test_realtime_run_interview_builds_runner_and_finalizes`:

```py
    await ep._realtime_run_interview(ctx, voice=fake_voice, room=fake_room)
```

Keep `test_realtime_run_interview_posts_disconnected_finalization` sidecar-free by leaving its call as:

```py
    await ep._realtime_run_interview(ctx, voice=object())
```

Update the fake `_realtime_run_interview` callbacks in `test_entrypoint_closes_voice_after_realtime_run`, `test_entrypoint_passes_candidate_identity_to_realtime_session`, `test_entrypoint_closes_realtime_voice_after_runner_failure`, and `test_entrypoint_always_selects_realtime_path` to accept `room` as a keyword argument:

```py
    async def fake_run(ctx, run_voice, *, room=None):  # noqa: ANN001
        ran["session_id"] = ctx.session_id
        ran["voice"] = run_voice
        ran["room"] = room
```

In `test_entrypoint_closes_voice_after_realtime_run`, change the final assertion to:

```py
    assert ran == {"session_id": "sess1", "voice": voice, "room": job.room}
```

In the other fake callbacks, keep the current assertions and ignore the `room` value.

Add assertions after `_realtime_run_interview`:

```py
    assert runner_init["emit_review_transcript_turn"] == clients[0].post_review_transcript_turn
    assert sidecars[0].kwargs["emit_review_turn"] == clients[0].post_review_transcript_turn
    assert sidecars[0].started_rooms == [fake_room]
    assert sidecars[0].closed is True
```

- [ ] **Step 2: Run the worker test and verify it fails**

Run:

```bash
cd agent && uv run pytest tests/test_worker_entrypoint.py::test_realtime_run_interview_builds_runner_and_finalizes -q
```

Expected: FAIL because sidecar wiring and `emit_review_transcript_turn` are not present.

- [ ] **Step 3: Implement worker wiring**

In `agent/src/agent/worker/entrypoint.py`, add imports:

```py
from agent.voice.stt import build_deepgram_stt
from agent.worker.review_transcript import HumanInterviewerTranscriptSidecar
```

Add helper:

```py
def _deepgram_api_key() -> str:
    return os.environ.get("DEEPGRAM_API_KEY", "").strip()
```

In `entrypoint`, pass the LiveKit room into the realtime runner:

```py
    try:
        await _realtime_run_interview(ctx, voice, room=job.room)
    finally:
        await _close_voice_if_present(voice)
```

Change `_realtime_run_interview` to accept the optional room:

```py
async def _realtime_run_interview(
    ctx: InterviewJobContext,
    voice: Any,
    *,
    room: Any | None = None,
) -> None:
```

In `_realtime_run_interview`, after `backend = BackendClient(...)`, add:

```py
    sidecar = None
    deepgram_api_key = _deepgram_api_key()
    if deepgram_api_key and room is not None:
        sidecar = HumanInterviewerTranscriptSidecar(
            emit_review_turn=backend.post_review_transcript_turn,
            stt_factory=lambda: build_deepgram_stt(deepgram_api_key),
        )
```

Add `emit_review_transcript_turn` to the runner constructor:

```py
        emit_review_transcript_turn=backend.post_review_transcript_turn,
```

Wrap `_run_and_finalize`:

```py
    if sidecar is not None:
        sidecar.start(room)
    try:
        await _run_and_finalize(
            runner,
            ctx=ctx,
            backend=backend,
            session_id=ctx.session_id,
            script_version=ctx.script_version,
        )
    finally:
        if sidecar is not None:
            await sidecar.aclose()
```

- [ ] **Step 4: Run the worker wiring test and verify it passes**

Run:

```bash
cd agent && uv run pytest tests/test_worker_entrypoint.py::test_realtime_run_interview_builds_runner_and_finalizes -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/src/agent/worker/entrypoint.py agent/tests/test_worker_entrypoint.py
git commit -m "feat: wire human interviewer transcript ingestion"
```

---

### Task 10: Grading Boundary Regression Test

**Files:**
- Modify: `backend/test/grading-session-recommendations.test.ts`
- Confirm no production code change needed unless test reveals a regression.

- [ ] **Step 1: Write failing-if-regressed grading isolation test**

Add this assertion to the successful recommendation generation test in `backend/test/grading-session-recommendations.test.ts`, after `scoreTranscriptMock` has been called:

```ts
      const scoringInput = scoreTranscriptMock.mock.calls[0]?.[0];
      expect(scoringInput.transcriptTurns).toEqual(routeState.transcriptRows);
      expect(scoringInput.transcriptTurns).toEqual([
        expect.objectContaining({ speaker: "agent", text: "Tell me about a hard problem." }),
        expect.objectContaining({
          speaker: "candidate",
          text: "I built a migration and cut runtime by 90%.",
        }),
      ]);
      const serializedTranscript = JSON.stringify(scoringInput.transcriptTurns);
      expect(serializedTranscript).not.toContain("human_interviewer");
      expect(sqlCalls.some((sql) => sql.includes("review_transcript_turns"))).toBe(false);
```

- [ ] **Step 2: Run the grading recommendation test**

Run:

```bash
cd backend && pnpm vitest run test/grading-session-recommendations.test.ts
```

Expected: PASS. This test should pass without production changes because the grading route already reads `transcript_turns`.

- [ ] **Step 3: Commit**

```bash
git add backend/test/grading-session-recommendations.test.ts
git commit -m "test: lock grading transcript boundary"
```

---

### Task 11: Final Verification

**Files:**
- No code changes unless verification finds failures.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
cd backend && pnpm vitest run test/migrations.test.ts test/review-transcripts.test.ts test/dashboard-interviews.test.ts test/grading-session-recommendations.test.ts
```

Expected: all listed tests PASS.

- [ ] **Step 2: Run focused agent tests**

Run:

```bash
cd agent && uv run pytest tests/test_backend_client.py tests/test_realtime_runner.py tests/test_review_transcript.py tests/test_worker_entrypoint.py
```

Expected: all listed tests PASS.

- [ ] **Step 3: Run focused platform tests**

Run:

```bash
cd platform && node --test tests/dashboard-foundation-source.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Run workspace checks**

Run:

```bash
pnpm -r test
```

Expected: all TypeScript workspace tests PASS.

Run:

```bash
cd agent && uv run pytest
```

Expected: all non-eval agent tests PASS.

- [ ] **Step 5: Review git diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only files from this plan are modified; no unrelated user changes are staged or reverted.
