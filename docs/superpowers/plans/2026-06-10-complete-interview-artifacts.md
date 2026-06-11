# Complete Interview Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn existing LiveKit RoomComposite recordings into complete review packets with real composite video playback, transcript persistence, score persistence, artifact metadata, and real dashboard rendering.

**Architecture:** Keep LiveKit RoomComposite as the review video source of truth. Add a backend finalization endpoint that receives the agent's transcript, assessment, and agent events; persists them to Postgres; writes JSON/JSONL artifacts to S3; updates artifact availability; and marks sessions `review_ready` once the required packet artifacts are present. The platform dashboard reads real packet data from backend internal GET routes and renders the signed composite video URL plus transcript and scorecard.

**Tech Stack:** Fastify backend, Postgres via `pg`, AWS S3 via AWS SDK v3, LiveKit RoomComposite Egress, Python LiveKit agent, Next.js platform dashboard.

---

## Scope Decisions

RoomComposite is sufficient for the first reviewable video artifact because it includes the composed room video and mixed room audio. It is not a transcript producer and does not create separate candidate/agent tracks.

For this implementation, the review-ready gate requires:

- `composite_video`
- `transcript`
- `scores`
- `integrity_flags`
- `agent_events`

These remain optional artifact rows in this plan:

- `candidate_video`
- `candidate_audio`
- `agent_audio`
- `media_events`
- `integrity_events`

Separate raw candidate/agent audio and candidate video should be implemented in a dedicated raw-media plan if we need clean post-call diarization, raw media exports, or compliance-grade per-participant archives. The current product can play mixed audio from `composite.mp4` and can persist transcript turns from the agent/STT path.

## File Structure

Backend storage and artifact finalization:

- Create `backend/src/storage/artifactStore.ts`: small S3 wrapper for JSON, JSONL, and signed URL generation.
- Create `backend/test/artifact-store.test.ts`: unit tests for key normalization and store calls using a fake S3 client.
- Modify `backend/package.json`: add `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.
- Create `backend/src/assessments/repository.ts`: SQL builders for upserting and reading assessments.
- Create `backend/test/assessments.test.ts`: SQL builder tests.
- Create `backend/src/finalization/reviewReady.ts`: required-artifact gate and session transition logic.
- Create `backend/src/finalization/persist.ts`: persist transcript turns, assessment, S3 artifacts, artifact statuses, and review-ready transition.
- Create `backend/src/finalization/routes.ts`: `POST /internal/sessions/:sessionId/finalize`.
- Modify `backend/src/livekit/webhooks.ts`: call review-ready transition after composite egress completion.
- Modify `backend/src/server.ts`: register finalization and dashboard routes.
- Modify `backend/src/integration/internal-auth.ts`: require internal bearer auth for all `/internal/*` methods, not just POST.
- Add tests in `backend/test/finalization.test.ts` and `backend/test/server.test.ts`.

Backend dashboard read model:

- Create `backend/src/dashboard/interviews.ts`: SQL-backed list/detail packet read model.
- Create `backend/src/dashboard/routes.ts`: internal GET routes for dashboard list/detail.
- Create `backend/test/dashboard-interviews.test.ts`: query builder and mapping tests.

Agent finalization reporting:

- Modify `agent/src/agent/controller/interview.py`: expose transcript turns after `run()`.
- Modify `agent/src/agent/worker/backend_status.py`: add `post_interview_finalization()`.
- Modify `agent/src/agent/worker/entrypoint.py`: post finalization payload after successful runner completion.
- Add tests in `agent/tests/test_interview_runner.py` and `agent/tests/test_worker_entrypoint.py`.

Platform real dashboard rendering:

- Create `platform/app/dashboard/backend-data.ts`: server-side backend client and packet types.
- Modify `platform/app/dashboard/page.tsx`: load real packet summary.
- Modify `platform/app/dashboard/DashboardSections.tsx`: accept real packet props; keep demo fallback only when backend is unreachable in development.
- Modify `platform/app/dashboard/interviews/[sessionId]/page.tsx`: load real packet detail and render `<video controls>`.

---

### Task 1: Add S3 Artifact Store

**Files:**
- Modify: `backend/package.json`
- Create: `backend/src/storage/artifactStore.ts`
- Test: `backend/test/artifact-store.test.ts`

- [ ] **Step 1: Add AWS SDK dependencies**

Run:

```bash
corepack pnpm@9.12.0 --filter @puddle/backend add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

Expected:

```text
Done
```

- [ ] **Step 2: Write the artifact store tests**

Create `backend/test/artifact-store.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  artifactS3Key,
  putJsonArtifact,
  putJsonLinesArtifact,
  signedArtifactUrl,
  type S3LikeClient,
} from "../src/storage/artifactStore.js";

describe("artifactStore", () => {
  it("normalizes storage paths into S3 keys", () => {
    expect(artifactS3Key("/org/interviews/sess/media/composite.mp4")).toBe(
      "org/interviews/sess/media/composite.mp4",
    );
    expect(artifactS3Key("org/interviews/sess/transcripts/transcript.v1.json")).toBe(
      "org/interviews/sess/transcripts/transcript.v1.json",
    );
  });

  it("writes JSON artifacts with stable formatting", async () => {
    const send = vi.fn(async () => ({}));
    const client: S3LikeClient = { send };

    await putJsonArtifact(client, {
      bucket: "puddle-artifacts",
      storagePath: "/org/interviews/sess/transcripts/transcript.v1.json",
      body: { version: "v1", turns: [] },
    });

    const command = send.mock.calls[0]?.[0] as { input?: Record<string, unknown> };
    expect(command.input?.Bucket).toBe("puddle-artifacts");
    expect(command.input?.Key).toBe("org/interviews/sess/transcripts/transcript.v1.json");
    expect(command.input?.ContentType).toBe("application/json");
    expect(command.input?.Body).toBe('{\n  "version": "v1",\n  "turns": []\n}\n');
  });

  it("writes JSONL artifacts with one JSON object per line", async () => {
    const send = vi.fn(async () => ({}));
    const client: S3LikeClient = { send };

    await putJsonLinesArtifact(client, {
      bucket: "puddle-artifacts",
      storagePath: "/org/interviews/sess/events/agent_events.jsonl",
      rows: [{ event: "intro" }, { event: "closing" }],
    });

    const command = send.mock.calls[0]?.[0] as { input?: Record<string, unknown> };
    expect(command.input?.ContentType).toBe("application/x-ndjson");
    expect(command.input?.Body).toBe('{"event":"intro"}\n{"event":"closing"}\n');
  });

  it("delegates signed URL generation to the injected signer", async () => {
    const client: S3LikeClient = { send: async () => ({}) };
    const signer = vi.fn(async () => "https://signed.example/video.mp4");

    const url = await signedArtifactUrl(client, signer, {
      bucket: "puddle-artifacts",
      storagePath: "/org/interviews/sess/media/composite.mp4",
      expiresInSeconds: 900,
    });

    expect(url).toBe("https://signed.example/video.mp4");
    expect(signer).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: "puddle-artifacts",
          Key: "org/interviews/sess/media/composite.mp4",
        }),
      }),
      { expiresIn: 900 },
    );
  });
});
```

- [ ] **Step 3: Run the failing artifact store tests**

Run:

```bash
corepack pnpm@9.12.0 --filter @puddle/backend test -- artifact-store.test.ts
```

Expected:

```text
FAIL backend/test/artifact-store.test.ts
Error: Failed to resolve import "../src/storage/artifactStore.js"
```

- [ ] **Step 4: Implement the artifact store**

Create `backend/src/storage/artifactStore.ts`:

```ts
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3LikeClient {
  send(command: unknown): Promise<unknown>;
}

export type SignedUrlFn = (
  client: S3LikeClient,
  command: GetObjectCommand,
  options: { readonly expiresIn: number },
) => Promise<string>;

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

export async function signedArtifactUrl(
  client: S3LikeClient,
  signer: SignedUrlFn = getSignedUrl,
  input: {
    readonly bucket: string;
    readonly storagePath: string;
    readonly expiresInSeconds: number;
  },
): Promise<string> {
  return signer(
    client,
    new GetObjectCommand({
      Bucket: input.bucket,
      Key: artifactS3Key(input.storagePath),
    }),
    { expiresIn: input.expiresInSeconds },
  );
}
```

- [ ] **Step 5: Run artifact store tests**

Run:

```bash
corepack pnpm@9.12.0 --filter @puddle/backend test -- artifact-store.test.ts
```

Expected:

```text
PASS backend/test/artifact-store.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add backend/package.json pnpm-lock.yaml backend/src/storage/artifactStore.ts backend/test/artifact-store.test.ts
git commit -m "feat: add interview artifact s3 store"
```

---

### Task 2: Add Assessment Persistence

**Files:**
- Create: `backend/src/assessments/repository.ts`
- Test: `backend/test/assessments.test.ts`

- [ ] **Step 1: Write assessment repository tests**

Create `backend/test/assessments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assessmentBySessionStatement,
  assessmentUpsertStatement,
} from "../src/assessments/repository.js";

describe("assessment persistence", () => {
  it("upserts assessment JSON for a session", () => {
    const stmt = assessmentUpsertStatement({
      sessionId: "sess1",
      scriptVersion: "pilot-v1",
      categoryScores: [
        {
          category: "agency",
          score: 4,
          confidence: 0.91,
          evidenceQuotes: ["I owned the rollout"],
          rationale: "Strong ownership signal.",
          lowConfidence: false,
        },
      ],
      meetsBareMinimum: true,
      integrityFlags: [],
    });

    expect(stmt.sql).toContain("INSERT INTO assessments");
    expect(stmt.sql).toContain("ON CONFLICT (session_id) DO UPDATE");
    expect(stmt.params[0]).toBe("sess1");
    expect(stmt.params[1]).toBe("pilot-v1");
    expect(JSON.parse(String(stmt.params[2]))).toEqual([
      {
        category: "agency",
        score: 4,
        confidence: 0.91,
        evidence_quotes: ["I owned the rollout"],
        rationale: "Strong ownership signal.",
        low_confidence: false,
      },
    ]);
    expect(stmt.params[3]).toBe(true);
    expect(JSON.parse(String(stmt.params[4]))).toEqual([]);
  });

  it("queries one assessment by session", () => {
    const stmt = assessmentBySessionStatement("sess1");

    expect(stmt.sql).toContain("FROM assessments WHERE session_id = $1");
    expect(stmt.params).toEqual(["sess1"]);
  });
});
```

- [ ] **Step 2: Run failing assessment tests**

Run:

```bash
corepack pnpm@9.12.0 --filter @puddle/backend test -- assessments.test.ts
```

Expected:

```text
FAIL backend/test/assessments.test.ts
Error: Failed to resolve import "../src/assessments/repository.js"
```

- [ ] **Step 3: Implement assessment repository**

Create `backend/src/assessments/repository.ts`:

```ts
import type { SqlStatement } from "../consent/repository.js";

export interface CategoryScoreInput {
  readonly category: string;
  readonly score: number;
  readonly confidence: number;
  readonly evidenceQuotes: readonly string[];
  readonly rationale: string;
  readonly lowConfidence: boolean;
}

export interface AssessmentInput {
  readonly sessionId: string;
  readonly scriptVersion: string;
  readonly categoryScores: readonly CategoryScoreInput[];
  readonly meetsBareMinimum: boolean;
  readonly integrityFlags: readonly string[];
}

export interface AssessmentRow {
  readonly session_id: string;
  readonly script_version: string;
  readonly category_scores: unknown;
  readonly meets_bare_minimum: boolean;
  readonly integrity_flags: unknown;
  readonly reviewer_email: string | null;
  readonly signed_off_at: string | Date | null;
  readonly created_at: string | Date;
}

function categoryScoresJson(scores: readonly CategoryScoreInput[]): string {
  return JSON.stringify(
    scores.map((score) => ({
      category: score.category,
      score: score.score,
      confidence: score.confidence,
      evidence_quotes: score.evidenceQuotes,
      rationale: score.rationale,
      low_confidence: score.lowConfidence,
    })),
  );
}

export function assessmentUpsertStatement(input: AssessmentInput): SqlStatement {
  return {
    sql:
      "INSERT INTO assessments " +
      "(session_id, script_version, category_scores, meets_bare_minimum, integrity_flags) " +
      "VALUES ($1, $2, $3::jsonb, $4, $5::jsonb) " +
      "ON CONFLICT (session_id) DO UPDATE SET " +
      "script_version = EXCLUDED.script_version, " +
      "category_scores = EXCLUDED.category_scores, " +
      "meets_bare_minimum = EXCLUDED.meets_bare_minimum, " +
      "integrity_flags = EXCLUDED.integrity_flags",
    params: [
      input.sessionId,
      input.scriptVersion,
      categoryScoresJson(input.categoryScores),
      input.meetsBareMinimum,
      JSON.stringify(input.integrityFlags),
    ],
  };
}

export function assessmentBySessionStatement(sessionId: string): SqlStatement {
  return {
    sql:
      "SELECT session_id, script_version, category_scores, meets_bare_minimum, " +
      "integrity_flags, reviewer_email, signed_off_at, created_at " +
      "FROM assessments WHERE session_id = $1",
    params: [sessionId],
  };
}
```

- [ ] **Step 4: Run assessment tests**

Run:

```bash
corepack pnpm@9.12.0 --filter @puddle/backend test -- assessments.test.ts
```

Expected:

```text
PASS backend/test/assessments.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/assessments/repository.ts backend/test/assessments.test.ts
git commit -m "feat: persist interview assessments"
```

---

### Task 3: Add Review-Ready Gate

**Files:**
- Create: `backend/src/finalization/reviewReady.ts`
- Modify: `backend/src/livekit/webhooks.ts`
- Test: `backend/test/finalization.test.ts`

- [ ] **Step 1: Add review-ready tests**

Append to `backend/test/finalization.test.ts`:

```ts
import {
  REQUIRED_REVIEW_ARTIFACTS,
  reviewReadyArtifactStatusesStatement,
  sessionReviewReadyStatement,
  shouldMarkReviewReady,
} from "../src/finalization/reviewReady.js";

describe("review-ready gate", () => {
  it("requires composite, transcript, scores, integrity flags, and agent events", () => {
    expect(REQUIRED_REVIEW_ARTIFACTS).toEqual([
      "composite_video",
      "transcript",
      "scores",
      "integrity_flags",
      "agent_events",
    ]);
  });

  it("does not require separate raw participant media for MVP review readiness", () => {
    expect(
      shouldMarkReviewReady([
        { kind: "composite_video", status: "available" },
        { kind: "transcript", status: "available" },
        { kind: "scores", status: "available" },
        { kind: "integrity_flags", status: "available" },
        { kind: "agent_events", status: "available" },
        { kind: "candidate_audio", status: "expected" },
        { kind: "agent_audio", status: "expected" },
        { kind: "candidate_video", status: "expected" },
      ]),
    ).toBe(true);
  });

  it("keeps the session out of review when a required artifact is missing", () => {
    expect(
      shouldMarkReviewReady([
        { kind: "composite_video", status: "available" },
        { kind: "transcript", status: "available" },
        { kind: "scores", status: "available" },
        { kind: "integrity_flags", status: "available" },
      ]),
    ).toBe(false);
  });

  it("builds the artifact status query", () => {
    const stmt = reviewReadyArtifactStatusesStatement("sess1");
    expect(stmt.sql).toContain("FROM recording_artifacts");
    expect(stmt.params).toEqual(["sess1", REQUIRED_REVIEW_ARTIFACTS]);
  });

  it("builds the review-ready session update", () => {
    const stmt = sessionReviewReadyStatement("sess1");
    expect(stmt.sql).toContain("UPDATE sessions SET status = $2");
    expect(stmt.params).toEqual(["sess1", "review_ready"]);
  });
});
```

- [ ] **Step 2: Run failing review-ready tests**

Run:

```bash
corepack pnpm@9.12.0 --filter @puddle/backend test -- finalization.test.ts
```

Expected:

```text
FAIL backend/test/finalization.test.ts
Error: Failed to resolve import "../src/finalization/reviewReady.js"
```

- [ ] **Step 3: Implement review-ready gate**

Create `backend/src/finalization/reviewReady.ts`:

```ts
import type { Pool } from "pg";
import type { SqlStatement } from "../consent/repository.js";
import type {
  RecordingArtifactKind,
  RecordingArtifactStatus,
} from "../recordings/repository.js";
import { sessionStatusUpdateStatement } from "../scheduler/sessions.js";

export const REQUIRED_REVIEW_ARTIFACTS: readonly RecordingArtifactKind[] = [
  "composite_video",
  "transcript",
  "scores",
  "integrity_flags",
  "agent_events",
];

export interface ArtifactStatusRow {
  readonly kind: RecordingArtifactKind;
  readonly status: RecordingArtifactStatus;
}

export function reviewReadyArtifactStatusesStatement(sessionId: string): SqlStatement {
  return {
    sql:
      "SELECT kind, status FROM recording_artifacts " +
      "WHERE session_id = $1 AND kind = ANY($2::text[])",
    params: [sessionId, REQUIRED_REVIEW_ARTIFACTS as string[]],
  };
}

export function shouldMarkReviewReady(rows: readonly ArtifactStatusRow[]): boolean {
  const statuses = new Map(rows.map((row) => [row.kind, row.status]));
  return REQUIRED_REVIEW_ARTIFACTS.every((kind) => statuses.get(kind) === "available");
}

export function sessionReviewReadyStatement(sessionId: string): SqlStatement {
  return sessionStatusUpdateStatement(sessionId, "review_ready");
}

export async function markSessionReviewReadyIfComplete(
  pool: Pick<Pool, "query">,
  sessionId: string,
): Promise<boolean> {
  const statusStmt = reviewReadyArtifactStatusesStatement(sessionId);
  const result = await pool.query<ArtifactStatusRow>(statusStmt.sql, [
    ...statusStmt.params,
  ]);

  if (!shouldMarkReviewReady(result.rows)) {
    return false;
  }

  const updateStmt = sessionReviewReadyStatement(sessionId);
  await pool.query(updateStmt.sql, [...updateStmt.params]);
  return true;
}
```

- [ ] **Step 4: Call review-ready gate from LiveKit webhook**

Modify `backend/src/livekit/webhooks.ts`:

```ts
import { markSessionReviewReadyIfComplete } from "../finalization/reviewReady.js";
```

Inside `persistEgressWebhook`, after the existing `sessionStatusUpdateStatement(..., "recording_finalizing", ...)` query:

```ts
    await markSessionReviewReadyIfComplete(pool, sessionId);
```

- [ ] **Step 5: Run backend finalization tests**

Run:

```bash
corepack pnpm@9.12.0 --filter @puddle/backend test -- finalization.test.ts livekit-egress.test.ts
```

Expected:

```text
PASS backend/test/finalization.test.ts
PASS backend/test/livekit-egress.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/finalization/reviewReady.ts backend/src/livekit/webhooks.ts backend/test/finalization.test.ts
git commit -m "feat: add review ready artifact gate"
```

---

### Task 4: Add Backend Finalization Endpoint

**Files:**
- Create: `backend/src/finalization/persist.ts`
- Create: `backend/src/finalization/routes.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/test/finalization.test.ts`
- Test: `backend/test/server.test.ts`

- [ ] **Step 1: Write finalization persistence tests**

Append to `backend/test/finalization.test.ts`:

```ts
import {
  buildFinalizationArtifacts,
  type FinalizedInterviewInput,
} from "../src/finalization/persist.js";

describe("finalized interview artifact payload", () => {
  const finalized: FinalizedInterviewInput = {
    sessionId: "sess1",
    orgId: "org1",
    scriptVersion: "pilot-v1",
    transcriptTurns: [
      {
        turnIndex: 0,
        speaker: "agent",
        questionId: null,
        text: "Thanks for joining.",
      },
      {
        turnIndex: 1,
        speaker: "candidate",
        questionId: "q1",
        text: "I owned the rollout.",
      },
    ],
    assessment: {
      categoryScores: [
        {
          category: "agency",
          score: 4,
          confidence: 0.9,
          evidenceQuotes: ["I owned the rollout."],
          rationale: "Clear ownership.",
          lowConfidence: false,
        },
      ],
      meetsBareMinimum: true,
      integrityFlags: [],
    },
    agentEvents: [
      {
        session_id: "sess1",
        utterance: "Thanks for joining.",
        reason_code: "INTRO",
        question_id: null,
        category: null,
        missing_element: null,
      },
    ],
  };

  it("builds transcript, scores, integrity flags, and agent event artifacts", () => {
    const artifacts = buildFinalizationArtifacts(finalized);

    expect(artifacts.transcript.storagePath).toBe(
      "/org1/interviews/sess1/transcripts/transcript.v1.json",
    );
    expect(artifacts.transcript.body).toEqual({
      version: "v1",
      turns: finalized.transcriptTurns,
      byQuestion: {
        unassigned: [finalized.transcriptTurns[0]],
        q1: [finalized.transcriptTurns[1]],
      },
    });
    expect(artifacts.scores.storagePath).toBe(
      "/org1/interviews/sess1/assessment/scores.json",
    );
    expect(artifacts.integrityFlags.body).toEqual([]);
    expect(artifacts.agentEvents.rows).toEqual(finalized.agentEvents);
  });
});
```

- [ ] **Step 2: Run failing finalization tests**

Run:

```bash
corepack pnpm@9.12.0 --filter @puddle/backend test -- finalization.test.ts
```

Expected:

```text
FAIL backend/test/finalization.test.ts
Error: Failed to resolve import "../src/finalization/persist.js"
```

- [ ] **Step 3: Implement finalization persistence**

Create `backend/src/finalization/persist.ts`:

```ts
import type { Pool } from "pg";
import {
  assessmentUpsertStatement,
  type CategoryScoreInput,
} from "../assessments/repository.js";
import { assembleTranscript, type RawTurn } from "./transcript.js";
import { markSessionReviewReadyIfComplete } from "./reviewReady.js";
import {
  recordingArtifactStatusUpdateStatement,
  recordingArtifactUpsertStatement,
} from "../recordings/repository.js";
import { storagePaths } from "../storage/layout.js";
import {
  putJsonArtifact,
  putJsonLinesArtifact,
  type S3LikeClient,
} from "../storage/artifactStore.js";
import { transcriptTurnUpsertStatement } from "../transcripts/repository.js";

export interface FinalizedInterviewInput {
  readonly sessionId: string;
  readonly orgId: string;
  readonly scriptVersion: string;
  readonly transcriptTurns: readonly RawTurn[];
  readonly assessment: {
    readonly categoryScores: readonly CategoryScoreInput[];
    readonly meetsBareMinimum: boolean;
    readonly integrityFlags: readonly string[];
  };
  readonly agentEvents: readonly Record<string, unknown>[];
}

export function buildFinalizationArtifacts(input: FinalizedInterviewInput) {
  const paths = storagePaths(input.orgId, input.sessionId);
  const transcript = assembleTranscript(input.transcriptTurns);
  return {
    transcript: {
      storagePath: paths.transcripts.transcript,
      body: transcript,
    },
    scores: {
      storagePath: paths.assessment.scores,
      body: {
        session_id: input.sessionId,
        script_version: input.scriptVersion,
        category_scores: input.assessment.categoryScores,
        meets_bare_minimum: input.assessment.meetsBareMinimum,
      },
    },
    integrityFlags: {
      storagePath: paths.assessment.integrityFlags,
      body: input.assessment.integrityFlags,
    },
    agentEvents: {
      storagePath: paths.events.agentEvents,
      rows: input.agentEvents,
    },
  };
}

export async function persistFinalizedInterview(
  pool: Pick<Pool, "query">,
  s3: S3LikeClient,
  bucket: string,
  input: FinalizedInterviewInput,
): Promise<void> {
  const artifacts = buildFinalizationArtifacts(input);

  for (const turn of input.transcriptTurns) {
    const stmt = transcriptTurnUpsertStatement({
      sessionId: input.sessionId,
      turnIndex: turn.turnIndex,
      speaker: turn.speaker,
      questionId: turn.questionId,
      text: turn.text,
      source: "livekit-agent",
    });
    await pool.query(stmt.sql, [...stmt.params]);
  }

  const assessmentStmt = assessmentUpsertStatement({
    sessionId: input.sessionId,
    scriptVersion: input.scriptVersion,
    categoryScores: input.assessment.categoryScores,
    meetsBareMinimum: input.assessment.meetsBareMinimum,
    integrityFlags: input.assessment.integrityFlags,
  });
  await pool.query(assessmentStmt.sql, [...assessmentStmt.params]);

  await putJsonArtifact(s3, {
    bucket,
    storagePath: artifacts.transcript.storagePath,
    body: artifacts.transcript.body,
  });
  await putJsonArtifact(s3, {
    bucket,
    storagePath: artifacts.scores.storagePath,
    body: artifacts.scores.body,
  });
  await putJsonArtifact(s3, {
    bucket,
    storagePath: artifacts.integrityFlags.storagePath,
    body: artifacts.integrityFlags.body,
  });
  await putJsonLinesArtifact(s3, {
    bucket,
    storagePath: artifacts.agentEvents.storagePath,
    rows: artifacts.agentEvents.rows,
  });

  const artifactRows = [
    ["transcript", artifacts.transcript.storagePath, "application/json"],
    ["scores", artifacts.scores.storagePath, "application/json"],
    ["integrity_flags", artifacts.integrityFlags.storagePath, "application/json"],
    ["agent_events", artifacts.agentEvents.storagePath, "application/x-ndjson"],
  ] as const;

  for (const [kind, storagePath, contentType] of artifactRows) {
    const upsert = recordingArtifactUpsertStatement({
      sessionId: input.sessionId,
      kind,
      storagePath,
      contentType,
      status: "expected",
    });
    await pool.query(upsert.sql, [...upsert.params]);

    const update = recordingArtifactStatusUpdateStatement({
      sessionId: input.sessionId,
      kind,
      status: "available",
    });
    await pool.query(update.sql, [...update.params]);
  }

  await markSessionReviewReadyIfComplete(pool, input.sessionId);
}
```

- [ ] **Step 4: Implement finalization route**

Create `backend/src/finalization/routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { getPool } from "../db/pool.js";
import { createArtifactS3Client } from "../storage/artifactStore.js";
import {
  persistFinalizedInterview,
  type FinalizedInterviewInput,
} from "./persist.js";

interface FinalizationParams {
  readonly sessionId: string;
}

function artifactsBucketFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const bucket = env.PUDDLE_ARTIFACTS_BUCKET?.trim();
  if (!bucket) {
    throw new Error("PUDDLE_ARTIFACTS_BUCKET must be set to finalize interviews");
  }
  return bucket;
}

function hasMatchingSessionId(
  params: FinalizationParams,
  body: FinalizedInterviewInput | undefined,
): body is FinalizedInterviewInput {
  return Boolean(body?.sessionId && body.sessionId === params.sessionId);
}

export function registerFinalizationRoutes(app: FastifyInstance): void {
  app.post<{ Params: FinalizationParams; Body: FinalizedInterviewInput }>(
    "/internal/sessions/:sessionId/finalize",
    async (request, reply) => {
      if (!hasMatchingSessionId(request.params, request.body)) {
        return reply.code(400).send({ error: "session id mismatch" });
      }

      await persistFinalizedInterview(
        getPool(),
        createArtifactS3Client(),
        artifactsBucketFromEnv(),
        request.body,
      );

      return reply.code(202).send({ ok: true });
    },
  );
}
```

- [ ] **Step 5: Register finalization routes**

Modify `backend/src/server.ts`:

```ts
import { registerFinalizationRoutes } from "./finalization/routes.js";
```

Inside `buildServer`, after `registerInternalSessionRoutes(app);`:

```ts
  registerFinalizationRoutes(app);
```

- [ ] **Step 6: Run backend finalization tests**

Run:

```bash
corepack pnpm@9.12.0 --filter @puddle/backend test -- finalization.test.ts server.test.ts
```

Expected:

```text
PASS backend/test/finalization.test.ts
PASS backend/test/server.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/finalization/persist.ts backend/src/finalization/routes.ts backend/src/server.ts backend/test/finalization.test.ts backend/test/server.test.ts
git commit -m "feat: finalize interview packet artifacts"
```

---

### Task 5: Protect Internal GET Routes

**Files:**
- Modify: `backend/src/integration/internal-auth.ts`
- Test: `backend/test/integration.test.ts`

- [ ] **Step 1: Add internal GET auth test**

Append to `backend/test/integration.test.ts`:

```ts
import {
  internalRouteRequiresAuth,
} from "../src/integration/internal-auth.js";

describe("internal auth route matching", () => {
  it("requires auth for all internal routes regardless of method", () => {
    expect(internalRouteRequiresAuth("GET", "/internal/interviews")).toBe(true);
    expect(internalRouteRequiresAuth("POST", "/internal/sessions/sess1/finalize")).toBe(true);
    expect(internalRouteRequiresAuth("GET", "/healthz")).toBe(false);
  });
});
```

- [ ] **Step 2: Run failing internal auth test**

Run:

```bash
corepack pnpm@9.12.0 --filter @puddle/backend test -- integration.test.ts
```

Expected:

```text
FAIL backend/test/integration.test.ts
Error: internalRouteRequiresAuth is not exported
```

- [ ] **Step 3: Implement internal GET auth matching**

Modify `backend/src/integration/internal-auth.ts`:

```ts
const PROTECTED_POST_PATHS = [
  "/integration/",
  "/candidate/invites/",
] as const;

export function internalRouteRequiresAuth(method: string, url: string): boolean {
  if (url.startsWith("/internal/")) {
    return true;
  }

  if (method !== "POST") {
    return false;
  }

  if (url === "/sessions") {
    return true;
  }

  return PROTECTED_POST_PATHS.some((path) => url.startsWith(path));
}

function requiresInternalAuth(request: FastifyRequest): boolean {
  return internalRouteRequiresAuth(request.method, request.url);
}
```

- [ ] **Step 4: Run internal auth tests**

Run:

```bash
corepack pnpm@9.12.0 --filter @puddle/backend test -- integration.test.ts server.test.ts
```

Expected:

```text
PASS backend/test/integration.test.ts
PASS backend/test/server.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/integration/internal-auth.ts backend/test/integration.test.ts
git commit -m "fix: require auth for internal dashboard reads"
```

---

### Task 6: Post Finalization From Agent

**Files:**
- Modify: `agent/src/agent/controller/interview.py`
- Modify: `agent/src/agent/worker/backend_status.py`
- Modify: `agent/src/agent/worker/entrypoint.py`
- Test: `agent/tests/test_interview_runner.py`
- Test: `agent/tests/test_worker_entrypoint.py`

- [ ] **Step 1: Add transcript accessor test**

Append to `agent/tests/test_interview_runner.py`:

```py
def test_runner_exposes_transcript_after_turns(fake_runner_with_completed_turns):
    turns = fake_runner_with_completed_turns.transcript_turns()

    assert turns
    assert turns[0].turn_index == 0
    assert turns[0].speaker in {"agent", "candidate"}
```

If the test suite does not already expose `fake_runner_with_completed_turns`, create it in the same file by reusing the existing fake voice/scorer fixtures and running the runner through one short rubric question.

- [ ] **Step 2: Implement transcript accessor**

Modify `agent/src/agent/controller/interview.py` inside `InterviewRunner`:

```py
    def transcript_turns(self) -> list[TranscriptTurn]:
        """Return a copy of the transcript turns captured so far."""
        return list(self._transcript)
```

- [ ] **Step 3: Add backend finalization client**

Modify `agent/src/agent/worker/backend_status.py`:

```py
def _post_interview_finalization_sync(
    session_id: str,
    payload: dict[str, Any],
) -> None:
    request = urllib.request.Request(
        f"{_backend_base_url()}/internal/sessions/{session_id}/finalize",
        data=json.dumps(payload).encode("utf-8"),
        headers=_backend_headers(),
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status >= 400:
            raise RuntimeError(f"backend returned status {response.status}")


async def post_interview_finalization(
    session_id: str,
    payload: dict[str, Any],
) -> None:
    """Persist the completed interview packet after the controller finishes."""
    try:
        await asyncio.to_thread(_post_interview_finalization_sync, session_id, payload)
    except (OSError, urllib.error.URLError, RuntimeError) as exc:
        logger.warning(
            "backend interview finalization report failed",
            extra={"session_id": session_id, "error": str(exc)},
        )
```

- [ ] **Step 4: Post finalization after successful interview run**

Modify `agent/src/agent/worker/entrypoint.py` in `_default_run_interview`:

```py
    from agent.worker.backend_status import post_interview_finalization
```

Replace:

```py
        await runner.run(session_id=ctx.session_id)
```

With:

```py
        assessment = await runner.run(session_id=ctx.session_id)
        await post_interview_finalization(
            ctx.session_id,
            {
                "sessionId": ctx.session_id,
                "orgId": ctx.org_id,
                "scriptVersion": ctx.script_version,
                "transcriptTurns": [
                    {
                        "turnIndex": turn.turn_index,
                        "speaker": turn.speaker,
                        "questionId": turn.question_id,
                        "text": turn.text,
                    }
                    for turn in runner.transcript_turns()
                ],
                "assessment": {
                    "categoryScores": [
                        {
                            "category": score.category,
                            "score": score.score,
                            "confidence": score.confidence,
                            "evidenceQuotes": score.evidence_quotes,
                            "rationale": score.rationale,
                            "lowConfidence": score.low_confidence,
                        }
                        for score in assessment.category_scores
                    ],
                    "meetsBareMinimum": assessment.meets_bare_minimum,
                    "integrityFlags": assessment.integrity_flags,
                },
                "agentEvents": [
                    event.model_dump(mode="json") for event in event_log.events()
                ],
            },
        )
```

Before constructing `runner`, assign the event log to a variable:

```py
    event_log = EventLog(
        session_id=ctx.session_id,
        path=repo_root / "artifacts" / ctx.session_id / "agent_events.jsonl",
    )
```

Then pass `event_log=event_log` into `InterviewRunner`.

- [ ] **Step 5: Run agent tests**

Run:

```bash
cd agent && uv run pytest tests/test_interview_runner.py tests/test_worker_entrypoint.py
```

Expected:

```text
passed
```

- [ ] **Step 6: Commit**

```bash
git add agent/src/agent/controller/interview.py agent/src/agent/worker/backend_status.py agent/src/agent/worker/entrypoint.py agent/tests/test_interview_runner.py agent/tests/test_worker_entrypoint.py
git commit -m "feat: post finalized interview packets from agent"
```

---

### Task 7: Add Backend Dashboard Read Routes

**Files:**
- Create: `backend/src/dashboard/interviews.ts`
- Create: `backend/src/dashboard/routes.ts`
- Modify: `backend/src/server.ts`
- Test: `backend/test/dashboard-interviews.test.ts`

- [ ] **Step 1: Write dashboard read model tests**

Create `backend/test/dashboard-interviews.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  interviewDetailStatement,
  interviewListStatement,
} from "../src/dashboard/interviews.js";

describe("dashboard interview read model", () => {
  it("queries recent interview packets", () => {
    const stmt = interviewListStatement({ limit: 25 });

    expect(stmt.sql).toContain("FROM sessions s");
    expect(stmt.sql).toContain("LEFT JOIN recordings r");
    expect(stmt.sql).toContain("LEFT JOIN assessments a");
    expect(stmt.sql).toContain("LIMIT $1");
    expect(stmt.params).toEqual([25]);
  });

  it("queries one interview packet detail", () => {
    const stmt = interviewDetailStatement("sess1");

    expect(stmt.sql).toContain("WHERE s.session_id = $1");
    expect(stmt.sql).toContain("json_agg");
    expect(stmt.params).toEqual(["sess1"]);
  });
});
```

- [ ] **Step 2: Implement dashboard query builders**

Create `backend/src/dashboard/interviews.ts`:

```ts
import type { SqlStatement } from "../consent/repository.js";

export function interviewListStatement(input: { readonly limit: number }): SqlStatement {
  return {
    sql:
      "SELECT s.session_id, s.org_id, s.candidate_email, s.script_version, " +
      "s.status, s.room_name, s.scheduled_at, s.started_at, s.ended_at, " +
      "r.status AS recording_status, r.egress_id, " +
      "a.category_scores, a.meets_bare_minimum, a.integrity_flags, " +
      "a.reviewer_email, a.signed_off_at " +
      "FROM sessions s " +
      "LEFT JOIN recordings r ON r.session_id = s.session_id " +
      "LEFT JOIN assessments a ON a.session_id = s.session_id " +
      "ORDER BY COALESCE(s.started_at, s.scheduled_at, s.created_at) DESC " +
      "LIMIT $1",
    params: [input.limit],
  };
}

export function interviewDetailStatement(sessionId: string): SqlStatement {
  return {
    sql:
      "SELECT s.session_id, s.org_id, s.candidate_email, s.script_version, " +
      "s.status, s.room_name, s.scheduled_at, s.started_at, s.ended_at, " +
      "r.status AS recording_status, r.egress_id, r.error_message, " +
      "a.category_scores, a.meets_bare_minimum, a.integrity_flags, " +
      "a.reviewer_email, a.signed_off_at, " +
      "COALESCE(json_agg(DISTINCT jsonb_build_object(" +
      "'kind', ra.kind, 'status', ra.status, 'storagePath', ra.storage_path, " +
      "'contentType', ra.content_type, 'sizeBytes', ra.size_bytes, " +
      "'durationSeconds', ra.duration_seconds" +
      ")) FILTER (WHERE ra.kind IS NOT NULL), '[]'::json) AS artifacts, " +
      "COALESCE(json_agg(DISTINCT jsonb_build_object(" +
      "'turnIndex', tt.turn_index, 'speaker', tt.speaker, 'questionId', tt.question_id, " +
      "'text', tt.text, 'occurredAt', tt.occurred_at, 'offsetMs', tt.offset_ms" +
      ")) FILTER (WHERE tt.turn_index IS NOT NULL), '[]'::json) AS transcript_turns " +
      "FROM sessions s " +
      "LEFT JOIN recordings r ON r.session_id = s.session_id " +
      "LEFT JOIN assessments a ON a.session_id = s.session_id " +
      "LEFT JOIN recording_artifacts ra ON ra.session_id = s.session_id " +
      "LEFT JOIN transcript_turns tt ON tt.session_id = s.session_id " +
      "WHERE s.session_id = $1 " +
      "GROUP BY s.session_id, r.session_id, a.session_id",
    params: [sessionId],
  };
}
```

- [ ] **Step 3: Implement dashboard routes**

Create `backend/src/dashboard/routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { getPool } from "../db/pool.js";
import { interviewDetailStatement, interviewListStatement } from "./interviews.js";
import {
  createArtifactS3Client,
  signedArtifactUrl,
} from "../storage/artifactStore.js";

const SIGNED_URL_TTL_SECONDS = 15 * 60;

function artifactsBucketFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const bucket = env.PUDDLE_ARTIFACTS_BUCKET?.trim();
  if (!bucket) {
    throw new Error("PUDDLE_ARTIFACTS_BUCKET must be set for dashboard media URLs");
  }
  return bucket;
}

export function registerDashboardRoutes(app: FastifyInstance): void {
  app.get("/internal/interviews", async (_request, reply) => {
    const stmt = interviewListStatement({ limit: 100 });
    const result = await getPool().query(stmt.sql, [...stmt.params]);
    return reply.code(200).send({ interviews: result.rows });
  });

  app.get<{ Params: { sessionId: string } }>(
    "/internal/interviews/:sessionId",
    async (request, reply) => {
      const stmt = interviewDetailStatement(request.params.sessionId);
      const result = await getPool().query(stmt.sql, [...stmt.params]);
      const packet = result.rows[0];
      if (!packet) {
        return reply.code(404).send({ error: "interview not found" });
      }

      const artifacts = Array.isArray(packet.artifacts) ? packet.artifacts : [];
      const composite = artifacts.find(
        (artifact: { kind?: string; status?: string }) =>
          artifact.kind === "composite_video" && artifact.status === "available",
      );
      const compositeVideoUrl = composite?.storagePath
        ? await signedArtifactUrl(createArtifactS3Client(), undefined, {
            bucket: artifactsBucketFromEnv(),
            storagePath: composite.storagePath,
            expiresInSeconds: SIGNED_URL_TTL_SECONDS,
          })
        : null;

      return reply.code(200).send({ interview: { ...packet, compositeVideoUrl } });
    },
  );
}
```

- [ ] **Step 4: Register dashboard routes**

Modify `backend/src/server.ts`:

```ts
import { registerDashboardRoutes } from "./dashboard/routes.js";
```

Inside `buildServer`, after `registerFinalizationRoutes(app);`:

```ts
  registerDashboardRoutes(app);
```

- [ ] **Step 5: Run dashboard backend tests**

Run:

```bash
corepack pnpm@9.12.0 --filter @puddle/backend test -- dashboard-interviews.test.ts server.test.ts
```

Expected:

```text
PASS backend/test/dashboard-interviews.test.ts
PASS backend/test/server.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/dashboard/interviews.ts backend/src/dashboard/routes.ts backend/src/server.ts backend/test/dashboard-interviews.test.ts backend/test/server.test.ts
git commit -m "feat: expose real interview dashboard packets"
```

---

### Task 8: Render Real Dashboard Packets In Platform

**Files:**
- Create: `platform/app/dashboard/backend-data.ts`
- Modify: `platform/app/dashboard/page.tsx`
- Modify: `platform/app/dashboard/DashboardSections.tsx`
- Modify: `platform/app/dashboard/interviews/[sessionId]/page.tsx`

- [ ] **Step 1: Add platform backend data client**

Create `platform/app/dashboard/backend-data.ts`:

```ts
function backendBaseUrl(): string {
  return (process.env.PUDDLE_BACKEND_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
}

function backendHeaders(): HeadersInit {
  const token = process.env.PUDDLE_BACKEND_INTERNAL_TOKEN?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export interface RealInterviewListItem {
  readonly session_id: string;
  readonly org_id: string;
  readonly candidate_email: string;
  readonly script_version: string;
  readonly status: string;
  readonly room_name: string | null;
  readonly scheduled_at: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly recording_status: string | null;
  readonly egress_id: string | null;
  readonly category_scores: unknown;
  readonly meets_bare_minimum: boolean | null;
  readonly integrity_flags: unknown;
  readonly reviewer_email: string | null;
  readonly signed_off_at: string | null;
}

export interface RealInterviewDetail extends RealInterviewListItem {
  readonly error_message: string | null;
  readonly artifacts: readonly {
    readonly kind: string;
    readonly status: string;
    readonly storagePath: string;
    readonly contentType: string;
    readonly sizeBytes: number | null;
    readonly durationSeconds: number | null;
  }[];
  readonly transcript_turns: readonly {
    readonly turnIndex: number;
    readonly speaker: "agent" | "candidate";
    readonly questionId: string | null;
    readonly text: string;
    readonly occurredAt: string;
    readonly offsetMs: number | null;
  }[];
  readonly compositeVideoUrl: string | null;
}

export async function getRealInterviews(): Promise<readonly RealInterviewListItem[]> {
  const response = await fetch(`${backendBaseUrl()}/internal/interviews`, {
    headers: backendHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`backend returned ${response.status}`);
  }

  const payload = (await response.json()) as {
    readonly interviews?: readonly RealInterviewListItem[];
  };
  return payload.interviews ?? [];
}

export async function getRealInterview(
  sessionId: string,
): Promise<RealInterviewDetail | null> {
  const response = await fetch(
    `${backendBaseUrl()}/internal/interviews/${encodeURIComponent(sessionId)}`,
    {
      headers: backendHeaders(),
      cache: "no-store",
    },
  );

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`backend returned ${response.status}`);
  }

  const payload = (await response.json()) as { readonly interview?: RealInterviewDetail };
  return payload.interview ?? null;
}
```

- [ ] **Step 2: Modify dashboard sections to accept real packet props**

Modify `platform/app/dashboard/DashboardSections.tsx` by adding:

```ts
import type { RealInterviewListItem } from "./backend-data";
```

Update `NeedsReviewQueue` signature:

```ts
export function NeedsReviewQueue({
  realInterviews,
  packets = getReviewPackets(),
  limit,
  actionHref = "/dashboard/review-queue",
  actionLabel = "View queue",
}: {
  readonly realInterviews?: readonly RealInterviewListItem[];
  readonly packets?: readonly ReviewPacket[];
  readonly limit?: number;
  readonly actionHref?: string;
  readonly actionLabel?: string;
}) {
```

Before existing fixture rendering:

```tsx
  if (realInterviews) {
    const visible = typeof limit === "number" ? realInterviews.slice(0, limit) : realInterviews;
    return (
      <SectionPanel
        title="Interview packets needing review"
        eyebrow="Human review queue"
        action={<Link href={actionHref} className={secondaryButtonClass}>{actionLabel}</Link>}
      >
        {visible.length ? (
          <TableScroller>
            <table className="min-w-[980px] w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className={`${tableHeaderClass} rounded-l-md px-3 py-2`}>Candidate</th>
                  <th className={`${tableHeaderClass} px-3 py-2`}>Status</th>
                  <th className={`${tableHeaderClass} px-3 py-2`}>Recording</th>
                  <th className={`${tableHeaderClass} px-3 py-2`}>Score</th>
                  <th className={`${tableHeaderClass} rounded-r-md px-3 py-2`}>Action</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((interview) => (
                  <tr key={interview.session_id}>
                    <td className={`${tableCellClass} font-medium text-slate-950`}>
                      <Link href={`/dashboard/interviews/${interview.session_id}`} className="hover:text-cyan-700">
                        {interview.candidate_email}
                      </Link>
                      <div className="mt-0.5 text-xs font-normal text-slate-500">{interview.session_id}</div>
                    </td>
                    <td className={tableCellClass}><StatusPill status={interview.status} /></td>
                    <td className={tableCellClass}>{interview.recording_status ?? "Not started"}</td>
                    <td className={tableCellClass}>{interview.meets_bare_minimum === null ? "Pending" : interview.meets_bare_minimum ? "Meets bar" : "Below bar"}</td>
                    <td className={tableCellClass}>
                      <Link href={`/dashboard/interviews/${interview.session_id}`} className="font-medium text-cyan-700 hover:text-cyan-900">
                        Open review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        ) : (
          <EmptyState title="No interviews yet" detail="Real interview packets appear here after candidates join." />
        )}
      </SectionPanel>
    );
  }
```

- [ ] **Step 3: Load real packets on dashboard home**

Modify `platform/app/dashboard/page.tsx`:

```ts
import { getRealInterviews } from "./backend-data";
```

Change component signature and fetch:

```tsx
export default async function DashboardPage() {
  const realInterviews = await getRealInterviews().catch(() => undefined);
```

Render:

```tsx
          <NeedsReviewQueue realInterviews={realInterviews} />
```

- [ ] **Step 4: Render real video and transcript on detail page**

Modify `platform/app/dashboard/interviews/[sessionId]/page.tsx`:

```ts
import { getRealInterview } from "../backend-data";
```

Use the correct relative import from `[sessionId]`:

```ts
import { getRealInterview } from "../../backend-data";
```

At the top of `InterviewSessionPage`, before demo fallback:

```tsx
  const realInterview = await getRealInterview(sessionId).catch(() => null);
  if (realInterview) {
    return (
      <div className="mx-auto grid min-w-0 max-w-[1440px] gap-5">
        <header className="rounded-md border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <StatusPill status={realInterview.status} />
          <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">{realInterview.candidate_email}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Real interview packet for {realInterview.session_id}.</p>
        </header>

        <SectionPanel title="Video and audio review" eyebrow="Recording">
          {realInterview.compositeVideoUrl ? (
            <video className="aspect-video w-full rounded-md bg-slate-950" controls src={realInterview.compositeVideoUrl} />
          ) : (
            <EmptyState title="Recording unavailable" detail="The composite recording has not finished or no signed URL was available." />
          )}
        </SectionPanel>

        <SectionPanel title="Transcript and evidence" eyebrow="Transcript">
          {realInterview.transcript_turns.length ? (
            <div className="grid gap-3">
              {realInterview.transcript_turns
                .slice()
                .sort((a, b) => a.turnIndex - b.turnIndex)
                .map((turn) => (
                  <article key={turn.turnIndex} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status={turn.speaker} />
                      {turn.questionId ? <span className="text-xs text-slate-500">{turn.questionId}</span> : null}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{turn.text}</p>
                  </article>
                ))}
            </div>
          ) : (
            <EmptyState title="Transcript unavailable" detail="Transcript turns appear after agent finalization completes." />
          )}
        </SectionPanel>
      </div>
    );
  }
```

- [ ] **Step 5: Build platform**

Run:

```bash
corepack pnpm@9.12.0 --filter @puddle/platform build
```

Expected:

```text
Compiled successfully
```

- [ ] **Step 6: Commit**

```bash
git add platform/app/dashboard/backend-data.ts platform/app/dashboard/page.tsx platform/app/dashboard/DashboardSections.tsx platform/app/dashboard/interviews/\[sessionId\]/page.tsx
git commit -m "feat: render real interview packets in dashboard"
```

---

### Task 9: End-To-End Verification

**Files:**
- No new source files.
- Verify deployed/local behavior.

- [ ] **Step 1: Run backend tests**

Run:

```bash
corepack pnpm@9.12.0 --filter @puddle/backend test
```

Expected:

```text
PASS
```

- [ ] **Step 2: Run agent tests**

Run:

```bash
cd agent && uv run pytest
```

Expected:

```text
passed
```

- [ ] **Step 3: Run platform build**

Run:

```bash
corepack pnpm@9.12.0 --filter @puddle/platform build
```

Expected:

```text
Compiled successfully
```

- [ ] **Step 4: Run one live smoke interview**

With production-like env and `PUDDLE_RECORDINGS_ENABLED=true`, create an invite, join it, publish camera/mic for 30-60 seconds, and leave.

Expected S3 keys:

```text
<orgId>/interviews/<sessionId>/media/composite.mp4
<orgId>/interviews/<sessionId>/transcripts/transcript.v1.json
<orgId>/interviews/<sessionId>/assessment/scores.json
<orgId>/interviews/<sessionId>/assessment/integrity_flags.json
<orgId>/interviews/<sessionId>/events/agent_events.jsonl
```

- [ ] **Step 5: Verify Postgres packet state**

Run against the deployed database:

```sql
select session_id, status, room_name, started_at, ended_at
from sessions
where session_id = '<session-id>';

select kind, status, storage_path, size_bytes, duration_seconds
from recording_artifacts
where session_id = '<session-id>'
order by kind;

select count(*) as transcript_turns
from transcript_turns
where session_id = '<session-id>';

select session_id, script_version, meets_bare_minimum, category_scores, integrity_flags
from assessments
where session_id = '<session-id>';
```

Expected:

```text
sessions.status is review_ready after both egress and agent finalization complete.
composite_video, transcript, scores, integrity_flags, and agent_events are available.
transcript_turns count is greater than 0.
assessments has one row for the session.
```

- [ ] **Step 6: Verify dashboard detail page**

Open:

```text
https://app.usepuddle.com/dashboard/interviews/<session-id>
```

Expected:

```text
The page renders the real candidate email, real session id, a playable composite video, transcript turns, and score/recommendation state when available.
```

- [ ] **Step 7: Commit verification notes**

Create `docs/superpowers/verification/2026-06-10-complete-interview-artifacts.md` with:

```markdown
# Complete Interview Artifacts Verification

Session ID: <session-id>
Artifact bucket: puddle-videoagent-artifacts-851725544921-us-west-1
Composite video key: <key>
Transcript key: <key>
Scores key: <key>
Dashboard URL: https://app.usepuddle.com/dashboard/interviews/<session-id>

Backend tests: passing
Agent tests: passing
Platform build: passing
```

Commit:

```bash
git add docs/superpowers/verification/2026-06-10-complete-interview-artifacts.md
git commit -m "docs: record complete interview artifact verification"
```

---

## Follow-Up Plan: Separate Raw Media

Create a separate plan if raw per-participant media becomes mandatory. That plan should add participant or track egress for:

- candidate audio
- candidate video
- agent audio

The separate-media plan should start by proving deterministic participant identities:

- candidate identity is currently `candidate-${inviteId}`
- agent identity must be confirmed from LiveKit Agents runtime metadata or explicitly set if LiveKit supports it in our worker version

Then it should add lifecycle-safe egress start/stop behavior after tracks are published. Do not block review-ready on these separate media artifacts until the product explicitly requires them.

## Self-Review

Spec coverage:

- RoomComposite remains the review video artifact.
- Transcript persistence is implemented through agent finalization.
- Scores and integrity flags are persisted to Postgres and S3.
- Agent events are persisted to S3.
- Real dashboard read/render path is included.
- Separate raw audio/video is deliberately split into a follow-up plan and is not part of MVP review readiness.

Placeholder scan:

- No task contains unresolved placeholder language or an undefined follow-up inside the implementation scope.

Type consistency:

- Backend uses camelCase API payloads from the agent and converts to snake_case SQL JSON where existing tables expect it.
- Transcript turn payload fields match `RawTurn` from `backend/src/finalization/transcript.ts`.
- Artifact kinds match `RecordingArtifactKind` in `backend/src/recordings/repository.ts`.
