# Streaming Interview Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long interviews durable by streaming transcript turns, agent events, and score checkpoints to the backend during the call, then finalizing review artifacts idempotently after the call.

**Architecture:** Keep LiveKit WebRTC and LiveKit RoomComposite Egress as the media path. Add small authenticated backend endpoints for live transcript turns, agent events, score checkpoints, and finalization; the agent posts small idempotent records as the interview progresses and flushes before closing. Finalization builds review packet artifacts from durable backend state, while the LiveKit webhook remains responsible for composite video availability.

**Tech Stack:** Python LiveKit agent, Deepgram Nova-3 streaming STT, Cartesia TTS, Fastify backend, Postgres via `pg`, AWS S3 SDK v3, LiveKit Egress webhooks, Vitest, pytest.

---

## Scope Check

This plan intentionally addresses the user's durability concern before dashboard rendering. The implementation proves that a 20-minute interview does not rely on one end-of-call API request by persisting transcript turns, agent events, and scoring checkpoints as small records during the call.

Dashboard work should follow after this plan lands, using the persisted artifacts and existing dashboard review plan as input.

## File Structure

Backend:

- Create `backend/migrations/005_streaming_interview_artifacts.sql`: typed, idempotent tables for agent events and score checkpoints.
- Create `backend/src/internal/streamingArtifacts.ts`: validation and SQL builders for transcript turn, agent event, score checkpoint, and finalization payloads.
- Modify `backend/src/internal/routes.ts`: add authenticated internal endpoints.
- Create `backend/src/finalization/reviewReady.ts`: required-artifact readiness gate shared by webhook and finalization.
- Create `backend/src/storage/artifactStore.ts`: S3 JSON/JSONL writer with path normalization.
- Create `backend/src/finalization/persist.ts`: final packet builder from DB rows.
- Modify `backend/src/livekit/webhooks.ts`: call shared readiness gate after composite completion.
- Modify `backend/package.json`: add S3 SDK dependencies.
- Add tests in `backend/test/streaming-artifacts.test.ts`, `backend/test/finalization.test.ts`, and `backend/test/server.test.ts`.

Agent:

- Create `agent/src/agent/worker/backend_client.py`: async, bounded, retrying internal backend client.
- Modify `agent/src/agent/controller/interview.py`: emit transcript turns, agent events, and score checkpoints through an injectable sink.
- Modify `agent/src/agent/worker/entrypoint.py`: wire the backend client into the runner, flush, post finalization, then close LiveKit session.
- Add tests in `agent/tests/test_backend_client.py`, `agent/tests/test_interview_runner.py`, and `agent/tests/test_worker_entrypoint.py`.

---

### Task 1: Backend Schema And SQL Builders

**Files:**
- Create: `backend/migrations/005_streaming_interview_artifacts.sql`
- Create: `backend/src/internal/streamingArtifacts.ts`
- Test: `backend/test/streaming-artifacts.test.ts`

- [ ] **Step 1: Write the failing backend SQL builder tests**

Create `backend/test/streaming-artifacts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  agentEventUpsertStatement,
  finalizationEventPayload,
  scoreCheckpointUpsertStatement,
  validateAgentEvent,
  validateFinalization,
  validateScoreCheckpoint,
  validateStreamingTranscriptTurn,
} from "../src/internal/streamingArtifacts.js";

describe("streaming artifact validation", () => {
  it("accepts a candidate transcript turn", () => {
    expect(
      validateStreamingTranscriptTurn({
        turnIndex: 3,
        speaker: "candidate",
        questionId: "q2",
        text: "I rebuilt the ingestion worker.",
        occurredAt: "2026-06-11T04:18:22.000Z",
        offsetMs: 124000,
        source: "deepgram:nova-3",
        unreliable: false,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects an empty transcript turn", () => {
    const result = validateStreamingTranscriptTurn({
      turnIndex: 3,
      speaker: "candidate",
      text: "   ",
    });

    expect(result.ok).toBe(false);
  });

  it("accepts an agent event", () => {
    expect(
      validateAgentEvent({
        sequence: 4,
        turnIndex: 4,
        utterance: "Can you walk through the tradeoff?",
        reasonCode: "PROBE_LOW_CONFIDENCE",
        questionId: "q2",
        category: "technical_depth",
        missingElement: "tradeoff analysis",
        occurredAt: "2026-06-11T04:18:31.000Z",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects an agent event without a sequence", () => {
    const result = validateAgentEvent({
      sequence: -1,
      turnIndex: 4,
      utterance: "Can you walk through the tradeoff?",
      reasonCode: "PROBE_LOW_CONFIDENCE",
    });

    expect(result.ok).toBe(false);
  });

  it("accepts a score checkpoint", () => {
    expect(
      validateScoreCheckpoint({
        sequence: 2,
        questionId: "q2",
        model: "claude-opus-4-7",
        assessments: [
          {
            category: "technical_depth",
            provisionalScore: 3,
            confidence: 0.74,
            evidenceQuotes: ["I rebuilt the ingestion worker."],
            missingOrAmbiguous: ["failure depth"],
          },
        ],
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a score checkpoint with out-of-range confidence", () => {
    const result = validateScoreCheckpoint({
      sequence: 2,
      questionId: "q2",
      model: "claude-opus-4-7",
      assessments: [
        {
          category: "technical_depth",
          provisionalScore: 3,
          confidence: 1.5,
          evidenceQuotes: [],
          missingOrAmbiguous: [],
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it("accepts finalization metadata", () => {
    expect(
      validateFinalization({
        completionReason: "completed",
        scriptVersion: "pilot-v1",
        finalTurnCount: 10,
        integrityFlags: [],
        agentEventCount: 8,
      }),
    ).toEqual({ ok: true });
  });
});

describe("streaming artifact SQL", () => {
  it("upserts agent events by session and sequence", () => {
    const stmt = agentEventUpsertStatement("sess1", {
      sequence: 4,
      turnIndex: 4,
      utterance: "Can you walk through the tradeoff?",
      reasonCode: "PROBE_LOW_CONFIDENCE",
      questionId: "q2",
      category: "technical_depth",
      missingElement: "tradeoff analysis",
      occurredAt: "2026-06-11T04:18:31.000Z",
    });

    expect(stmt.sql).toContain("ON CONFLICT (session_id, sequence)");
    expect(stmt.params).toEqual([
      "sess1",
      4,
      4,
      "Can you walk through the tradeoff?",
      "PROBE_LOW_CONFIDENCE",
      "q2",
      "technical_depth",
      "tradeoff analysis",
      "2026-06-11T04:18:31.000Z",
    ]);
  });

  it("upserts score checkpoints by session and sequence", () => {
    const stmt = scoreCheckpointUpsertStatement("sess1", {
      sequence: 2,
      questionId: "q2",
      model: "claude-opus-4-7",
      assessments: [
        {
          category: "technical_depth",
          provisionalScore: 3,
          confidence: 0.74,
          evidenceQuotes: ["I rebuilt the ingestion worker."],
          missingOrAmbiguous: ["failure depth"],
        },
      ],
    });

    expect(stmt.sql).toContain("ON CONFLICT (session_id, sequence)");
    expect(stmt.params).toEqual([
      "sess1",
      2,
      "q2",
      "claude-opus-4-7",
      JSON.stringify([
        {
          category: "technical_depth",
          provisionalScore: 3,
          confidence: 0.74,
          evidenceQuotes: ["I rebuilt the ingestion worker."],
          missingOrAmbiguous: ["failure depth"],
        },
      ]),
    ]);
  });

  it("builds a stable finalization ops payload", () => {
    expect(
      finalizationEventPayload({
        completionReason: "completed",
        scriptVersion: "pilot-v1",
        finalTurnCount: 10,
        integrityFlags: [],
        agentEventCount: 8,
      }),
    ).toEqual({
      completion_reason: "completed",
      script_version: "pilot-v1",
      final_turn_count: 10,
      integrity_flags: [],
      agent_event_count: 8,
    });
  });
});
```

- [ ] **Step 2: Run the failing backend tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
corepack pnpm@9.12.0 --filter @puddle/backend test -- streaming-artifacts.test.ts
```

Expected:

```text
FAIL backend/test/streaming-artifacts.test.ts
Error: Failed to resolve import "../src/internal/streamingArtifacts.js"
```

- [ ] **Step 3: Add the migration**

Create `backend/migrations/005_streaming_interview_artifacts.sql`:

```sql
-- 005_streaming_interview_artifacts.sql — idempotent live interview artifacts.

CREATE TABLE agent_events (
  session_id      TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  sequence        INTEGER NOT NULL,
  turn_index      INTEGER,
  utterance       TEXT NOT NULL,
  reason_code     TEXT NOT NULL,
  question_id     TEXT,
  category        TEXT,
  missing_element TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, sequence)
);

CREATE INDEX agent_events_session_order_idx
  ON agent_events(session_id, sequence);

CREATE TABLE score_checkpoints (
  session_id  TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  sequence    INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  model       TEXT NOT NULL,
  assessments JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, sequence)
);

CREATE INDEX score_checkpoints_session_order_idx
  ON score_checkpoints(session_id, sequence);
```

- [ ] **Step 4: Implement the SQL builders**

Create `backend/src/internal/streamingArtifacts.ts`:

```ts
import type { SqlStatement } from "../consent/repository.js";
import type { TranscriptSpeaker } from "../transcripts/repository.js";

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export interface StreamingTranscriptTurnBody {
  readonly turnIndex?: number;
  readonly speaker?: TranscriptSpeaker;
  readonly questionId?: string | null;
  readonly text?: string;
  readonly occurredAt?: string;
  readonly offsetMs?: number | null;
  readonly source?: string;
  readonly unreliable?: boolean;
}

export interface AgentEventBody {
  readonly sequence?: number;
  readonly turnIndex?: number | null;
  readonly utterance?: string;
  readonly reasonCode?: string;
  readonly questionId?: string | null;
  readonly category?: string | null;
  readonly missingElement?: string | null;
  readonly occurredAt?: string;
}

export interface ScoreCheckpointAssessment {
  readonly category: string;
  readonly provisionalScore: number;
  readonly confidence: number;
  readonly evidenceQuotes: readonly string[];
  readonly missingOrAmbiguous: readonly string[];
}

export interface ScoreCheckpointBody {
  readonly sequence?: number;
  readonly questionId?: string;
  readonly model?: string;
  readonly assessments?: readonly ScoreCheckpointAssessment[];
}

export type CompletionReason = "completed" | "candidate_disconnected" | "agent_error" | "timeout";

export interface FinalizationBody {
  readonly completionReason?: CompletionReason;
  readonly scriptVersion?: string;
  readonly finalTurnCount?: number;
  readonly integrityFlags?: readonly string[];
  readonly agentEventCount?: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoDateString(value: unknown): value is string {
  if (value === undefined) {
    return true;
  }
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

export function validateStreamingTranscriptTurn(
  body: StreamingTranscriptTurnBody,
): ValidationResult {
  if (!isNonNegativeInteger(body.turnIndex)) {
    return { ok: false, reason: "turnIndex must be a non-negative integer" };
  }
  if (body.speaker !== "agent" && body.speaker !== "candidate") {
    return { ok: false, reason: "speaker must be agent or candidate" };
  }
  if (!isNonEmptyString(body.text)) {
    return { ok: false, reason: "text is required" };
  }
  if (!isIsoDateString(body.occurredAt)) {
    return { ok: false, reason: "occurredAt must be an ISO timestamp" };
  }
  if (
    body.offsetMs !== undefined &&
    body.offsetMs !== null &&
    !isNonNegativeInteger(body.offsetMs)
  ) {
    return { ok: false, reason: "offsetMs must be a non-negative integer" };
  }
  return { ok: true };
}

export function validateAgentEvent(body: AgentEventBody): ValidationResult {
  if (!isNonNegativeInteger(body.sequence)) {
    return { ok: false, reason: "sequence must be a non-negative integer" };
  }
  if (
    body.turnIndex !== undefined &&
    body.turnIndex !== null &&
    !isNonNegativeInteger(body.turnIndex)
  ) {
    return { ok: false, reason: "turnIndex must be a non-negative integer" };
  }
  if (!isNonEmptyString(body.utterance)) {
    return { ok: false, reason: "utterance is required" };
  }
  if (!isNonEmptyString(body.reasonCode)) {
    return { ok: false, reason: "reasonCode is required" };
  }
  if (!isIsoDateString(body.occurredAt)) {
    return { ok: false, reason: "occurredAt must be an ISO timestamp" };
  }
  return { ok: true };
}

function validateAssessment(assessment: ScoreCheckpointAssessment): ValidationResult {
  if (!isNonEmptyString(assessment.category)) {
    return { ok: false, reason: "assessment category is required" };
  }
  if (
    !Number.isInteger(assessment.provisionalScore) ||
    assessment.provisionalScore < 1 ||
    assessment.provisionalScore > 4
  ) {
    return { ok: false, reason: "provisionalScore must be 1 through 4" };
  }
  if (typeof assessment.confidence !== "number" || assessment.confidence < 0 || assessment.confidence > 1) {
    return { ok: false, reason: "confidence must be between 0 and 1" };
  }
  if (!Array.isArray(assessment.evidenceQuotes)) {
    return { ok: false, reason: "evidenceQuotes must be an array" };
  }
  if (!Array.isArray(assessment.missingOrAmbiguous)) {
    return { ok: false, reason: "missingOrAmbiguous must be an array" };
  }
  return { ok: true };
}

export function validateScoreCheckpoint(body: ScoreCheckpointBody): ValidationResult {
  if (!isNonNegativeInteger(body.sequence)) {
    return { ok: false, reason: "sequence must be a non-negative integer" };
  }
  if (!isNonEmptyString(body.questionId)) {
    return { ok: false, reason: "questionId is required" };
  }
  if (!isNonEmptyString(body.model)) {
    return { ok: false, reason: "model is required" };
  }
  if (!Array.isArray(body.assessments)) {
    return { ok: false, reason: "assessments must be an array" };
  }
  for (const assessment of body.assessments) {
    const result = validateAssessment(assessment);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true };
}

export function validateFinalization(body: FinalizationBody): ValidationResult {
  if (
    body.completionReason !== "completed" &&
    body.completionReason !== "candidate_disconnected" &&
    body.completionReason !== "agent_error" &&
    body.completionReason !== "timeout"
  ) {
    return { ok: false, reason: "completionReason is invalid" };
  }
  if (!isNonEmptyString(body.scriptVersion)) {
    return { ok: false, reason: "scriptVersion is required" };
  }
  if (!isNonNegativeInteger(body.finalTurnCount)) {
    return { ok: false, reason: "finalTurnCount must be a non-negative integer" };
  }
  if (!Array.isArray(body.integrityFlags)) {
    return { ok: false, reason: "integrityFlags must be an array" };
  }
  if (!isNonNegativeInteger(body.agentEventCount)) {
    return { ok: false, reason: "agentEventCount must be a non-negative integer" };
  }
  return { ok: true };
}

export function agentEventUpsertStatement(sessionId: string, body: AgentEventBody): SqlStatement {
  return {
    sql:
      "INSERT INTO agent_events " +
      "(session_id, sequence, turn_index, utterance, reason_code, question_id, category, missing_element, occurred_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now())) " +
      "ON CONFLICT (session_id, sequence) DO UPDATE SET " +
      "turn_index = EXCLUDED.turn_index, utterance = EXCLUDED.utterance, " +
      "reason_code = EXCLUDED.reason_code, question_id = EXCLUDED.question_id, " +
      "category = EXCLUDED.category, missing_element = EXCLUDED.missing_element, " +
      "occurred_at = EXCLUDED.occurred_at, updated_at = now()",
    params: [
      sessionId,
      body.sequence,
      body.turnIndex ?? null,
      body.utterance,
      body.reasonCode,
      body.questionId ?? null,
      body.category ?? null,
      body.missingElement ?? null,
      body.occurredAt ?? null,
    ],
  };
}

export function scoreCheckpointUpsertStatement(
  sessionId: string,
  body: ScoreCheckpointBody,
): SqlStatement {
  return {
    sql:
      "INSERT INTO score_checkpoints " +
      "(session_id, sequence, question_id, model, assessments) " +
      "VALUES ($1, $2, $3, $4, $5::jsonb) " +
      "ON CONFLICT (session_id, sequence) DO UPDATE SET " +
      "question_id = EXCLUDED.question_id, model = EXCLUDED.model, " +
      "assessments = EXCLUDED.assessments, updated_at = now()",
    params: [
      sessionId,
      body.sequence,
      body.questionId,
      body.model,
      JSON.stringify(body.assessments ?? []),
    ],
  };
}

export function finalizationEventPayload(body: FinalizationBody): Record<string, unknown> {
  return {
    completion_reason: body.completionReason,
    script_version: body.scriptVersion,
    final_turn_count: body.finalTurnCount,
    integrity_flags: body.integrityFlags ?? [],
    agent_event_count: body.agentEventCount,
  };
}
```

- [ ] **Step 5: Run the backend SQL builder tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
corepack pnpm@9.12.0 --filter @puddle/backend test -- streaming-artifacts.test.ts
```

Expected:

```text
PASS backend/test/streaming-artifacts.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
git add backend/migrations/005_streaming_interview_artifacts.sql backend/src/internal/streamingArtifacts.ts backend/test/streaming-artifacts.test.ts
git commit -m "feat: add streaming interview artifact schema"
```

---

### Task 2: Backend Internal Streaming Routes

**Files:**
- Modify: `backend/src/internal/routes.ts`
- Test: `backend/test/server.test.ts`

- [ ] **Step 1: Write failing route tests**

Append these tests inside `describe("buildServer", ...)` in `backend/test/server.test.ts`:

```ts
  it("persists transcript turns through the internal streaming route", async () => {
    const previousToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = "test-token";
    const app = buildServer(FAKE_LK);
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const { getPool } = await import("../src/db/pool.js");
    const originalGetPool = getPool;

    vi.spyOn(await import("../src/db/pool.js"), "getPool").mockReturnValue({
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rows: [] };
      },
    } as never);

    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/sess1/transcript-turns",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        payload: {
          turnIndex: 1,
          speaker: "candidate",
          questionId: "q1",
          text: "I rebuilt the queue.",
          source: "deepgram:nova-3",
        },
      });

      expect(res.statusCode).toBe(202);
      expect(queries.some((query) => query.sql.includes("INSERT INTO transcript_turns"))).toBe(true);
    } finally {
      vi.restoreAllMocks();
      if (previousToken === undefined) {
        delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
      } else {
        process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousToken;
      }
      await app.close();
      void originalGetPool;
    }
  });

  it("rejects invalid internal transcript turn payloads", async () => {
    const previousToken = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
    process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = "test-token";
    const app = buildServer(FAKE_LK);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/internal/sessions/sess1/transcript-turns",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        payload: {
          turnIndex: 1,
          speaker: "candidate",
          text: "",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("text");
    } finally {
      if (previousToken === undefined) {
        delete process.env.PUDDLE_BACKEND_INTERNAL_TOKEN;
      } else {
        process.env.PUDDLE_BACKEND_INTERNAL_TOKEN = previousToken;
      }
      await app.close();
    }
  });
```

Also update the import at the top of `backend/test/server.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
```

- [ ] **Step 2: Run the failing route tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
corepack pnpm@9.12.0 --filter @puddle/backend test -- server.test.ts
```

Expected:

```text
FAIL backend/test/server.test.ts
expected 404 to be 202
```

- [ ] **Step 3: Add route handlers**

Modify `backend/src/internal/routes.ts` so it imports the new builders:

```ts
import {
  agentEventUpsertStatement,
  finalizationEventPayload,
  scoreCheckpointUpsertStatement,
  validateAgentEvent,
  validateFinalization,
  validateScoreCheckpoint,
  validateStreamingTranscriptTurn,
  type AgentEventBody,
  type FinalizationBody,
  type ScoreCheckpointBody,
  type StreamingTranscriptTurnBody,
} from "./streamingArtifacts.js";
import { transcriptTurnUpsertStatement } from "../transcripts/repository.js";
```

Inside `registerInternalSessionRoutes`, after the existing `/internal/sessions/:sessionId/events` route, add these routes:

```ts
  app.post<{ Params: InternalSessionParams; Body: StreamingTranscriptTurnBody }>(
    "/internal/sessions/:sessionId/transcript-turns",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        return reply.code(400).send({ error: "missing session id" });
      }

      const validation = validateStreamingTranscriptTurn(request.body ?? {});
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.reason });
      }

      const pool = getPool();
      const stmt = transcriptTurnUpsertStatement({
        sessionId,
        turnIndex: request.body.turnIndex!,
        speaker: request.body.speaker!,
        questionId: request.body.questionId ?? null,
        text: request.body.text!,
        occurredAt: request.body.occurredAt,
        offsetMs: request.body.offsetMs ?? null,
        source: request.body.source ?? "livekit",
      });
      await pool.query(stmt.sql, [...stmt.params]);
      await persistOpsEvent(pool, {
        sessionId,
        eventType: "transcript_turn_persisted",
        payload: {
          turn_index: request.body.turnIndex,
          speaker: request.body.speaker,
          question_id: request.body.questionId ?? null,
          source: request.body.source ?? "livekit",
          unreliable: request.body.unreliable === true,
        },
      });
      return reply.code(202).send({ ok: true });
    },
  );

  app.post<{ Params: InternalSessionParams; Body: AgentEventBody }>(
    "/internal/sessions/:sessionId/agent-events",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        return reply.code(400).send({ error: "missing session id" });
      }

      const validation = validateAgentEvent(request.body ?? {});
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.reason });
      }

      const pool = getPool();
      const stmt = agentEventUpsertStatement(sessionId, request.body);
      await pool.query(stmt.sql, [...stmt.params]);
      await persistOpsEvent(pool, {
        sessionId,
        eventType: "agent_event_persisted",
        payload: {
          sequence: request.body.sequence,
          reason_code: request.body.reasonCode,
          question_id: request.body.questionId ?? null,
        },
      });
      return reply.code(202).send({ ok: true });
    },
  );

  app.post<{ Params: InternalSessionParams; Body: ScoreCheckpointBody }>(
    "/internal/sessions/:sessionId/score-checkpoints",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        return reply.code(400).send({ error: "missing session id" });
      }

      const validation = validateScoreCheckpoint(request.body ?? {});
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.reason });
      }

      const pool = getPool();
      const stmt = scoreCheckpointUpsertStatement(sessionId, request.body);
      await pool.query(stmt.sql, [...stmt.params]);
      await persistOpsEvent(pool, {
        sessionId,
        eventType: "score_checkpoint_persisted",
        payload: {
          sequence: request.body.sequence,
          question_id: request.body.questionId,
          model: request.body.model,
          assessment_count: request.body.assessments?.length ?? 0,
        },
      });
      return reply.code(202).send({ ok: true });
    },
  );

  app.post<{ Params: InternalSessionParams; Body: FinalizationBody }>(
    "/internal/sessions/:sessionId/finalize",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      if (!sessionId) {
        return reply.code(400).send({ error: "missing session id" });
      }

      const validation = validateFinalization(request.body ?? {});
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.reason });
      }

      const pool = getPool();
      if (request.body.completionReason !== "completed") {
        const statusStmt = sessionStatusUpdateStatement(sessionId, "incomplete", {
          endedAt: new Date().toISOString(),
        });
        await pool.query(statusStmt.sql, [...statusStmt.params]);
      }
      await persistOpsEvent(pool, {
        sessionId,
        eventType: "interview_finalization_requested",
        payload: finalizationEventPayload(request.body),
      });
      return reply.code(202).send({ ok: true });
    },
  );
```

- [ ] **Step 4: Run route tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
corepack pnpm@9.12.0 --filter @puddle/backend test -- server.test.ts streaming-artifacts.test.ts
```

Expected:

```text
PASS backend/test/server.test.ts
PASS backend/test/streaming-artifacts.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
git add backend/src/internal/routes.ts backend/test/server.test.ts
git commit -m "feat: add internal streaming artifact routes"
```

---

### Task 3: Agent Backend Client

**Files:**
- Create: `agent/src/agent/worker/backend_client.py`
- Test: `agent/tests/test_backend_client.py`

- [ ] **Step 1: Write the failing agent backend client tests**

Create `agent/tests/test_backend_client.py`:

```python
from __future__ import annotations

from typing import Any

import pytest

from agent.worker.backend_client import BackendClient, PendingPost


class FakeTransport:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.failures = 0

    async def post(self, path: str, payload: dict[str, Any]) -> None:
        self.calls.append((path, payload))
        if self.failures > 0:
            self.failures -= 1
            raise OSError("temporary backend failure")


async def test_backend_client_posts_transcript_turn() -> None:
    transport = FakeTransport()
    client = BackendClient(session_id="sess1", transport=transport)

    await client.post_transcript_turn(
        {
            "turnIndex": 1,
            "speaker": "candidate",
            "questionId": "q1",
            "text": "I rebuilt the queue.",
            "source": "deepgram:nova-3",
        }
    )

    assert transport.calls == [
        (
            "/internal/sessions/sess1/transcript-turns",
            {
                "turnIndex": 1,
                "speaker": "candidate",
                "questionId": "q1",
                "text": "I rebuilt the queue.",
                "source": "deepgram:nova-3",
            },
        )
    ]


async def test_backend_client_buffers_failed_posts_and_flushes() -> None:
    transport = FakeTransport()
    transport.failures = 1
    client = BackendClient(session_id="sess1", transport=transport, max_pending=4)

    await client.post_agent_event(
        {
            "sequence": 1,
            "turnIndex": 0,
            "utterance": "Welcome.",
            "reasonCode": "INTRO",
            "questionId": None,
        }
    )
    assert len(client.pending) == 1

    await client.flush()

    assert len(client.pending) == 0
    assert transport.calls[-1][0] == "/internal/sessions/sess1/agent-events"


async def test_backend_client_drops_oldest_when_pending_queue_is_full() -> None:
    transport = FakeTransport()
    transport.failures = 3
    client = BackendClient(session_id="sess1", transport=transport, max_pending=2)

    await client._post_or_buffer(PendingPost("/one", {"n": 1}))
    await client._post_or_buffer(PendingPost("/two", {"n": 2}))
    await client._post_or_buffer(PendingPost("/three", {"n": 3}))

    assert [post.path for post in client.pending] == ["/two", "/three"]
```

- [ ] **Step 2: Run the failing agent tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai/agent
uv run pytest tests/test_backend_client.py
```

Expected:

```text
ModuleNotFoundError: No module named 'agent.worker.backend_client'
```

- [ ] **Step 3: Implement the backend client**

Create `agent/src/agent/worker/backend_client.py`:

```python
"""Small async client for durable backend interview artifact writes."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol

logger = logging.getLogger(__name__)


def backend_base_url() -> str:
    return os.environ.get("PUDDLE_BACKEND_BASE_URL", "http://localhost:8080").rstrip("/")


def backend_headers() -> dict[str, str]:
    headers = {"content-type": "application/json"}
    token = os.environ.get("PUDDLE_BACKEND_INTERNAL_TOKEN", "").strip()
    if token:
        headers["authorization"] = f"Bearer {token}"
    return headers


class BackendTransport(Protocol):
    async def post(self, path: str, payload: dict[str, Any]) -> None:
        """Post JSON to the backend path."""


class UrlLibBackendTransport:
    def __init__(self, base_url: str | None = None) -> None:
        self._base_url = (base_url or backend_base_url()).rstrip("/")

    async def post(self, path: str, payload: dict[str, Any]) -> None:
        await asyncio.to_thread(self._post_sync, path, payload)

    def _post_sync(self, path: str, payload: dict[str, Any]) -> None:
        request = urllib.request.Request(
            f"{self._base_url}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers=backend_headers(),
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            if response.status >= 400:
                raise RuntimeError(f"backend returned status {response.status}")


@dataclass(frozen=True)
class PendingPost:
    path: str
    payload: dict[str, Any]


class BackendClient:
    def __init__(
        self,
        *,
        session_id: str,
        transport: BackendTransport | None = None,
        max_pending: int = 64,
    ) -> None:
        self._session_id = session_id
        self._transport = transport or UrlLibBackendTransport()
        self._max_pending = max_pending
        self._pending: list[PendingPost] = []

    @property
    def pending(self) -> list[PendingPost]:
        return list(self._pending)

    async def post_transcript_turn(self, payload: dict[str, Any]) -> None:
        await self._post_or_buffer(
            PendingPost(f"/internal/sessions/{self._session_id}/transcript-turns", payload)
        )

    async def post_agent_event(self, payload: dict[str, Any]) -> None:
        await self._post_or_buffer(
            PendingPost(f"/internal/sessions/{self._session_id}/agent-events", payload)
        )

    async def post_score_checkpoint(self, payload: dict[str, Any]) -> None:
        await self._post_or_buffer(
            PendingPost(f"/internal/sessions/{self._session_id}/score-checkpoints", payload)
        )

    async def post_finalization(self, payload: dict[str, Any]) -> None:
        await self._post_or_buffer(
            PendingPost(f"/internal/sessions/{self._session_id}/finalize", payload)
        )

    async def _post_or_buffer(self, post: PendingPost) -> None:
        try:
            await self._transport.post(post.path, post.payload)
        except Exception as exc:  # noqa: BLE001 - live interview must keep moving
            logger.warning(
                "backend artifact write failed",
                extra={"path": post.path, "error": str(exc)},
            )
            self._pending.append(post)
            if len(self._pending) > self._max_pending:
                dropped = self._pending.pop(0)
                logger.error("dropping pending backend artifact write", extra={"path": dropped.path})

    async def flush(self) -> None:
        pending = self._pending
        self._pending = []
        for post in pending:
            await self._post_or_buffer(post)
```

- [ ] **Step 4: Run agent backend client tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai/agent
uv run pytest tests/test_backend_client.py
```

Expected:

```text
3 passed
```

- [ ] **Step 5: Commit**

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
git add agent/src/agent/worker/backend_client.py agent/tests/test_backend_client.py
git commit -m "feat: add agent backend artifact client"
```

---

### Task 4: Agent Live Transcript And Event Emission

**Files:**
- Modify: `agent/src/agent/controller/interview.py`
- Test: `agent/tests/test_interview_runner.py`

- [ ] **Step 1: Write failing runner emission tests**

Append to `agent/tests/test_interview_runner.py`:

```python
async def test_runner_emits_transcript_turns_and_agent_events(tmp_path: Path) -> None:
    emitted_transcripts: list[dict[str, object]] = []
    emitted_events: list[dict[str, object]] = []
    emitted_scores: list[dict[str, object]] = []

    async def emit_transcript(payload: dict[str, object]) -> None:
        emitted_transcripts.append(payload)

    async def emit_agent_event(payload: dict[str, object]) -> None:
        emitted_events.append(payload)

    async def emit_score_checkpoint(payload: dict[str, object]) -> None:
        emitted_scores.append(payload)

    rubric = RUBRIC.model_copy(update={"questions": [RUBRIC.questions[0]]})
    voice = _simulated_voice()
    scorer = MagicMock()
    scorer.score.side_effect = lambda si: _confident(si.target_categories[0])
    runner = InterviewRunner(
        rubric=rubric,
        voice=voice,
        scorer=scorer,
        probe_generator=MagicMock(),
        event_log=EventLog(session_id="sess1", path=tmp_path / "events.jsonl"),
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
        emit_transcript_turn=emit_transcript,
        emit_agent_event=emit_agent_event,
        emit_score_checkpoint=emit_score_checkpoint,
    )

    await runner.run(session_id="sess1")

    assert emitted_transcripts[0]["speaker"] == "agent"
    assert emitted_transcripts[1]["speaker"] == "candidate"
    assert emitted_transcripts[1]["text"] == "I rebuilt the queue."
    assert emitted_events[0]["reasonCode"] in {"INTRO", "SCRIPTED_QUESTION"}
    assert emitted_scores[0]["questionId"] == "q1"
    assert emitted_scores[0]["model"] == "claude-opus-4-7"
```

- [ ] **Step 2: Run the failing runner tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai/agent
uv run pytest tests/test_interview_runner.py -k emits_transcript_turns_and_agent_events
```

Expected:

```text
TypeError: InterviewRunner.__init__() got an unexpected keyword argument 'emit_transcript_turn'
```

- [ ] **Step 3: Add injectable emitters to the runner**

Modify `agent/src/agent/controller/interview.py`:

```python
from collections.abc import Awaitable, Callable
from typing import Any

ArtifactEmitter = Callable[[dict[str, Any]], Awaitable[None]]


async def _noop_emit(_payload: dict[str, Any]) -> None:
    return None
```

Extend `InterviewRunner.__init__` with these optional parameters:

```python
        emit_transcript_turn: ArtifactEmitter | None = None,
        emit_agent_event: ArtifactEmitter | None = None,
        emit_score_checkpoint: ArtifactEmitter | None = None,
```

Store them:

```python
        self._emit_transcript_turn = emit_transcript_turn or _noop_emit
        self._emit_agent_event = emit_agent_event or _noop_emit
        self._emit_score_checkpoint = emit_score_checkpoint or _noop_emit
        self._agent_event_sequence = 0
        self._score_checkpoint_sequence = 0
```

In `_say()`, after appending the `TranscriptTurn`, emit both records:

```python
        turn_payload = {
            "turnIndex": self._turn_index - 1,
            "speaker": "agent",
            "text": text,
            "questionId": question_id,
            "source": "agent-controller",
        }
        await self._emit_transcript_turn(turn_payload)

        event_payload = {
            "sequence": self._agent_event_sequence,
            "turnIndex": self._turn_index - 1,
            "utterance": text,
            "reasonCode": reason_code,
            "questionId": question_id,
            "category": category,
            "missingElement": missing_element,
        }
        self._agent_event_sequence += 1
        await self._emit_agent_event(event_payload)
```

In `_listen()`, after appending the candidate `TranscriptTurn`, emit:

```python
        await self._emit_transcript_turn(
            {
                "turnIndex": self._turn_index - 1,
                "speaker": "candidate",
                "text": result.transcript,
                "questionId": question_id,
                "source": "deepgram:nova-3",
            }
        )
```

After each scorer output in `_run_question()`, emit a checkpoint:

```python
            await self._emit_score_checkpoint(
                {
                    "sequence": self._score_checkpoint_sequence,
                    "questionId": question.question_id,
                    "model": MODELS.scorer_model,
                    "assessments": [
                        {
                            "category": assessment.category,
                            "provisionalScore": assessment.provisional_score,
                            "confidence": assessment.confidence,
                            "evidenceQuotes": assessment.evidence_quotes,
                            "missingOrAmbiguous": assessment.missing_or_ambiguous,
                        }
                        for assessment in output.assessments
                    ],
                }
            )
            self._score_checkpoint_sequence += 1
```

Add `from agent.config import MODELS` if it is not already imported.

- [ ] **Step 4: Run runner tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai/agent
uv run pytest tests/test_interview_runner.py
```

Expected:

```text
passed
```

- [ ] **Step 5: Commit**

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
git add agent/src/agent/controller/interview.py agent/tests/test_interview_runner.py
git commit -m "feat: emit live interview artifacts from agent"
```

---

### Task 5: Wire Agent Client, Finalization, And Prompt Close

**Files:**
- Modify: `agent/src/agent/worker/entrypoint.py`
- Test: `agent/tests/test_worker_entrypoint.py`

- [ ] **Step 1: Write failing worker tests**

Append to `agent/tests/test_worker_entrypoint.py`:

```python
async def test_default_interview_flushes_finalizes_and_closes(monkeypatch) -> None:
    from agent.worker import entrypoint as ep

    calls: list[str] = []

    class FakeBackendClient:
        def __init__(self, *, session_id: str) -> None:
            assert session_id == "sess1"

        async def post_transcript_turn(self, payload):  # noqa: ANN001
            calls.append("transcript")

        async def post_agent_event(self, payload):  # noqa: ANN001
            calls.append("agent_event")

        async def post_score_checkpoint(self, payload):  # noqa: ANN001
            calls.append("score")

        async def post_finalization(self, payload):  # noqa: ANN001
            calls.append(f"finalize:{payload['completionReason']}")

        async def flush(self) -> None:
            calls.append("flush")

    class FakeRunner:
        def __init__(self, **kwargs):  # noqa: ANN003
            self.kwargs = kwargs

        async def run(self, *, session_id: str):  # noqa: ANN201
            await self.kwargs["emit_transcript_turn"]({"turnIndex": 0})
            return SimpleNamespace(
                script_version="pilot-v1",
                integrity_flags=[],
                category_scores=[],
                meets_bare_minimum=True,
            )

    monkeypatch.setattr(ep, "BackendClient", FakeBackendClient)
    monkeypatch.setattr(ep, "InterviewRunner", FakeRunner)
    monkeypatch.setattr(ep, "load_rubric", lambda _path: SimpleNamespace(script_version="pilot-v1"))
    monkeypatch.setattr(ep, "Scorer", lambda **_kwargs: object())
    monkeypatch.setattr(ep, "ProbeGenerator", lambda **_kwargs: object())
    monkeypatch.setattr(ep, "EventLog", lambda **_kwargs: object())
    monkeypatch.setattr(ep.anthropic, "Anthropic", lambda: object())

    voice = SimpleNamespace(aclose=AsyncMock())
    ctx = InterviewJobContext(
        session_id="sess1",
        org_id="org1",
        script_version="pilot-v1",
        candidate_email="c@example.com",
        room_name="interview-sess1",
    )

    await ep._default_run_interview(ctx, voice)

    assert calls == ["transcript", "flush", "finalize:completed", "flush"]
```

- [ ] **Step 2: Run failing worker test**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai/agent
uv run pytest tests/test_worker_entrypoint.py -k flushes_finalizes
```

Expected:

```text
AttributeError: module 'agent.worker.entrypoint' has no attribute 'BackendClient'
```

- [ ] **Step 3: Wire the backend client in entrypoint**

Modify `agent/src/agent/worker/entrypoint.py` imports at module level so tests can patch them:

```python
import anthropic

from agent.controller.event_log import EventLog
from agent.controller.interview import InterviewRunner
from agent.rubric_loader import load_rubric
from agent.scoring.probe import ProbeGenerator
from agent.scoring.scorer import Scorer
from agent.worker.backend_client import BackendClient
from agent.voice.livekit_session import ParticipantDisconnectedError
```

In `_default_run_interview`, remove duplicate local imports for those names and create the client:

```python
    backend = BackendClient(session_id=ctx.session_id)
```

Pass emitters into `InterviewRunner`:

```python
        emit_transcript_turn=backend.post_transcript_turn,
        emit_agent_event=backend.post_agent_event,
        emit_score_checkpoint=backend.post_score_checkpoint,
```

Capture the assessment result:

```python
        assessment = await runner.run(session_id=ctx.session_id)
```

After successful completion:

```python
        await backend.flush()
        await backend.post_finalization(
            {
                "completionReason": "completed",
                "scriptVersion": assessment.script_version,
                "finalTurnCount": len(getattr(runner, "transcript", [])),
                "integrityFlags": assessment.integrity_flags,
                "agentEventCount": len(runner.event_log.events())
                if hasattr(runner, "event_log")
                else 0,
            }
        )
        await backend.flush()
```

On `ParticipantDisconnectedError`, post:

```python
        await backend.flush()
        await backend.post_finalization(
            {
                "completionReason": "candidate_disconnected",
                "scriptVersion": ctx.script_version,
                "finalTurnCount": len(getattr(runner, "transcript", [])),
                "integrityFlags": [],
                "agentEventCount": 0,
            }
        )
        await backend.flush()
```

Expose lightweight read-only properties on `InterviewRunner` if needed:

```python
    @property
    def transcript(self) -> list[TranscriptTurn]:
        return list(self._transcript)

    @property
    def event_log(self) -> EventLog:
        return self._event_log
```

Keep `entrypoint()` as:

```python
    voice = await _build_livekit_voice_agent(job)
    try:
        await _default_run_interview(ctx, voice)
    finally:
        await voice.aclose()
```

This ensures normal completion closes LiveKit promptly.

- [ ] **Step 4: Run worker tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai/agent
uv run pytest tests/test_worker_entrypoint.py tests/test_backend_client.py
```

Expected:

```text
passed
```

- [ ] **Step 5: Commit**

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
git add agent/src/agent/worker/entrypoint.py agent/src/agent/controller/interview.py agent/tests/test_worker_entrypoint.py
git commit -m "feat: finalize agent artifacts after interview"
```

---

### Task 6: S3 Artifact Store And Final Packet Builder

**Files:**
- Modify: `backend/package.json`
- Create: `backend/src/storage/artifactStore.ts`
- Create: `backend/src/finalization/persist.ts`
- Test: `backend/test/finalization.test.ts`

- [ ] **Step 1: Add backend S3 dependencies**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
corepack pnpm@9.12.0 --filter @puddle/backend add @aws-sdk/client-s3
```

Expected:

```text
Done
```

- [ ] **Step 2: Write finalization tests**

Create `backend/test/finalization.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { artifactS3Key, putJsonArtifact, putJsonLinesArtifact } from "../src/storage/artifactStore.js";
import { buildFinalArtifacts } from "../src/finalization/persist.js";

describe("artifactStore", () => {
  it("normalizes leading slashes from storage paths", () => {
    expect(artifactS3Key("/org/interviews/sess/transcripts/transcript.v1.json")).toBe(
      "org/interviews/sess/transcripts/transcript.v1.json",
    );
  });

  it("writes JSON and JSONL artifacts", async () => {
    const send = vi.fn(async () => ({}));
    const client = { send };

    await putJsonArtifact(client, {
      bucket: "bucket",
      storagePath: "/org/interviews/sess/assessment/scores.json",
      body: { ok: true },
    });
    await putJsonLinesArtifact(client, {
      bucket: "bucket",
      storagePath: "/org/interviews/sess/events/agent_events.jsonl",
      rows: [{ sequence: 0 }],
    });

    expect(send.mock.calls[0]?.[0].input.Body).toBe('{\n  "ok": true\n}\n');
    expect(send.mock.calls[1]?.[0].input.Body).toBe('{"sequence":0}\n');
  });
});

describe("buildFinalArtifacts", () => {
  it("builds final review artifacts from durable rows", () => {
    const artifacts = buildFinalArtifacts({
      session: {
        session_id: "sess1",
        org_id: "org1",
        script_version: "pilot-v1",
      },
      transcriptTurns: [
        {
          turn_index: 0,
          speaker: "agent",
          question_id: null,
          text: "Welcome.",
          occurred_at: "2026-06-11T04:16:00Z",
          offset_ms: null,
          source: "agent-controller",
        },
      ],
      agentEvents: [
        {
          sequence: 0,
          turn_index: 0,
          utterance: "Welcome.",
          reason_code: "INTRO",
          question_id: null,
          category: null,
          missing_element: null,
          occurred_at: "2026-06-11T04:16:00Z",
        },
      ],
      scoreCheckpoints: [
        {
          sequence: 0,
          question_id: "q1",
          model: "claude-opus-4-7",
          assessments: [
            {
              category: "technical_depth",
              provisionalScore: 3,
              confidence: 0.8,
              evidenceQuotes: ["Welcome."],
              missingOrAmbiguous: [],
            },
          ],
        },
      ],
      finalization: {
        completionReason: "completed",
        scriptVersion: "pilot-v1",
        finalTurnCount: 1,
        integrityFlags: [],
        agentEventCount: 1,
      },
    });

    expect(artifacts.transcript.body.turns).toHaveLength(1);
    expect(artifacts.agentEvents.rows).toHaveLength(1);
    expect(artifacts.scores.body.categoryScores[0].category).toBe("technical_depth");
    expect(artifacts.integrityFlags.body.integrityFlags).toEqual([]);
  });
});
```

- [ ] **Step 3: Run failing finalization tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
corepack pnpm@9.12.0 --filter @puddle/backend test -- finalization.test.ts
```

Expected:

```text
FAIL backend/test/finalization.test.ts
Error: Failed to resolve import "../src/storage/artifactStore.js"
```

- [ ] **Step 4: Implement the artifact store**

Create `backend/src/storage/artifactStore.ts`:

```ts
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface S3LikeClient {
  send(command: { readonly input?: Record<string, unknown> }): Promise<unknown>;
}

export function createArtifactS3Client(region = process.env.AWS_REGION): S3Client {
  return new S3Client({ region });
}

export function artifactS3Key(storagePath: string): string {
  return storagePath.replace(/^\/+/, "");
}

export async function putJsonArtifact(
  client: S3LikeClient,
  input: {
    readonly bucket: string;
    readonly storagePath: string;
    readonly body: unknown;
  },
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: artifactS3Key(input.storagePath),
      Body: `${JSON.stringify(input.body, null, 2)}\n`,
      ContentType: "application/json",
    }),
  );
}

export async function putJsonLinesArtifact(
  client: S3LikeClient,
  input: {
    readonly bucket: string;
    readonly storagePath: string;
    readonly rows: readonly unknown[];
  },
): Promise<void> {
  const body = input.rows.map((row) => JSON.stringify(row)).join("\n");
  await client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: artifactS3Key(input.storagePath),
      Body: body ? `${body}\n` : "",
      ContentType: "application/x-ndjson",
    }),
  );
}
```

- [ ] **Step 5: Implement final artifact building**

Create `backend/src/finalization/persist.ts`:

```ts
import { storagePaths } from "../storage/layout.js";

export interface FinalizationSessionRow {
  readonly session_id: string;
  readonly org_id: string;
  readonly script_version: string;
}

export interface FinalizationTranscriptTurnRow {
  readonly turn_index: number;
  readonly speaker: string;
  readonly question_id: string | null;
  readonly text: string;
  readonly occurred_at: string | Date;
  readonly offset_ms: number | null;
  readonly source: string;
}

export interface FinalizationAgentEventRow {
  readonly sequence: number;
  readonly turn_index: number | null;
  readonly utterance: string;
  readonly reason_code: string;
  readonly question_id: string | null;
  readonly category: string | null;
  readonly missing_element: string | null;
  readonly occurred_at: string | Date;
}

export interface FinalizationScoreCheckpointRow {
  readonly sequence: number;
  readonly question_id: string;
  readonly model: string;
  readonly assessments: readonly {
    readonly category: string;
    readonly provisionalScore: number;
    readonly confidence: number;
    readonly evidenceQuotes: readonly string[];
    readonly missingOrAmbiguous: readonly string[];
  }[];
}

export interface FinalizationMetadata {
  readonly completionReason: string;
  readonly scriptVersion: string;
  readonly finalTurnCount: number;
  readonly integrityFlags: readonly string[];
  readonly agentEventCount: number;
}

export interface BuildFinalArtifactsInput {
  readonly session: FinalizationSessionRow;
  readonly transcriptTurns: readonly FinalizationTranscriptTurnRow[];
  readonly agentEvents: readonly FinalizationAgentEventRow[];
  readonly scoreCheckpoints: readonly FinalizationScoreCheckpointRow[];
  readonly finalization: FinalizationMetadata;
}

export function buildFinalArtifacts(input: BuildFinalArtifactsInput): {
  readonly transcript: { readonly storagePath: string; readonly body: Record<string, unknown> };
  readonly agentEvents: { readonly storagePath: string; readonly rows: readonly unknown[] };
  readonly scores: { readonly storagePath: string; readonly body: Record<string, unknown> };
  readonly integrityFlags: { readonly storagePath: string; readonly body: Record<string, unknown> };
} {
  const paths = storagePaths(input.session.org_id, input.session.session_id);
  const latestAssessments = new Map<string, unknown>();
  for (const checkpoint of input.scoreCheckpoints) {
    for (const assessment of checkpoint.assessments) {
      latestAssessments.set(assessment.category, {
        category: assessment.category,
        score: assessment.provisionalScore,
        confidence: assessment.confidence,
        evidenceQuotes: assessment.evidenceQuotes,
        missingOrAmbiguous: assessment.missingOrAmbiguous,
        questionId: checkpoint.question_id,
        model: checkpoint.model,
      });
    }
  }

  return {
    transcript: {
      storagePath: paths.transcripts.transcript,
      body: {
        version: "v1",
        sessionId: input.session.session_id,
        scriptVersion: input.session.script_version,
        turns: input.transcriptTurns.map((turn) => ({
          turnIndex: turn.turn_index,
          speaker: turn.speaker,
          questionId: turn.question_id,
          text: turn.text,
          occurredAt: new Date(turn.occurred_at).toISOString(),
          offsetMs: turn.offset_ms,
          source: turn.source,
        })),
      },
    },
    agentEvents: {
      storagePath: paths.events.agentEvents,
      rows: input.agentEvents.map((event) => ({
        sequence: event.sequence,
        turnIndex: event.turn_index,
        utterance: event.utterance,
        reasonCode: event.reason_code,
        questionId: event.question_id,
        category: event.category,
        missingElement: event.missing_element,
        occurredAt: new Date(event.occurred_at).toISOString(),
      })),
    },
    scores: {
      storagePath: paths.assessment.scores,
      body: {
        sessionId: input.session.session_id,
        scriptVersion: input.finalization.scriptVersion,
        completionReason: input.finalization.completionReason,
        categoryScores: [...latestAssessments.values()],
      },
    },
    integrityFlags: {
      storagePath: paths.assessment.integrityFlags,
      body: {
        sessionId: input.session.session_id,
        integrityFlags: input.finalization.integrityFlags,
      },
    },
  };
}
```

- [ ] **Step 6: Run finalization tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
corepack pnpm@9.12.0 --filter @puddle/backend test -- finalization.test.ts
```

Expected:

```text
PASS backend/test/finalization.test.ts
```

- [ ] **Step 7: Commit**

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
git add backend/package.json pnpm-lock.yaml backend/src/storage/artifactStore.ts backend/src/finalization/persist.ts backend/test/finalization.test.ts
git commit -m "feat: build final interview artifact payloads"
```

---

### Task 7: Review-Ready Gate Shared By Finalization And Webhook

**Files:**
- Create: `backend/src/finalization/reviewReady.ts`
- Modify: `backend/src/livekit/webhooks.ts`
- Test: `backend/test/finalization.test.ts`

- [ ] **Step 1: Add readiness gate tests**

Append to `backend/test/finalization.test.ts`:

```ts
import {
  REQUIRED_REVIEW_ARTIFACTS,
  reviewReadyStatusStatement,
  shouldMarkReviewReady,
} from "../src/finalization/reviewReady.js";

describe("review readiness", () => {
  it("requires composite, transcript, scores, integrity flags, and agent events", () => {
    expect(REQUIRED_REVIEW_ARTIFACTS).toEqual([
      "composite_video",
      "transcript",
      "scores",
      "integrity_flags",
      "agent_events",
    ]);
  });

  it("marks ready only when all required artifacts are available", () => {
    expect(
      shouldMarkReviewReady([
        { kind: "composite_video", status: "available" },
        { kind: "transcript", status: "available" },
        { kind: "scores", status: "available" },
        { kind: "integrity_flags", status: "available" },
        { kind: "agent_events", status: "available" },
      ]),
    ).toBe(true);

    expect(
      shouldMarkReviewReady([
        { kind: "composite_video", status: "available" },
        { kind: "transcript", status: "available" },
      ]),
    ).toBe(false);
  });

  it("builds the review-ready status update statement", () => {
    const stmt = reviewReadyStatusStatement("sess1");
    expect(stmt.sql).toContain("UPDATE sessions SET status = $2");
    expect(stmt.params).toEqual(["sess1", "review_ready", null, null]);
  });
});
```

- [ ] **Step 2: Run failing readiness tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
corepack pnpm@9.12.0 --filter @puddle/backend test -- finalization.test.ts
```

Expected:

```text
Error: Failed to resolve import "../src/finalization/reviewReady.js"
```

- [ ] **Step 3: Implement readiness gate**

Create `backend/src/finalization/reviewReady.ts`:

```ts
import type { RecordingArtifactKind, RecordingArtifactStatus } from "../recordings/repository.js";
import { sessionStatusUpdateStatement } from "../scheduler/sessions.js";

export const REQUIRED_REVIEW_ARTIFACTS: readonly RecordingArtifactKind[] = [
  "composite_video",
  "transcript",
  "scores",
  "integrity_flags",
  "agent_events",
];

export interface ArtifactReadinessRow {
  readonly kind: string;
  readonly status: RecordingArtifactStatus;
}

export function shouldMarkReviewReady(rows: readonly ArtifactReadinessRow[]): boolean {
  const available = new Set(
    rows
      .filter((row) => row.status === "available")
      .map((row) => row.kind),
  );
  return REQUIRED_REVIEW_ARTIFACTS.every((kind) => available.has(kind));
}

export function artifactReadinessBySessionStatement(sessionId: string) {
  return {
    sql: "SELECT kind, status FROM recording_artifacts WHERE session_id = $1",
    params: [sessionId],
  };
}

export function reviewReadyStatusStatement(sessionId: string) {
  return sessionStatusUpdateStatement(sessionId, "review_ready");
}
```

- [ ] **Step 4: Call readiness gate from webhook**

In `backend/src/livekit/webhooks.ts`, import:

```ts
import {
  artifactReadinessBySessionStatement,
  reviewReadyStatusStatement,
  shouldMarkReviewReady,
} from "../finalization/reviewReady.js";
```

After updating the composite artifact and session to `recording_finalizing`, add:

```ts
    const readinessStmt = artifactReadinessBySessionStatement(sessionId);
    const readiness = await pool.query<{ kind: string; status: "expected" | "available" | "failed" }>(
      readinessStmt.sql,
      [...readinessStmt.params],
    );
    if (shouldMarkReviewReady(readiness.rows)) {
      const readyStmt = reviewReadyStatusStatement(sessionId);
      await pool.query(readyStmt.sql, [...readyStmt.params]);
    }
```

- [ ] **Step 5: Run backend finalization tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
corepack pnpm@9.12.0 --filter @puddle/backend test -- finalization.test.ts livekit-egress.test.ts
```

Expected:

```text
PASS backend/test/finalization.test.ts
PASS backend/test/livekit-egress.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
git add backend/src/finalization/reviewReady.ts backend/src/livekit/webhooks.ts backend/test/finalization.test.ts
git commit -m "feat: share review-ready artifact gate"
```

---

### Task 8: Finalization Endpoint Writes Artifacts And Assessment

**Files:**
- Modify: `backend/src/internal/routes.ts`
- Modify: `backend/src/finalization/persist.ts`
- Modify: `backend/src/recordings/repository.ts`
- Create: `backend/src/assessments/repository.ts`
- Test: `backend/test/finalization.test.ts`
- Test: `backend/test/server.test.ts`

- [ ] **Step 1: Add repository tests for assessment and artifact status updates**

Append to `backend/test/finalization.test.ts`:

```ts
import { assessmentUpsertStatement } from "../src/assessments/repository.js";

describe("assessment persistence", () => {
  it("upserts the final assessment by session", () => {
    const stmt = assessmentUpsertStatement({
      sessionId: "sess1",
      scriptVersion: "pilot-v1",
      categoryScores: [{ category: "technical_depth", score: 3 }],
      meetsBareMinimum: true,
      integrityFlags: [],
    });

    expect(stmt.sql).toContain("ON CONFLICT (session_id)");
    expect(stmt.params).toEqual([
      "sess1",
      "pilot-v1",
      JSON.stringify([{ category: "technical_depth", score: 3 }]),
      true,
      JSON.stringify([]),
    ]);
  });
});
```

- [ ] **Step 2: Run failing assessment tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
corepack pnpm@9.12.0 --filter @puddle/backend test -- finalization.test.ts
```

Expected:

```text
Error: Failed to resolve import "../src/assessments/repository.js"
```

- [ ] **Step 3: Implement assessment repository**

Create `backend/src/assessments/repository.ts`:

```ts
import type { SqlStatement } from "../consent/repository.js";

export interface AssessmentInput {
  readonly sessionId: string;
  readonly scriptVersion: string;
  readonly categoryScores: readonly unknown[];
  readonly meetsBareMinimum: boolean;
  readonly integrityFlags: readonly string[];
}

export function assessmentUpsertStatement(input: AssessmentInput): SqlStatement {
  return {
    sql:
      "INSERT INTO assessments " +
      "(session_id, script_version, category_scores, meets_bare_minimum, integrity_flags) " +
      "VALUES ($1, $2, $3::jsonb, $4, $5::jsonb) " +
      "ON CONFLICT (session_id) DO UPDATE SET " +
      "script_version = EXCLUDED.script_version, category_scores = EXCLUDED.category_scores, " +
      "meets_bare_minimum = EXCLUDED.meets_bare_minimum, " +
      "integrity_flags = EXCLUDED.integrity_flags",
    params: [
      input.sessionId,
      input.scriptVersion,
      JSON.stringify(input.categoryScores),
      input.meetsBareMinimum,
      JSON.stringify(input.integrityFlags),
    ],
  };
}
```

- [ ] **Step 4: Add finalization route implementation**

In `backend/src/internal/routes.ts`, import:

```ts
import { persistFinalArtifacts } from "../finalization/persist.js";
```

Replace the current `/finalize` implementation from Task 2 with:

```ts
      const pool = getPool();
      const now = new Date().toISOString();
      const finalizationPayload = finalizationEventPayload(request.body);

      await persistOpsEvent(pool, {
        sessionId,
        eventType: "interview_finalization_requested",
        payload: finalizationPayload,
      });

      if (request.body.completionReason !== "completed") {
        const statusStmt = sessionStatusUpdateStatement(sessionId, "incomplete", {
          endedAt: now,
        });
        await pool.query(statusStmt.sql, [...statusStmt.params]);
        return reply.code(202).send({ ok: true, status: "incomplete" });
      }

      await persistFinalArtifacts({
        pool,
        sessionId,
        finalization: {
          completionReason: request.body.completionReason!,
          scriptVersion: request.body.scriptVersion!,
          finalTurnCount: request.body.finalTurnCount!,
          integrityFlags: request.body.integrityFlags!,
          agentEventCount: request.body.agentEventCount!,
        },
      });

      const statusStmt = sessionStatusUpdateStatement(sessionId, "recording_finalizing", {
        endedAt: now,
      });
      await pool.query(statusStmt.sql, [...statusStmt.params]);

      return reply.code(202).send({ ok: true, status: "recording_finalizing" });
```

Add these imports to the top of `backend/src/finalization/persist.ts`, then add the interfaces and `persistFinalArtifacts` function below `buildFinalArtifacts`:

```ts
import { assessmentUpsertStatement } from "../assessments/repository.js";
import {
  recordingArtifactStatusUpdateStatement,
  type RecordingArtifactKind,
} from "../recordings/repository.js";
import {
  createArtifactS3Client,
  putJsonArtifact,
  putJsonLinesArtifact,
  type S3LikeClient,
} from "../storage/artifactStore.js";
import {
  artifactReadinessBySessionStatement,
  reviewReadyStatusStatement,
  shouldMarkReviewReady,
} from "./reviewReady.js";

export interface Queryable {
  query<T = unknown>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: T[] }>;
}

export interface PersistFinalArtifactsInput {
  readonly pool: Queryable;
  readonly sessionId: string;
  readonly finalization: FinalizationMetadata;
  readonly s3Client?: S3LikeClient;
  readonly bucket?: string;
}

interface RawScoreCheckpointRow {
  readonly sequence: number;
  readonly question_id: string;
  readonly model: string;
  readonly assessments: unknown;
}

function normalizeScoreCheckpoint(row: RawScoreCheckpointRow): FinalizationScoreCheckpointRow {
  const assessments =
    typeof row.assessments === "string"
      ? JSON.parse(row.assessments)
      : row.assessments;
  return {
    sequence: row.sequence,
    question_id: row.question_id,
    model: row.model,
    assessments: Array.isArray(assessments) ? assessments : [],
  };
}

async function markArtifactAvailable(
  pool: Queryable,
  sessionId: string,
  kind: RecordingArtifactKind,
): Promise<void> {
  const stmt = recordingArtifactStatusUpdateStatement({
    sessionId,
    kind,
    status: "available",
  });
  await pool.query(stmt.sql, [...stmt.params]);
}

export async function persistFinalArtifacts(input: PersistFinalArtifactsInput): Promise<void> {
  const bucket = input.bucket ?? process.env.PUDDLE_ARTIFACTS_BUCKET;
  if (!bucket) {
    throw new Error("PUDDLE_ARTIFACTS_BUCKET must be set to finalize artifacts");
  }

  const sessionResult = await input.pool.query<FinalizationSessionRow>(
    "SELECT session_id, org_id, script_version FROM sessions WHERE session_id = $1",
    [input.sessionId],
  );
  const session = sessionResult.rows[0];
  if (!session) {
    throw new Error(`session not found: ${input.sessionId}`);
  }

  const transcriptTurns = await input.pool.query<FinalizationTranscriptTurnRow>(
    "SELECT turn_index, speaker, question_id, text, occurred_at, offset_ms, source " +
      "FROM transcript_turns WHERE session_id = $1 ORDER BY turn_index ASC",
    [input.sessionId],
  );
  const agentEvents = await input.pool.query<FinalizationAgentEventRow>(
    "SELECT sequence, turn_index, utterance, reason_code, question_id, category, missing_element, occurred_at " +
      "FROM agent_events WHERE session_id = $1 ORDER BY sequence ASC",
    [input.sessionId],
  );
  const scoreRows = await input.pool.query<RawScoreCheckpointRow>(
    "SELECT sequence, question_id, model, assessments " +
      "FROM score_checkpoints WHERE session_id = $1 ORDER BY sequence ASC",
    [input.sessionId],
  );

  const artifacts = buildFinalArtifacts({
    session,
    transcriptTurns: transcriptTurns.rows,
    agentEvents: agentEvents.rows,
    scoreCheckpoints: scoreRows.rows.map(normalizeScoreCheckpoint),
    finalization: input.finalization,
  });

  const s3Client = input.s3Client ?? createArtifactS3Client();
  await putJsonArtifact(s3Client, {
    bucket,
    storagePath: artifacts.transcript.storagePath,
    body: artifacts.transcript.body,
  });
  await putJsonLinesArtifact(s3Client, {
    bucket,
    storagePath: artifacts.agentEvents.storagePath,
    rows: artifacts.agentEvents.rows,
  });
  await putJsonArtifact(s3Client, {
    bucket,
    storagePath: artifacts.scores.storagePath,
    body: artifacts.scores.body,
  });
  await putJsonArtifact(s3Client, {
    bucket,
    storagePath: artifacts.integrityFlags.storagePath,
    body: artifacts.integrityFlags.body,
  });

  const categoryScores = Array.isArray(artifacts.scores.body.categoryScores)
    ? artifacts.scores.body.categoryScores
    : [];
  const assessmentStmt = assessmentUpsertStatement({
    sessionId: input.sessionId,
    scriptVersion: input.finalization.scriptVersion,
    categoryScores,
    meetsBareMinimum: categoryScores.length > 0,
    integrityFlags: input.finalization.integrityFlags,
  });
  await input.pool.query(assessmentStmt.sql, [...assessmentStmt.params]);

  await markArtifactAvailable(input.pool, input.sessionId, "transcript");
  await markArtifactAvailable(input.pool, input.sessionId, "agent_events");
  await markArtifactAvailable(input.pool, input.sessionId, "scores");
  await markArtifactAvailable(input.pool, input.sessionId, "integrity_flags");

  const readinessStmt = artifactReadinessBySessionStatement(input.sessionId);
  const readiness = await input.pool.query<{ kind: string; status: "expected" | "available" | "failed" }>(
    readinessStmt.sql,
    [...readinessStmt.params],
  );
  if (shouldMarkReviewReady(readiness.rows)) {
    const readyStmt = reviewReadyStatusStatement(input.sessionId);
    await input.pool.query(readyStmt.sql, [...readyStmt.params]);
  }
}
```

- [ ] **Step 5: Run backend finalization tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
corepack pnpm@9.12.0 --filter @puddle/backend test -- finalization.test.ts server.test.ts
```

Expected:

```text
PASS backend/test/finalization.test.ts
PASS backend/test/server.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
git add backend/src/internal/routes.ts backend/src/finalization/persist.ts backend/src/assessments/repository.ts backend/test/finalization.test.ts backend/test/server.test.ts
git commit -m "feat: finalize durable interview artifacts"
```

---

### Task 9: End-To-End Local Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run backend unit tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
corepack pnpm@9.12.0 --filter @puddle/backend test
```

Expected:

```text
Test Files  passed
Tests  passed
```

- [ ] **Step 2: Run backend build**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
corepack pnpm@9.12.0 --filter @puddle/backend build
```

Expected:

```text
Done
```

- [ ] **Step 3: Run agent unit tests**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai/agent
uv run pytest
```

Expected:

```text
passed
```

- [ ] **Step 4: Run agent lint if configured**

Run:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai/agent
uv run ruff check src tests
```

Expected:

```text
All checks passed!
```

- [ ] **Step 5: Deploy and run one connected interview**

Use the existing connected dev flow:

```bash
cd /Users/prakulsingh/Desktop/dev/PuddleVideoPlatform/voiceai
AWS_PROFILE=default corepack pnpm@9.12.0 dev:connected
```

In another terminal, run DB/S3 checks after a test interview completes:

```bash
aws s3api list-objects-v2 \
  --profile default \
  --region us-west-1 \
  --bucket puddle-videoagent-artifacts-851725544921-us-west-1 \
  --prefix '<org-id>/interviews/<session-id>/'
```

Expected S3 keys:

```text
media/composite.mp4
transcripts/transcript.v1.json
events/agent_events.jsonl
assessment/scores.json
assessment/integrity_flags.json
```

Query Postgres through the dev tunnel:

```sql
SELECT count(*) FROM transcript_turns WHERE session_id = '<session-id>';
SELECT count(*) FROM agent_events WHERE session_id = '<session-id>';
SELECT count(*) FROM score_checkpoints WHERE session_id = '<session-id>';
SELECT status FROM sessions WHERE session_id = '<session-id>';
SELECT kind, status FROM recording_artifacts WHERE session_id = '<session-id>' ORDER BY kind;
```

Expected:

```text
transcript_turns count > 0
agent_events count > 0
score_checkpoints count > 0
sessions.status = review_ready after video and artifacts complete
required recording_artifacts rows are available
```

- [ ] **Step 6: Commit verification notes if the repo tracks runbooks**

If the team wants a record, append the verification commands and observed session ID to an existing runbook under `docs/`. Do not commit secrets, raw transcript text, or signed URLs.

```bash
git status --short
git commit -m "docs: record streaming artifact verification"
```

---

## Plan Self-Review

Spec coverage:

- Live media remains LiveKit/Egress: covered by architecture and Task 7 webhook readiness.
- Durable transcript turns: Tasks 1, 2, 3, 4, and 9.
- Durable agent events: Tasks 1, 2, 3, 4, and 9.
- Durable score checkpoints: Tasks 1, 2, 3, 4, and 9.
- Idempotent finalization: Tasks 6, 7, and 8.
- Prompt close after completion: Task 5 keeps `voice.aclose()` in the entrypoint `finally`.
- No single long API call: Tasks 3 and 4 emit small records during the call; Task 9 verifies counts before review readiness.

Completeness scan:

- No marker text or unnamed files remain.
- Product decisions from the design are intentionally excluded from this implementation plan; the implementation stores partial data without exposing it in the dashboard.

Type consistency:

- Backend payload names use camelCase at the API boundary and snake_case only in DB/audit payloads.
- Agent payloads use camelCase to match backend request bodies.
- Score checkpoint fields map `CategoryAssessment.provisional_score` to `provisionalScore`, `evidence_quotes` to `evidenceQuotes`, and `missing_or_ambiguous` to `missingOrAmbiguous`.
