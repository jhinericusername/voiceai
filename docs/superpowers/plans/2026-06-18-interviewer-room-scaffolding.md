# Interviewer Room Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a host/interviewer room path where a same-org dashboard user creates an interview, copies a candidate invite URL, joins the LiveKit room as an interviewer, and records AI Start/Stop/Resume intent.

**Architecture:** Keep the candidate invite route candidate-only and add authenticated interviewer-only platform/backend routes. Backend tokens carry explicit participant roles; interviewer joins prepare the LiveKit room without dispatching the AI worker, candidate joins skip auto-dispatch when a human interviewer has already joined, and AI control endpoints persist requested state/events without controlling the worker.

**Tech Stack:** Next.js App Router, WorkOS/AuthKit, LiveKit client/server SDKs, Fastify, Postgres migrations, Vitest, Node source tests.

---

## File Structure

Backend files:

- Modify `backend/src/livekit/token.ts`: add participant metadata helpers and `buildInterviewerJoinToken`.
- Modify `backend/src/livekit/provision.ts`: raise room capacity and support room readiness without AI dispatch.
- Create `backend/migrations/015_interviewer_ai_control_state.sql`: persist latest AI requested state per session.
- Create `backend/src/interviewers/repository.ts`: SQL builders for interviewer session lookup, candidate invite minting, interviewer activity checks, and AI control state.
- Create `backend/src/interviewers/routes.ts`: internal backend routes for candidate invite creation, interviewer LiveKit join, and AI control intent.
- Modify `backend/src/invites/routes.ts`: skip AI auto-dispatch when an interviewer has already joined.
- Modify `backend/src/server.ts`: register interviewer routes.
- Modify tests: `backend/test/invites.test.ts`, `backend/test/livekit-egress.test.ts`, `backend/test/migrations.test.ts`.
- Create `backend/test/interviewers.test.ts`: repository, token, and route behavior tests.

Platform files:

- Create `platform/app/dashboard/interviews/[sessionId]/join/page.tsx`: authenticated full-screen interviewer pre-call route.
- Create `platform/app/dashboard/interviews/[sessionId]/join/InterviewerJoinClient.tsx`: host pre-call, candidate-link copy, LiveKit join, and AI control UI.
- Create `platform/app/api/dashboard/interviews/[sessionId]/candidate-invite/route.ts`: same-org platform route that mints a candidate invite URL.
- Create `platform/app/api/dashboard/interviews/[sessionId]/interviewer-join/route.ts`: same-org platform route that returns interviewer LiveKit credentials.
- Create `platform/app/api/dashboard/interviews/[sessionId]/ai-control/route.ts`: same-org platform route that records AI control intent.
- Modify `platform/app/dashboard/roles/[roleId]/page.tsx`: add the host launch card.
- Create `platform/app/dashboard/roles/[roleId]/CreateAndJoinInterviewForm.tsx`: client form that collects candidate email, creates the interview, and navigates host to the join route.
- Modify `platform/app/api/interviews/route.ts`: return `interviewerJoinUrl` alongside the existing candidate invite response.
- Create `platform/tests/interviewer-room-source.test.mjs`: source tests for route guards, candidate link creation, role metadata, and host UI copy.
- Modify `platform/tests/org-access-source.test.mjs`: include the new dashboard API routes in org/readiness guard checks.

Implementation note: the interviewer route remains under `/dashboard/interviews/[sessionId]/join`, but the page renders a fixed full-screen surface so the dashboard chrome is visually replaced without moving every dashboard route into a route group.

---

### Task 1: Role-Aware LiveKit Primitives

**Files:**
- Modify: `backend/src/livekit/token.ts`
- Modify: `backend/src/livekit/provision.ts`
- Modify: `backend/test/invites.test.ts`
- Modify: `backend/test/livekit-egress.test.ts`

- [ ] **Step 1: Add failing token tests for candidate metadata and interviewer tokens**

Append to `backend/test/invites.test.ts` inside `describe("candidate LiveKit tokens", ...)`:

```ts
  it("includes candidate participant metadata in the join token", async () => {
    const token = await buildCandidateJoinToken(
      { host: "wss://livekit.example", apiKey: "key", apiSecret: "secret" },
      {
        sessionId: "sess1",
        room: "interview-sess1",
        inviteId: "invite1",
        candidateEmail: "candidate@example.com",
        ttlSeconds: 60,
      },
    );
    const verifier = new TokenVerifier("key", "secret");
    const claims = await verifier.verify(token);

    expect(JSON.parse(String(claims.metadata))).toEqual({
      session_id: "sess1",
      invite_id: "invite1",
      participant_kind: "candidate",
    });
  });
```

Add this import at the top of `backend/test/invites.test.ts`:

```ts
import { buildCandidateJoinToken, buildInterviewerJoinToken } from "../src/livekit/token.js";
```

Replace the existing single-function import for `buildCandidateJoinToken`.

Append a new test:

```ts
describe("interviewer LiveKit tokens", () => {
  it("scopes the join token to the interviewer room with interviewer metadata", async () => {
    const token = await buildInterviewerJoinToken(
      { host: "wss://livekit.example", apiKey: "key", apiSecret: "secret" },
      {
        sessionId: "sess1",
        room: "interview-sess1",
        interviewerUserId: "user_123",
        interviewerEmail: "host@workweave.ai",
        ttlSeconds: 60,
      },
    );
    const verifier = new TokenVerifier("key", "secret");
    const claims = await verifier.verify(token);

    expect(claims.sub).toBe("interviewer-sess1-user_123");
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.room).toBe("interview-sess1");
    expect(claims.name).toBe("host@workweave.ai");
    expect(JSON.parse(String(claims.metadata))).toEqual({
      session_id: "sess1",
      interviewer_user_id: "user_123",
      participant_kind: "interviewer",
    });
  });
});
```

- [ ] **Step 2: Run token tests and verify they fail**

Run:

```bash
pnpm --filter @puddle/backend test -- backend/test/invites.test.ts
```

Expected: FAIL because `buildInterviewerJoinToken` is not exported.

- [ ] **Step 3: Implement interviewer token builder and metadata helper**

Replace `backend/src/livekit/token.ts` with:

```ts
import { AccessToken } from "livekit-server-sdk";
import type { LiveKitConfig } from "./provision.js";

const DEFAULT_JOIN_TOKEN_TTL_SECONDS = 15 * 60;

export type ParticipantKind = "candidate" | "interviewer";

export interface CandidateTokenInput {
  readonly sessionId: string;
  readonly room: string;
  readonly inviteId: string;
  readonly candidateEmail: string;
  readonly ttlSeconds?: number;
}

export interface InterviewerTokenInput {
  readonly sessionId: string;
  readonly room: string;
  readonly interviewerUserId: string;
  readonly interviewerEmail: string;
  readonly ttlSeconds?: number;
}

function addRoomGrant(token: AccessToken, room: string): void {
  token.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
}

export async function buildCandidateJoinToken(
  config: LiveKitConfig,
  input: CandidateTokenInput,
): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: `candidate-${input.inviteId}`,
    name: input.candidateEmail,
    ttl: input.ttlSeconds ?? DEFAULT_JOIN_TOKEN_TTL_SECONDS,
    metadata: JSON.stringify({
      session_id: input.sessionId,
      invite_id: input.inviteId,
      participant_kind: "candidate",
    }),
  });

  addRoomGrant(token, input.room);
  return token.toJwt();
}

export async function buildInterviewerJoinToken(
  config: LiveKitConfig,
  input: InterviewerTokenInput,
): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: `interviewer-${input.sessionId}-${input.interviewerUserId}`,
    name: input.interviewerEmail,
    ttl: input.ttlSeconds ?? DEFAULT_JOIN_TOKEN_TTL_SECONDS,
    metadata: JSON.stringify({
      session_id: input.sessionId,
      interviewer_user_id: input.interviewerUserId,
      participant_kind: "interviewer",
    }),
  });

  addRoomGrant(token, input.room);
  return token.toJwt();
}
```

- [ ] **Step 4: Run token tests and verify they pass**

Run:

```bash
pnpm --filter @puddle/backend test -- backend/test/invites.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add failing room readiness tests for capacity and no-dispatch mode**

In `backend/test/livekit-egress.test.ts`, update the existing room creation expectation from `maxParticipants: 3` to:

```ts
        maxParticipants: 8,
```

Append inside `describe("LiveKit room readiness", ...)`:

```ts
  it("can prepare an interviewer-led room without dispatching the AI interviewer", async () => {
    const createdRooms: unknown[] = [];
    const createdDispatches: unknown[] = [];
    const rooms = {
      listRooms: async () => [],
      createRoom: async (options: unknown) => {
        createdRooms.push(options);
      },
    };
    const dispatch = {
      listDispatch: async () => [],
      createDispatch: async (room: string, agentName: string, options: unknown) => {
        createdDispatches.push({ room, agentName, options });
      },
    };

    const result = await ensureRoomReady(liveKitConfig, "sess1", "{\"session_id\":\"sess1\"}", {
      rooms,
      dispatch,
      dispatchAgent: false,
    });

    expect(result).toEqual({
      room: "interview-sess1",
      roomCreated: true,
      dispatchCreated: false,
      roomRecreated: false,
    });
    expect(createdRooms).toHaveLength(1);
    expect(createdDispatches).toEqual([]);
  });
```

- [ ] **Step 6: Run room readiness tests and verify they fail**

Run:

```bash
pnpm --filter @puddle/backend test -- backend/test/livekit-egress.test.ts
```

Expected: FAIL because capacity is still `3` and `dispatchAgent` is not supported.

- [ ] **Step 7: Implement room capacity and dispatch toggle**

In `backend/src/livekit/provision.ts`, change:

```ts
const ROOM_DEPARTURE_TIMEOUT_SECONDS = 300;
```

to:

```ts
const ROOM_DEPARTURE_TIMEOUT_SECONDS = 300;
const ROOM_MAX_PARTICIPANTS = 8;
```

Extend `RoomReadinessInput`:

```ts
export interface RoomReadinessInput {
  readonly hadPreviousRoom?: boolean;
  readonly rooms?: RoomClient;
  readonly dispatch?: DispatchClient;
  readonly dispatchAgent?: boolean;
}
```

Replace `maxParticipants: 3` with:

```ts
        maxParticipants: ROOM_MAX_PARTICIPANTS,
```

Replace the dispatch block with:

```ts
  let dispatchCreated = false;
  if (input.dispatchAgent !== false) {
    const dispatches = await dispatch.listDispatch(room);
    dispatchCreated = !dispatches.some(dispatchMatchesPuddleInterviewer);
    if (dispatchCreated) {
      await dispatch.createDispatch(room, INTERVIEW_AGENT_NAME, {
        metadata: workerMetadata,
      });
    }
  }
```

- [ ] **Step 8: Run room readiness tests and verify they pass**

Run:

```bash
pnpm --filter @puddle/backend test -- backend/test/livekit-egress.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit backend LiveKit primitives**

```bash
git add backend/src/livekit/token.ts backend/src/livekit/provision.ts backend/test/invites.test.ts backend/test/livekit-egress.test.ts
git commit -m "Add role-aware LiveKit room primitives"
```

---

### Task 2: Backend Interviewer State, Repository, and Routes

**Files:**
- Create: `backend/migrations/015_interviewer_ai_control_state.sql`
- Create: `backend/src/interviewers/repository.ts`
- Create: `backend/src/interviewers/routes.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/test/migrations.test.ts`
- Create: `backend/test/interviewers.test.ts`

- [ ] **Step 1: Add failing migration test**

Open `backend/test/migrations.test.ts` and add `015_interviewer_ai_control_state.sql` to the migration list assertion used by the existing migration-order test. If the test uses an expected filename array, include:

```ts
"015_interviewer_ai_control_state.sql",
```

Add this assertion to the test that scans migration SQL content:

```ts
expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS interview_ai_control_state");
expect(migrationSql).toContain("requested_state");
expect(migrationSql).toContain("CHECK (requested_state IN ('running', 'stopped'))");
```

- [ ] **Step 2: Run migration test and verify it fails**

Run:

```bash
pnpm --filter @puddle/backend test -- backend/test/migrations.test.ts
```

Expected: FAIL because migration `015_interviewer_ai_control_state.sql` does not exist.

- [ ] **Step 3: Create AI control migration**

Create `backend/migrations/015_interviewer_ai_control_state.sql`:

```sql
-- 015_interviewer_ai_control_state.sql — latest requested AI interviewer state.

CREATE TABLE IF NOT EXISTS interview_ai_control_state (
  session_id             TEXT PRIMARY KEY REFERENCES sessions(session_id),
  requested_state        TEXT NOT NULL CHECK (requested_state IN ('running', 'stopped')),
  requested_by_user_id   TEXT NOT NULL,
  requested_by_email     TEXT NOT NULL,
  requested_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interview_ai_control_state_requested_at_idx
  ON interview_ai_control_state(requested_at);
```

- [ ] **Step 4: Run migration test and verify it passes**

Run:

```bash
pnpm --filter @puddle/backend test -- backend/test/migrations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add failing repository tests**

Create `backend/test/interviewers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  aiControlStateFromAction,
  aiControlStateUpsertStatement,
  candidateInviteInsertForSessionStatement,
  hasInterviewerJoinedStatement,
  interviewerSessionStatement,
  type InterviewerSessionRow,
} from "../src/interviewers/repository.js";
import { hashInviteToken } from "../src/invites/tokens.js";

describe("interviewer repository", () => {
  it("looks up a session inside the signed-in organization", () => {
    const stmt = interviewerSessionStatement("sess1", "org1");

    expect(stmt.sql).toContain("FROM sessions");
    expect(stmt.sql).toContain("session_id = $1");
    expect(stmt.sql).toContain("org_id = $2");
    expect(stmt.params).toEqual(["sess1", "org1"]);
  });

  it("builds a candidate invite insert for an existing session without storing the raw token", () => {
    const session: InterviewerSessionRow = {
      session_id: "sess1",
      org_id: "org1",
      candidate_email: "candidate@example.com",
      script_version: "pilot-v1",
      status: "scheduled",
      scheduled_at: "2026-06-18T10:00:00Z",
      room_name: null,
    };
    const stmt = candidateInviteInsertForSessionStatement({
      session,
      inviteId: "invite1",
      token: "inv_raw",
      notBefore: "2026-06-18T10:00:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
    });

    expect(stmt.sql).toContain("INSERT INTO candidate_invites");
    expect(stmt.params).toEqual([
      "invite1",
      "sess1",
      "candidate@example.com",
      hashInviteToken("inv_raw"),
      "2026-06-18T10:00:00.000Z",
      "2026-06-18T12:00:00.000Z",
    ]);
  });

  it("maps AI control actions to persisted states", () => {
    expect(aiControlStateFromAction("start")).toBe("running");
    expect(aiControlStateFromAction("resume")).toBe("running");
    expect(aiControlStateFromAction("stop")).toBe("stopped");
  });

  it("upserts latest AI control state", () => {
    const stmt = aiControlStateUpsertStatement({
      sessionId: "sess1",
      requestedState: "stopped",
      requestedByUserId: "user_123",
      requestedByEmail: "host@workweave.ai",
      requestedAt: "2026-06-18T10:05:00.000Z",
    });

    expect(stmt.sql).toContain("INSERT INTO interview_ai_control_state");
    expect(stmt.sql).toContain("ON CONFLICT (session_id) DO UPDATE");
    expect(stmt.params).toEqual([
      "sess1",
      "stopped",
      "user_123",
      "host@workweave.ai",
      "2026-06-18T10:05:00.000Z",
    ]);
  });

  it("detects whether an interviewer has joined from ops events", () => {
    const stmt = hasInterviewerJoinedStatement("sess1");

    expect(stmt.sql).toContain("FROM events");
    expect(stmt.sql).toContain("payload->>'event_type' = 'interviewer_joined'");
    expect(stmt.params).toEqual(["sess1"]);
  });
});
```

- [ ] **Step 6: Run repository tests and verify they fail**

Run:

```bash
pnpm --filter @puddle/backend test -- backend/test/interviewers.test.ts
```

Expected: FAIL because `backend/src/interviewers/repository.ts` does not exist.

- [ ] **Step 7: Implement interviewer repository**

Create `backend/src/interviewers/repository.ts`:

```ts
import type { SqlStatement } from "../consent/repository.js";
import { hashInviteToken } from "../invites/tokens.js";

export type AiControlAction = "start" | "stop" | "resume";
export type AiRequestedState = "running" | "stopped";

export interface InterviewerSessionRow {
  readonly session_id: string;
  readonly org_id: string;
  readonly candidate_email: string;
  readonly script_version: string;
  readonly status: string;
  readonly scheduled_at: string | Date | null;
  readonly room_name: string | null;
}

export interface CandidateInviteForSessionInput {
  readonly session: InterviewerSessionRow;
  readonly inviteId: string;
  readonly token: string;
  readonly notBefore: string;
  readonly expiresAt: string;
}

export interface AiControlStateInput {
  readonly sessionId: string;
  readonly requestedState: AiRequestedState;
  readonly requestedByUserId: string;
  readonly requestedByEmail: string;
  readonly requestedAt: string;
}

export function interviewerSessionStatement(sessionId: string, orgId: string): SqlStatement {
  return {
    sql:
      "SELECT session_id, org_id, candidate_email, script_version, status, scheduled_at, room_name " +
      "FROM sessions WHERE session_id = $1 AND org_id = $2",
    params: [sessionId, orgId],
  };
}

export function candidateInviteInsertForSessionStatement(input: CandidateInviteForSessionInput): SqlStatement {
  return {
    sql:
      "INSERT INTO candidate_invites " +
      "(invite_id, session_id, candidate_email, token_hash, not_before, expires_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6)",
    params: [
      input.inviteId,
      input.session.session_id,
      input.session.candidate_email,
      hashInviteToken(input.token),
      input.notBefore,
      input.expiresAt,
    ],
  };
}

export function hasInterviewerJoinedStatement(sessionId: string): SqlStatement {
  return {
    sql:
      "SELECT 1 FROM events " +
      "WHERE session_id = $1 AND kind = 'ops' " +
      "AND payload->>'event_type' = 'interviewer_joined' LIMIT 1",
    params: [sessionId],
  };
}

export function aiControlStateFromAction(action: AiControlAction): AiRequestedState {
  return action === "stop" ? "stopped" : "running";
}

export function aiControlEventType(action: AiControlAction): string {
  switch (action) {
    case "start":
      return "ai_interviewer_start_requested";
    case "stop":
      return "ai_interviewer_stop_requested";
    case "resume":
      return "ai_interviewer_resume_requested";
  }
}

export function aiControlStateUpsertStatement(input: AiControlStateInput): SqlStatement {
  return {
    sql:
      "INSERT INTO interview_ai_control_state " +
      "(session_id, requested_state, requested_by_user_id, requested_by_email, requested_at, updated_at) " +
      "VALUES ($1, $2, $3, $4, $5, now()) " +
      "ON CONFLICT (session_id) DO UPDATE SET " +
      "requested_state = EXCLUDED.requested_state, " +
      "requested_by_user_id = EXCLUDED.requested_by_user_id, " +
      "requested_by_email = EXCLUDED.requested_by_email, " +
      "requested_at = EXCLUDED.requested_at, updated_at = now()",
    params: [
      input.sessionId,
      input.requestedState,
      input.requestedByUserId,
      input.requestedByEmail,
      input.requestedAt,
    ],
  };
}
```

- [ ] **Step 8: Run repository tests and verify they pass**

Run:

```bash
pnpm --filter @puddle/backend test -- backend/test/interviewers.test.ts
```

Expected: PASS.

- [ ] **Step 9: Add failing route tests**

Append to `backend/test/interviewers.test.ts`:

```ts
import Fastify from "fastify";
import { vi } from "vitest";
import { registerInterviewerRoutes } from "../src/interviewers/routes.js";

const { routeQueryMock } = vi.hoisted(() => ({
  routeQueryMock: vi.fn(),
}));

vi.mock("../src/db/pool.js", () => ({
  getPool: () => ({ query: routeQueryMock }),
}));

describe("interviewer routes", () => {
  it("rejects interviewer join when the session is outside the org", async () => {
    routeQueryMock.mockReset();
    routeQueryMock.mockResolvedValue({ rows: [] });
    const app = Fastify();
    registerInterviewerRoutes(app, { host: "wss://livekit.example", apiKey: "key", apiSecret: "secret" });

    const response = await app.inject({
      method: "POST",
      url: "/internal/interviews/sess1/interviewer/join",
      payload: {
        orgId: "org1",
        interviewerEmail: "host@workweave.ai",
        interviewerUserId: "user_123",
      },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("records AI control state requests", async () => {
    routeQueryMock.mockReset();
    routeQueryMock
      .mockResolvedValueOnce({
        rows: [{
          session_id: "sess1",
          org_id: "org1",
          candidate_email: "candidate@example.com",
          script_version: "pilot-v1",
          status: "in_progress",
          scheduled_at: "2026-06-18T10:00:00Z",
          room_name: "interview-sess1",
        }],
      })
      .mockResolvedValue({ rows: [] });
    const app = Fastify();
    registerInterviewerRoutes(app, { host: "wss://livekit.example", apiKey: "key", apiSecret: "secret" });

    const response = await app.inject({
      method: "POST",
      url: "/internal/interviews/sess1/ai-control",
      payload: {
        orgId: "org1",
        interviewerEmail: "host@workweave.ai",
        interviewerUserId: "user_123",
        action: "stop",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ aiInterviewerState: "stopped" });
    expect(routeQueryMock.mock.calls.some(([sql]) => String(sql).includes("interview_ai_control_state"))).toBe(true);
    expect(routeQueryMock.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO events"))).toBe(true);
    await app.close();
  });
});
```

- [ ] **Step 10: Run route tests and verify they fail**

Run:

```bash
pnpm --filter @puddle/backend test -- backend/test/interviewers.test.ts
```

Expected: FAIL because `registerInterviewerRoutes` is not implemented.

- [ ] **Step 11: Implement interviewer routes**

Create `backend/src/interviewers/routes.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { getPool } from "../db/pool.js";
import { persistOpsEvent } from "../events/repository.js";
import { isInviteSessionJoinable } from "../invites/repository.js";
import { generateInviteToken } from "../invites/tokens.js";
import { ensureRoomReady, type LiveKitConfig } from "../livekit/provision.js";
import { buildInterviewerJoinToken } from "../livekit/token.js";
import { buildWorkerDispatchMetadata, sessionRoomUpdateStatement } from "../scheduler/sessions.js";
import {
  aiControlEventType,
  aiControlStateFromAction,
  aiControlStateUpsertStatement,
  candidateInviteInsertForSessionStatement,
  interviewerSessionStatement,
  type AiControlAction,
  type InterviewerSessionRow,
} from "./repository.js";

interface InterviewParams {
  readonly sessionId: string;
}

interface InterviewerBody {
  readonly orgId?: string;
  readonly interviewerEmail?: string;
  readonly interviewerUserId?: string;
}

interface AiControlBody extends InterviewerBody {
  readonly action?: AiControlAction;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validAiControlAction(value: unknown): value is AiControlAction {
  return value === "start" || value === "stop" || value === "resume";
}

async function loadInterviewerSession(
  sessionId: string,
  orgId: string,
): Promise<InterviewerSessionRow | null> {
  const stmt = interviewerSessionStatement(sessionId, orgId);
  const result = await getPool().query<InterviewerSessionRow>(stmt.sql, [...stmt.params]);
  return result.rows[0] ?? null;
}

function sessionJoinable(row: InterviewerSessionRow): boolean {
  return isInviteSessionJoinable({
    invite_id: "interviewer",
    session_id: row.session_id,
    org_id: row.org_id,
    script_version: row.script_version,
    candidate_email: row.candidate_email,
    session_status: row.status,
    scheduled_at: row.scheduled_at,
    room_name: row.room_name,
    status: "active",
    not_before: new Date(0).toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    revoked_at: null,
    join_count: 0,
  }).ok;
}

function workerMetadata(row: InterviewerSessionRow): string {
  return buildWorkerDispatchMetadata({
    sessionId: row.session_id,
    orgId: row.org_id,
    candidateEmail: row.candidate_email,
    scriptVersion: row.script_version,
    scheduledAt: new Date(row.scheduled_at ?? Date.now()).toISOString(),
    status: "scheduled",
  });
}

export function registerInterviewerRoutes(app: FastifyInstance, liveKitConfig: LiveKitConfig): void {
  app.post<{ Params: InterviewParams; Body: InterviewerBody }>(
    "/internal/interviews/:sessionId/candidate-invites",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      const orgId = stringField(request.body?.orgId);
      const interviewerEmail = stringField(request.body?.interviewerEmail);
      const interviewerUserId = stringField(request.body?.interviewerUserId);
      if (!sessionId || !orgId || !interviewerEmail || !interviewerUserId) {
        return reply.code(400).send({ error: "sessionId, orgId, interviewerEmail, and interviewerUserId are required" });
      }

      const session = await loadInterviewerSession(sessionId, orgId);
      if (!session) {
        return reply.code(404).send({ error: "interview not found" });
      }
      if (!sessionJoinable(session)) {
        return reply.code(410).send({ error: "This interview session has ended.", code: "session_ended" });
      }

      const token = generateInviteToken();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      const insert = candidateInviteInsertForSessionStatement({
        session,
        inviteId: randomUUID(),
        token,
        notBefore: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      await getPool().query(insert.sql, [...insert.params]);
      await persistOpsEvent(getPool(), {
        sessionId,
        eventType: "candidate_invite_created_by_interviewer",
        payload: { interviewer_email: interviewerEmail, interviewer_user_id: interviewerUserId },
      });

      return reply.code(201).send({
        invitePath: `/interview/${encodeURIComponent(token)}`,
        inviteToken: token,
        inviteExpiresAt: expiresAt.toISOString(),
      });
    },
  );

  app.post<{ Params: InterviewParams; Body: InterviewerBody }>(
    "/internal/interviews/:sessionId/interviewer/join",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      const orgId = stringField(request.body?.orgId);
      const interviewerEmail = stringField(request.body?.interviewerEmail);
      const interviewerUserId = stringField(request.body?.interviewerUserId);
      if (!sessionId || !orgId || !interviewerEmail || !interviewerUserId) {
        return reply.code(400).send({ error: "sessionId, orgId, interviewerEmail, and interviewerUserId are required" });
      }

      const session = await loadInterviewerSession(sessionId, orgId);
      if (!session) {
        return reply.code(404).send({ error: "interview not found" });
      }
      if (!sessionJoinable(session)) {
        return reply.code(410).send({ error: "This interview session has ended.", code: "session_ended" });
      }

      const readiness = await ensureRoomReady(liveKitConfig, sessionId, workerMetadata(session), {
        hadPreviousRoom: Boolean(session.room_name),
        dispatchAgent: false,
      });
      const roomUpdate = sessionRoomUpdateStatement(sessionId, readiness.room);
      await getPool().query(roomUpdate.sql, [...roomUpdate.params]);
      const token = await buildInterviewerJoinToken(liveKitConfig, {
        sessionId,
        room: readiness.room,
        interviewerEmail,
        interviewerUserId,
      });
      await persistOpsEvent(getPool(), {
        sessionId,
        eventType: "interviewer_joined",
        payload: {
          interviewer_email: interviewerEmail,
          interviewer_user_id: interviewerUserId,
          room: readiness.room,
          room_recreated: readiness.roomRecreated,
        },
      });

      return reply.code(200).send({
        sessionId,
        room: readiness.room,
        liveKitUrl: liveKitConfig.host,
        token,
        aiInterviewerState: "not_started",
      });
    },
  );

  app.post<{ Params: InterviewParams; Body: AiControlBody }>(
    "/internal/interviews/:sessionId/ai-control",
    async (request, reply) => {
      const sessionId = request.params.sessionId?.trim();
      const orgId = stringField(request.body?.orgId);
      const interviewerEmail = stringField(request.body?.interviewerEmail);
      const interviewerUserId = stringField(request.body?.interviewerUserId);
      const action = request.body?.action;
      if (!sessionId || !orgId || !interviewerEmail || !interviewerUserId || !validAiControlAction(action)) {
        return reply.code(400).send({ error: "sessionId, orgId, interviewerEmail, interviewerUserId, and action are required" });
      }

      const session = await loadInterviewerSession(sessionId, orgId);
      if (!session) {
        return reply.code(404).send({ error: "interview not found" });
      }
      if (!sessionJoinable(session)) {
        return reply.code(410).send({ error: "This interview session has ended.", code: "session_ended" });
      }

      const requestedState = aiControlStateFromAction(action);
      const requestedAt = new Date().toISOString();
      const stmt = aiControlStateUpsertStatement({
        sessionId,
        requestedState,
        requestedByEmail: interviewerEmail,
        requestedByUserId: interviewerUserId,
        requestedAt,
      });
      await getPool().query(stmt.sql, [...stmt.params]);
      await persistOpsEvent(getPool(), {
        sessionId,
        eventType: aiControlEventType(action),
        payload: {
          requested_state: requestedState,
          interviewer_email: interviewerEmail,
          interviewer_user_id: interviewerUserId,
          requested_at: requestedAt,
        },
      });

      return reply.code(200).send({
        sessionId,
        aiInterviewerState: requestedState,
        requestedAt,
      });
    },
  );
}
```

- [ ] **Step 12: Register interviewer routes**

In `backend/src/server.ts`, add:

```ts
import { registerInterviewerRoutes } from "./interviewers/routes.js";
```

After `registerDashboardRoutes(app);`, add:

```ts
  registerInterviewerRoutes(app, liveKitConfig);
```

- [ ] **Step 13: Run interviewer tests and fix type issues**

Run:

```bash
pnpm --filter @puddle/backend test -- backend/test/interviewers.test.ts
```

Expected: PASS after resolving any TypeScript import placement issues caused by the appended test imports. Keep imports at the top of the test file.

- [ ] **Step 14: Run backend build**

Run:

```bash
pnpm --filter @puddle/backend build
```

Expected: PASS.

- [ ] **Step 15: Commit backend interviewer routes**

```bash
git add backend/migrations/015_interviewer_ai_control_state.sql backend/src/interviewers/repository.ts backend/src/interviewers/routes.ts backend/src/server.ts backend/test/interviewers.test.ts backend/test/migrations.test.ts
git commit -m "Add interviewer room backend routes"
```

---

### Task 3: Candidate Join Skips AI Auto-Dispatch After Interviewer Join

**Files:**
- Modify: `backend/src/invites/routes.ts`
- Modify: `backend/test/interviewers.test.ts`
- Modify: `backend/test/livekit-egress.test.ts`

- [ ] **Step 1: Add failing helper test for interviewer activity statement usage**

Append to `backend/test/interviewers.test.ts`:

```ts
describe("candidate auto-dispatch guard", () => {
  it("uses interviewer join events as the durable human-present signal", () => {
    const stmt = hasInterviewerJoinedStatement("sess-human");

    expect(stmt.sql).toContain("interviewer_joined");
    expect(stmt.sql).toContain("LIMIT 1");
    expect(stmt.params).toEqual(["sess-human"]);
  });
});
```

This should already pass from Task 2; it protects the exact event name used by candidate join.

- [ ] **Step 2: Add candidate route behavior expectation to route code review tests**

Add this source-level assertion to a backend test file if a route source test exists; otherwise keep it in `backend/test/interviewers.test.ts` by reading the route source with `node:fs/promises`:

```ts
import { readFile } from "node:fs/promises";

describe("candidate join source behavior", () => {
  it("checks for interviewer joins before deciding to dispatch the AI interviewer", async () => {
    const source = await readFile(new URL("../src/invites/routes.ts", import.meta.url), "utf8");

    expect(source).toContain("hasInterviewerJoinedStatement");
    expect(source).toContain("dispatchAgent: !hasInterviewerJoined");
    expect(source).toContain("ai_interviewer_auto_dispatch_skipped");
  });
});
```

- [ ] **Step 3: Run focused backend tests and verify source behavior fails**

Run:

```bash
pnpm --filter @puddle/backend test -- backend/test/interviewers.test.ts
```

Expected: FAIL because `backend/src/invites/routes.ts` does not yet check interviewer activity.

- [ ] **Step 4: Update candidate join route**

In `backend/src/invites/routes.ts`, add the import:

```ts
import { hasInterviewerJoinedStatement } from "../interviewers/repository.js";
```

Before calling `ensureRoomReady`, add:

```ts
      const interviewerJoinedStmt = hasInterviewerJoinedStatement(invite.session_id);
      const interviewerJoinedResult = await pool.query(interviewerJoinedStmt.sql, [
        ...interviewerJoinedStmt.params,
      ]);
      const hasInterviewerJoined = interviewerJoinedResult.rows.length > 0;
```

Update the `ensureRoomReady` options object from:

```ts
          { hadPreviousRoom: Boolean(invite.room_name) },
```

to:

```ts
          {
            hadPreviousRoom: Boolean(invite.room_name),
            dispatchAgent: !hasInterviewerJoined,
          },
```

After `recordJoinMetadata(...)`, add:

```ts
      if (hasInterviewerJoined) {
        await persistOpsEvent(pool, {
          sessionId: invite.session_id,
          eventType: "ai_interviewer_auto_dispatch_skipped",
          payload: {
            reason: "human_interviewer_joined",
            invite_id: invite.invite_id,
            room,
          },
        });
      }
```

- [ ] **Step 5: Run focused backend tests**

Run:

```bash
pnpm --filter @puddle/backend test -- backend/test/interviewers.test.ts backend/test/invites.test.ts backend/test/livekit-egress.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit candidate join dispatch guard**

```bash
git add backend/src/invites/routes.ts backend/test/interviewers.test.ts
git commit -m "Skip AI auto-dispatch for interviewer-led joins"
```

---

### Task 4: Platform Backend Proxy Routes

**Files:**
- Modify: `platform/app/api/interviews/route.ts`
- Create: `platform/app/api/dashboard/interviews/[sessionId]/candidate-invite/route.ts`
- Create: `platform/app/api/dashboard/interviews/[sessionId]/interviewer-join/route.ts`
- Create: `platform/app/api/dashboard/interviews/[sessionId]/ai-control/route.ts`
- Modify: `platform/tests/org-access-source.test.mjs`
- Create: `platform/tests/interviewer-room-source.test.mjs`

- [ ] **Step 1: Add failing source tests for platform routes**

Create `platform/tests/interviewer-room-source.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

const createInterviewRoute = await source("../app/api/interviews/route.ts");
const candidateInviteRoute = await source("../app/api/dashboard/interviews/[sessionId]/candidate-invite/route.ts");
const interviewerJoinRoute = await source("../app/api/dashboard/interviews/[sessionId]/interviewer-join/route.ts");
const aiControlRoute = await source("../app/api/dashboard/interviews/[sessionId]/ai-control/route.ts");

test("create interview API returns an interviewer join URL for host launch", () => {
  assert.match(createInterviewRoute, /interviewerJoinUrl/);
  assert.match(createInterviewRoute, /\/dashboard\/interviews\/\$\{encodeURIComponent\(createdSession\.sessionId\)\}\/join/);
});

test("interviewer platform routes require completed dashboard access", () => {
  for (const routeSource of [candidateInviteRoute, interviewerJoinRoute, aiControlRoute]) {
    assert.match(routeSource, /requireAshbyReadyDashboardApiAccess/);
    assert.match(routeSource, /dashboardApiReadinessContext/);
    assert.match(routeSource, /backendHeaders\(\)/);
    assert.match(routeSource, /organizationId/);
    assert.doesNotMatch(routeSource, /isAllowedAuthEmail/);
  }
});

test("candidate invite route mints a candidate URL through the backend", () => {
  assert.match(candidateInviteRoute, /candidate-invites/);
  assert.match(candidateInviteRoute, /invitePath/);
  assert.match(candidateInviteRoute, /candidateInviteUrl/);
});

test("interviewer join and AI control routes call the role-specific backend surfaces", () => {
  assert.match(interviewerJoinRoute, /interviewer\/join/);
  assert.match(aiControlRoute, /ai-control/);
  assert.match(aiControlRoute, /action/);
});
```

- [ ] **Step 2: Run platform source tests and verify they fail**

Run:

```bash
pnpm --filter @puddle/platform test -- tests/interviewer-room-source.test.mjs
```

Expected: FAIL because the new route files do not exist and `interviewerJoinUrl` is not returned.

- [ ] **Step 3: Return interviewer join URL from create interview API**

In `platform/app/api/interviews/route.ts`, update the success payload to include:

```ts
      interviewerJoinUrl: `${publicOrigin()}/dashboard/interviews/${encodeURIComponent(createdSession.sessionId)}/join`,
```

The full return block should be:

```ts
  return NextResponse.json(
    {
      sessionId: createdSession.sessionId,
      room: createdSession.room,
      inviteUrl: `${publicOrigin()}${invitePath}`,
      interviewerJoinUrl: `${publicOrigin()}/dashboard/interviews/${encodeURIComponent(createdSession.sessionId)}/join`,
      inviteExpiresAt: createdSession.inviteExpiresAt,
    },
    { status: 201 },
  );
```

- [ ] **Step 4: Create candidate invite platform route**

Create `platform/app/api/dashboard/interviews/[sessionId]/candidate-invite/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAshbyReadyDashboardApiAccess } from "@/lib/ashby/dashboard-api-readiness.mjs";
import { dashboardApiReadinessContext } from "@/lib/ashby/dashboard-api-readiness-context";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";
import { publicBaseUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly sessionId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const access = await requireAshbyReadyDashboardApiAccess(dashboardApiReadinessContext());
  if (access.response) return access.response;

  const { sessionId } = await context.params;
  const backendResponse = await fetch(
    `${backendBaseUrl()}/internal/interviews/${encodeURIComponent(sessionId)}/candidate-invites`,
    {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({
        orgId: access.organizationId,
        interviewerEmail: access.user.email,
        interviewerUserId: access.user.id,
      }),
      cache: "no-store",
    },
  ).catch(() => null);

  if (!backendResponse) {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const payload = await backendResponse.json().catch(() => ({}));
  if (!backendResponse.ok) {
    return NextResponse.json(
      { error: payload.error ?? "Candidate invite could not be created.", code: payload.code },
      { status: backendResponse.status },
    );
  }

  return NextResponse.json(
    {
      candidateInviteUrl: `${publicBaseUrl()}${payload.invitePath}`,
      inviteExpiresAt: payload.inviteExpiresAt,
    },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}
```

- [ ] **Step 5: Create interviewer join platform route**

Create `platform/app/api/dashboard/interviews/[sessionId]/interviewer-join/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAshbyReadyDashboardApiAccess } from "@/lib/ashby/dashboard-api-readiness.mjs";
import { dashboardApiReadinessContext } from "@/lib/ashby/dashboard-api-readiness-context";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly sessionId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const access = await requireAshbyReadyDashboardApiAccess(dashboardApiReadinessContext());
  if (access.response) return access.response;

  const { sessionId } = await context.params;
  const backendResponse = await fetch(
    `${backendBaseUrl()}/internal/interviews/${encodeURIComponent(sessionId)}/interviewer/join`,
    {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({
        orgId: access.organizationId,
        interviewerEmail: access.user.email,
        interviewerUserId: access.user.id,
      }),
      cache: "no-store",
    },
  ).catch(() => null);

  if (!backendResponse) {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const payload = await backendResponse.json().catch(() => ({}));
  if (!backendResponse.ok) {
    return NextResponse.json(
      { error: payload.error ?? "Interviewer could not join this interview.", code: payload.code },
      { status: backendResponse.status },
    );
  }

  return NextResponse.json(payload, { status: 200, headers: { "cache-control": "no-store" } });
}
```

- [ ] **Step 6: Create AI control platform route**

Create `platform/app/api/dashboard/interviews/[sessionId]/ai-control/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAshbyReadyDashboardApiAccess } from "@/lib/ashby/dashboard-api-readiness.mjs";
import { dashboardApiReadinessContext } from "@/lib/ashby/dashboard-api-readiness-context";
import { backendBaseUrl, backendHeaders } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly sessionId: string }>;
}

function actionFromBody(body: unknown): string {
  if (!body || typeof body !== "object" || !("action" in body)) {
    return "";
  }
  return String(body.action ?? "").trim();
}

export async function POST(request: Request, context: RouteContext) {
  const access = await requireAshbyReadyDashboardApiAccess(dashboardApiReadinessContext());
  if (access.response) return access.response;

  const { sessionId } = await context.params;
  const action = actionFromBody(await request.json().catch(() => ({})));
  if (!["start", "stop", "resume"].includes(action)) {
    return NextResponse.json({ error: "Choose start, stop, or resume." }, { status: 400 });
  }

  const backendResponse = await fetch(
    `${backendBaseUrl()}/internal/interviews/${encodeURIComponent(sessionId)}/ai-control`,
    {
      method: "POST",
      headers: backendHeaders(),
      body: JSON.stringify({
        orgId: access.organizationId,
        interviewerEmail: access.user.email,
        interviewerUserId: access.user.id,
        action,
      }),
      cache: "no-store",
    },
  ).catch(() => null);

  if (!backendResponse) {
    return NextResponse.json({ error: "Interview backend is not reachable." }, { status: 502 });
  }

  const payload = await backendResponse.json().catch(() => ({}));
  if (!backendResponse.ok) {
    return NextResponse.json(
      { error: payload.error ?? "AI interviewer control request failed.", code: payload.code },
      { status: backendResponse.status },
    );
  }

  return NextResponse.json(payload, { status: 200, headers: { "cache-control": "no-store" } });
}
```

- [ ] **Step 7: Include new routes in org-access source guard test**

In `platform/tests/org-access-source.test.mjs`, add these paths to `dashboardActionRoutes`:

```js
    "../app/api/dashboard/interviews/[sessionId]/candidate-invite/route.ts",
    "../app/api/dashboard/interviews/[sessionId]/interviewer-join/route.ts",
    "../app/api/dashboard/interviews/[sessionId]/ai-control/route.ts",
```

- [ ] **Step 8: Run platform source tests**

Run:

```bash
pnpm --filter @puddle/platform test -- tests/interviewer-room-source.test.mjs tests/org-access-source.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit platform API routes**

```bash
git add platform/app/api/interviews/route.ts platform/app/api/dashboard/interviews/[sessionId]/candidate-invite/route.ts platform/app/api/dashboard/interviews/[sessionId]/interviewer-join/route.ts platform/app/api/dashboard/interviews/[sessionId]/ai-control/route.ts platform/tests/interviewer-room-source.test.mjs platform/tests/org-access-source.test.mjs
git commit -m "Add interviewer room platform API routes"
```

---

### Task 5: Full-Screen Interviewer Join Room UI

**Files:**
- Create: `platform/app/dashboard/interviews/[sessionId]/join/page.tsx`
- Create: `platform/app/dashboard/interviews/[sessionId]/join/InterviewerJoinClient.tsx`
- Modify: `platform/tests/interviewer-room-source.test.mjs`

- [ ] **Step 1: Add failing source tests for interviewer page and client**

Append to `platform/tests/interviewer-room-source.test.mjs`:

```js
const interviewerJoinPage = await source("../app/dashboard/interviews/[sessionId]/join/page.tsx");
const interviewerJoinClient = await source("../app/dashboard/interviews/[sessionId]/join/InterviewerJoinClient.tsx");

test("interviewer join page is authenticated and full-screen", () => {
  assert.match(interviewerJoinPage, /requireDashboardUser/);
  assert.match(interviewerJoinPage, /InterviewerJoinClient/);
  assert.match(interviewerJoinPage, /fixed inset-0/);
});

test("interviewer client creates candidate link and exposes role-aware controls", () => {
  assert.match(interviewerJoinClient, /candidate-invite/);
  assert.match(interviewerJoinClient, /Copy candidate link/);
  assert.match(interviewerJoinClient, /interviewer-join/);
  assert.match(interviewerJoinClient, /Start AI/);
  assert.match(interviewerJoinClient, /Stop AI/);
  assert.match(interviewerJoinClient, /Resume AI/);
  assert.doesNotMatch(interviewerJoinClient, /AI interview disclosure/);
  assert.doesNotMatch(interviewerJoinClient, /Accept all required interview notices/);
});
```

- [ ] **Step 2: Run source test and verify it fails**

Run:

```bash
pnpm --filter @puddle/platform test -- tests/interviewer-room-source.test.mjs
```

Expected: FAIL because the page/client files do not exist.

- [ ] **Step 3: Create authenticated full-screen page**

Create `platform/app/dashboard/interviews/[sessionId]/join/page.tsx`:

```tsx
import type { Metadata } from "next";
import { noindexMetadata } from "@/lib/seo";
import { requireDashboardUser } from "../../../auth";
import { InterviewerJoinClient } from "./InterviewerJoinClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = noindexMetadata;

interface InterviewerJoinPageProps {
  readonly params: Promise<{ readonly sessionId: string }>;
}

export default async function InterviewerJoinPage({ params }: InterviewerJoinPageProps) {
  const { sessionId } = await params;
  await requireDashboardUser(`/dashboard/interviews/${encodeURIComponent(sessionId)}/join`);

  return (
    <main className="fixed inset-0 z-[100] overflow-auto bg-[#f8fafd] p-3 text-[#202124] sm:p-4 lg:p-5">
      <div className="mx-auto max-w-[1180px]">
        <InterviewerJoinClient sessionId={sessionId} />
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Create interviewer client**

Create `platform/app/dashboard/interviews/[sessionId]/join/InterviewerJoinClient.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  createLocalVideoTrack,
  type LocalAudioTrack,
  type LocalVideoTrack,
  type RemoteTrack,
} from "livekit-client";

interface InterviewerJoinClientProps {
  readonly sessionId: string;
}

interface CandidateInviteResponse {
  readonly candidateInviteUrl: string;
  readonly inviteExpiresAt: string;
  readonly error?: string;
}

interface JoinResponse {
  readonly sessionId: string;
  readonly room: string;
  readonly liveKitUrl: string;
  readonly token: string;
  readonly aiInterviewerState: "not_started" | "running" | "stopped";
  readonly error?: string;
}

type Stage = "precall" | "connecting" | "live" | "left" | "ended";
type AiState = "not_started" | "running" | "stopped";

export function InterviewerJoinClient({ sessionId }: InterviewerJoinClientProps) {
  const [stage, setStage] = useState<Stage>("precall");
  const [candidateInviteUrl, setCandidateInviteUrl] = useState("");
  const [copyLabel, setCopyLabel] = useState("Copy candidate link");
  const [error, setError] = useState<string | null>(null);
  const [roomStatus, setRoomStatus] = useState("Not connected");
  const [join, setJoin] = useState<JoinResponse | null>(null);
  const [aiState, setAiState] = useState<AiState>("not_started");
  const [isJoining, setIsJoining] = useState(false);
  const [isRequestingAiControl, setIsRequestingAiControl] = useState(false);
  const [localVideoTrack, setLocalVideoTrack] = useState<LocalVideoTrack | null>(null);
  const [remoteVideoTrack, setRemoteVideoTrack] = useState<RemoteTrack | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);

  const inviteRequestedRef = useRef(false);
  const liveKitRoomRef = useRef<Room | null>(null);
  const localAudioTrackRef = useRef<LocalAudioTrack | null>(null);
  const localVideoTrackRef = useRef<LocalVideoTrack | null>(null);
  const callVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLDivElement | null>(null);

  const cleanupRoom = useCallback(() => {
    localAudioTrackRef.current?.stop();
    localAudioTrackRef.current = null;
    localVideoTrackRef.current?.stop();
    localVideoTrackRef.current = null;
    setLocalVideoTrack(null);
    setRemoteVideoTrack(null);
    liveKitRoomRef.current?.disconnect();
    liveKitRoomRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.replaceChildren();
  }, []);

  useEffect(() => {
    return () => cleanupRoom();
  }, [cleanupRoom]);

  useEffect(() => {
    if (inviteRequestedRef.current) return;
    inviteRequestedRef.current = true;
    void createCandidateInvite();
  }, []);

  useEffect(() => {
    const video = callVideoRef.current;
    if (!video || !localVideoTrack || stage !== "live") return;
    localVideoTrack.attach(video);
    return () => localVideoTrack.detach(video);
  }, [localVideoTrack, stage]);

  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video || !remoteVideoTrack || stage !== "live") return;
    remoteVideoTrack.attach(video);
    void video.play().catch(() => setError("Candidate video was blocked by the browser. Leave and rejoin."));
    return () => remoteVideoTrack.detach(video);
  }, [remoteVideoTrack, stage]);

  async function createCandidateInvite() {
    setError(null);
    const response = await fetch(`/api/dashboard/interviews/${encodeURIComponent(sessionId)}/candidate-invite`, {
      method: "POST",
    });
    const payload = (await response.json().catch(() => ({}))) as CandidateInviteResponse;
    if (!response.ok) {
      setError(payload.error ?? "Candidate link could not be created.");
      return;
    }
    setCandidateInviteUrl(payload.candidateInviteUrl);
  }

  async function copyCandidateLink() {
    if (!candidateInviteUrl) return;
    try {
      await navigator.clipboard.writeText(candidateInviteUrl);
      setCopyLabel("Copied");
      window.setTimeout(() => setCopyLabel("Copy candidate link"), 1800);
    } catch {
      setCopyLabel("Copy failed");
      window.setTimeout(() => setCopyLabel("Copy candidate link"), 1800);
    }
  }

  async function joinRoom() {
    setIsJoining(true);
    setError(null);
    setStage("connecting");
    setRoomStatus("Requesting room credentials");
    try {
      const response = await fetch(`/api/dashboard/interviews/${encodeURIComponent(sessionId)}/interviewer-join`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as JoinResponse;
      if (!response.ok) {
        setStage(response.status === 410 ? "ended" : "precall");
        setError(payload.error ?? "Interviewer could not join this interview.");
        return;
      }

      setJoin(payload);
      setAiState(payload.aiInterviewerState);
      const room = new Room({ adaptiveStream: true, dynacast: true });
      liveKitRoomRef.current = room;
      room.on(RoomEvent.Connected, () => setRoomStatus("Connected"));
      room.on(RoomEvent.Disconnected, () => setRoomStatus("Disconnected"));
      room.on(RoomEvent.TrackSubscribed, attachRemoteTrack);
      room.on(RoomEvent.TrackUnsubscribed, detachRemoteTrack);

      await room.connect(payload.liveKitUrl, payload.token);
      const [audioTrack, videoTrack] = await Promise.all([
        createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }),
        createLocalVideoTrack({ facingMode: "user" }),
      ]);
      localAudioTrackRef.current = audioTrack;
      localVideoTrackRef.current = videoTrack;
      setLocalVideoTrack(videoTrack);
      await Promise.all([room.localParticipant.publishTrack(audioTrack), room.localParticipant.publishTrack(videoTrack)]);
      setRoomStatus("Connected");
      setStage("live");
    } catch {
      cleanupRoom();
      setStage("precall");
      setError("The interviewer room could not be opened. Try again.");
    } finally {
      setIsJoining(false);
    }
  }

  function attachRemoteTrack(track: RemoteTrack): void {
    if (track.kind === Track.Kind.Video) {
      setRemoteVideoTrack(track);
      return;
    }
    if (track.kind !== Track.Kind.Audio || !remoteAudioRef.current) return;
    const element = track.attach();
    element.autoplay = true;
    remoteAudioRef.current.appendChild(element);
    void element.play().catch(() => setError("Candidate audio was blocked by the browser. Leave and rejoin."));
  }

  function detachRemoteTrack(track: RemoteTrack): void {
    if (track.kind === Track.Kind.Video) {
      setRemoteVideoTrack((currentTrack) => (currentTrack === track ? null : currentTrack));
      return;
    }
    for (const element of track.detach()) element.remove();
  }

  async function requestAiControl() {
    const action = aiState === "not_started" ? "start" : aiState === "running" ? "stop" : "resume";
    setIsRequestingAiControl(true);
    setError(null);
    try {
      const response = await fetch(`/api/dashboard/interviews/${encodeURIComponent(sessionId)}/ai-control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = (await response.json().catch(() => ({}))) as { aiInterviewerState?: AiState; error?: string };
      if (!response.ok || !payload.aiInterviewerState) {
        setError(payload.error ?? "AI interviewer control request failed.");
        return;
      }
      setAiState(payload.aiInterviewerState);
    } finally {
      setIsRequestingAiControl(false);
    }
  }

  function leaveRoom() {
    cleanupRoom();
    setRoomStatus("Disconnected");
    setStage("left");
  }

  return (
    <section className="overflow-hidden rounded-[28px] bg-white shadow-[0_22px_70px_rgba(60,64,67,0.14)]">
      <div ref={remoteAudioRef} aria-hidden="true" className="fixed h-0 w-0 overflow-hidden" />
      {stage === "precall" ? (
        <PrecallPanel
          candidateInviteUrl={candidateInviteUrl}
          copyLabel={copyLabel}
          error={error}
          isJoining={isJoining}
          onCopy={copyCandidateLink}
          onJoin={joinRoom}
          onRetryInvite={createCandidateInvite}
        />
      ) : null}
      {stage === "connecting" ? <CenteredPanel title="Opening interviewer room" detail={roomStatus} /> : null}
      {stage === "live" ? (
        <LivePanel
          join={join}
          aiState={aiState}
          isRequestingAiControl={isRequestingAiControl}
          roomStatus={roomStatus}
          callVideoRef={callVideoRef}
          remoteVideoRef={remoteVideoRef}
          hasRemoteVideo={remoteVideoTrack !== null}
          isMicEnabled={isMicEnabled}
          isCameraEnabled={isCameraEnabled}
          onAiControl={requestAiControl}
          onToggleMic={() => {
            const next = !isMicEnabled;
            void setLocalTrackEnabled(localAudioTrackRef.current, next);
            setIsMicEnabled(next);
          }}
          onToggleCamera={() => {
            const next = !isCameraEnabled;
            void setLocalTrackEnabled(localVideoTrackRef.current, next);
            setIsCameraEnabled(next);
          }}
          onLeave={leaveRoom}
        />
      ) : null}
      {stage === "left" ? <CenteredPanel title="You left the interviewer room" detail="The candidate link remains valid until it expires." actionLabel="Rejoin" onAction={joinRoom} /> : null}
      {stage === "ended" ? <CenteredPanel title="Session ended" detail={error ?? "This interview is no longer available."} /> : null}
    </section>
  );
}

function PrecallPanel({
  candidateInviteUrl,
  copyLabel,
  error,
  isJoining,
  onCopy,
  onJoin,
  onRetryInvite,
}: {
  readonly candidateInviteUrl: string;
  readonly copyLabel: string;
  readonly error: string | null;
  readonly isJoining: boolean;
  readonly onCopy: () => void;
  readonly onJoin: () => void;
  readonly onRetryInvite: () => void;
}) {
  return (
    <div className="grid min-h-[calc(100svh-40px)] gap-5 bg-[#f8fafd] p-5 text-[#202124] lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="grid place-items-center rounded-[28px] bg-[#202124] px-6 text-center text-white">
        <div>
          <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-[#8ab4f8] text-4xl font-medium text-[#202124]">P</div>
          <h1 className="mt-6 text-4xl font-normal">Interviewer room</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#bdc1c6]">Copy the candidate link, send it in your current meeting, then join when you are ready to host.</p>
        </div>
      </div>
      <aside className="flex flex-col justify-center py-4">
        <div className="rounded-[18px] border border-[#dadce0] bg-white p-4 shadow-[0_1px_2px_rgba(60,64,67,0.12)]">
          <div className="text-xs font-semibold uppercase text-[#5f6368]">Candidate link</div>
          <div className="mt-3 rounded-md border border-[#dadce0] bg-[#f8fafd] p-3 text-sm leading-6 text-[#202124] break-all">
            {candidateInviteUrl || "Creating candidate invite link..."}
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={onCopy} disabled={!candidateInviteUrl} className="rounded-full bg-[#1a73e8] px-5 py-3 text-sm font-medium !text-white disabled:cursor-not-allowed disabled:bg-[#dadce0] disabled:!text-[#80868b]">
              {copyLabel}
            </button>
            <button type="button" onClick={onRetryInvite} className="rounded-full border border-[#dadce0] bg-white px-5 py-3 text-sm font-medium text-[#202124]">
              Create new link
            </button>
          </div>
        </div>
        {error ? <div className="mt-4 rounded-2xl border border-[#f4c7c3] bg-[#fce8e6] px-4 py-3 text-sm text-[#b3261e]">{error}</div> : null}
        <button type="button" onClick={onJoin} disabled={isJoining} className="mt-5 rounded-full bg-[#202124] px-7 py-3 text-sm font-medium !text-white transition hover:bg-[#3c4043] disabled:cursor-not-allowed disabled:bg-[#dadce0] disabled:!text-[#80868b]">
          {isJoining ? "Joining..." : "Join interviewer room"}
        </button>
      </aside>
    </div>
  );
}

function LivePanel({
  join,
  aiState,
  isRequestingAiControl,
  roomStatus,
  callVideoRef,
  remoteVideoRef,
  hasRemoteVideo,
  isMicEnabled,
  isCameraEnabled,
  onAiControl,
  onToggleMic,
  onToggleCamera,
  onLeave,
}: {
  readonly join: JoinResponse | null;
  readonly aiState: AiState;
  readonly isRequestingAiControl: boolean;
  readonly roomStatus: string;
  readonly callVideoRef: React.RefObject<HTMLVideoElement | null>;
  readonly remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  readonly hasRemoteVideo: boolean;
  readonly isMicEnabled: boolean;
  readonly isCameraEnabled: boolean;
  readonly onAiControl: () => void;
  readonly onToggleMic: () => void;
  readonly onToggleCamera: () => void;
  readonly onLeave: () => void;
}) {
  const aiLabel = aiState === "not_started" ? "Start AI" : aiState === "running" ? "Stop AI" : "Resume AI";
  return (
    <div className="relative flex min-h-[calc(100svh-40px)] flex-col overflow-hidden bg-[#111214] text-white">
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-5 py-4 text-sm">
        <span className="truncate font-medium">{join?.room ?? "Interviewer room"}</span>
        <span className="rounded-full bg-[#2b2c2f] px-3 py-2 text-xs text-[#e8eaed]">{roomStatus}</span>
      </header>
      <main className="grid flex-1 gap-3 px-3 pb-28 pt-20 md:grid-cols-2">
        <VideoTile label="Candidate" videoRef={remoteVideoRef} visible={hasRemoteVideo} emptyText="Waiting for candidate" />
        <VideoTile label="You" videoRef={callVideoRef} visible={isCameraEnabled} emptyText="Camera is off" mirrored />
      </main>
      <footer className="absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-center gap-3 bg-gradient-to-t from-[#111214] via-[#111214]/95 to-transparent px-4 py-4">
        <ControlButton label={isMicEnabled ? "Mute microphone" : "Unmute microphone"} active={isMicEnabled} onClick={onToggleMic}><MicIcon muted={!isMicEnabled} /></ControlButton>
        <ControlButton label={isCameraEnabled ? "Turn camera off" : "Turn camera on"} active={isCameraEnabled} onClick={onToggleCamera}><CameraIcon disabled={!isCameraEnabled} /></ControlButton>
        <button type="button" onClick={onAiControl} disabled={isRequestingAiControl} className="h-12 rounded-full bg-[#8ab4f8] px-5 text-sm font-medium text-[#202124] transition hover:bg-[#aecbfa] disabled:cursor-wait disabled:opacity-70">
          {isRequestingAiControl ? "Saving..." : aiLabel}
        </button>
        <button type="button" aria-label="Leave interviewer room" title="Leave interviewer room" onClick={onLeave} className="grid h-12 w-[72px] place-items-center rounded-full bg-[#ea4335] text-white transition hover:bg-[#d93025]">
          <EndCallIcon />
        </button>
      </footer>
    </div>
  );
}

function VideoTile({ label, videoRef, visible, emptyText, mirrored = false }: { readonly label: string; readonly videoRef: React.RefObject<HTMLVideoElement | null>; readonly visible: boolean; readonly emptyText: string; readonly mirrored?: boolean }) {
  return (
    <div className="relative min-h-[360px] overflow-hidden rounded-[16px] bg-[#202124]">
      <video ref={videoRef} aria-label={label} autoPlay muted={label === "You"} playsInline style={{ transform: mirrored ? "scaleX(-1)" : undefined }} className={`h-full w-full object-cover transition ${visible ? "opacity-100" : "opacity-0"}`} />
      {!visible ? <div className="absolute inset-0 grid place-items-center text-center"><div><div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[#3c4043] text-2xl">{label[0]}</div><div className="mt-4 text-sm text-[#bdc1c6]">{emptyText}</div></div></div> : null}
      <div className="absolute bottom-4 left-4 rounded-md bg-black/60 px-3 py-1.5 text-sm font-medium text-white">{label}</div>
    </div>
  );
}

function CenteredPanel({ title, detail, actionLabel, onAction }: { readonly title: string; readonly detail: string; readonly actionLabel?: string; readonly onAction?: () => void }) {
  return (
    <div className="grid min-h-[620px] place-items-center bg-[#f8fafd] p-8 text-center">
      <div><h2 className="text-3xl font-normal text-[#202124]">{title}</h2><p className="mt-3 max-w-md text-sm leading-6 text-[#5f6368]">{detail}</p>{actionLabel && onAction ? <button type="button" onClick={onAction} className="mt-6 rounded-full bg-[#1a73e8] px-7 py-3 text-sm font-medium !text-white">{actionLabel}</button> : null}</div>
    </div>
  );
}

function ControlButton({ label, active, onClick, children }: { readonly label: string; readonly active: boolean; readonly onClick: () => void; readonly children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className={`grid h-12 w-12 place-items-center rounded-full transition ${active ? "bg-[#3c4043] text-white hover:bg-[#4a4d51]" : "bg-[#ea4335] text-white hover:bg-[#d93025]"}`}>{children}</button>;
}

async function setLocalTrackEnabled(track: LocalAudioTrack | LocalVideoTrack | null, enabled: boolean): Promise<void> {
  if (!track) return;
  if (enabled) await track.unmute();
  else await track.mute();
}

function MicIcon({ muted }: { readonly muted: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M19 10v1a7 7 0 0 1-14 0v-1" /><path d="M12 18v3" /><path d="M8 21h8" />{muted ? <path d="M4 4l16 16" /> : null}</svg>;
}

function CameraIcon({ disabled }: { readonly disabled: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 10 20 7v10l-5-3" /><rect x="3" y="6" width="12" height="12" rx="2" />{disabled ? <path d="M4 4l16 16" /> : null}</svg>;
}

function EndCallIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7.5 14.5a9 9 0 0 1 9 0" /><path d="M6 15.5 4.5 17a2 2 0 0 0 0 2.8l.2.2a2 2 0 0 0 2.8 0L9 18.5a2 2 0 0 0 .4-2.2" /><path d="M15 18.5 16.5 20a2 2 0 0 0 2.8 0l.2-.2a2 2 0 0 0 0-2.8L18 15.5a2 2 0 0 0-3 .8" /></svg>;
}
```

- [ ] **Step 5: Run source test**

Run:

```bash
pnpm --filter @puddle/platform test -- tests/interviewer-room-source.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Run platform build**

Run:

```bash
pnpm --filter @puddle/platform build
```

Expected: PASS. If TypeScript rejects `React.RefObject` because only `ReactNode` was imported, add `type RefObject` to the React import and replace `React.RefObject` references with `RefObject`.

- [ ] **Step 7: Commit interviewer UI**

```bash
git add platform/app/dashboard/interviews/[sessionId]/join/page.tsx platform/app/dashboard/interviews/[sessionId]/join/InterviewerJoinClient.tsx platform/tests/interviewer-room-source.test.mjs
git commit -m "Add full-screen interviewer join room"
```

---

### Task 6: Dashboard Create-And-Join Launcher

**Files:**
- Create: `platform/app/dashboard/roles/[roleId]/CreateAndJoinInterviewForm.tsx`
- Modify: `platform/app/dashboard/roles/[roleId]/page.tsx`
- Modify: `platform/tests/interviewer-room-source.test.mjs`
- Modify: `platform/tests/dashboard-foundation-source.test.mjs`

- [ ] **Step 1: Add failing source tests for launcher**

Append to `platform/tests/interviewer-room-source.test.mjs`:

```js
const rolePage = await source("../app/dashboard/roles/[roleId]/page.tsx");
const createJoinForm = await source("../app/dashboard/roles/[roleId]/CreateAndJoinInterviewForm.tsx");

test("role workspace exposes create and join interviewer launcher", () => {
  assert.match(rolePage, /CreateAndJoinInterviewForm/);
  assert.match(createJoinForm, /Create and join interview/);
  assert.match(createJoinForm, /candidateEmail/);
  assert.match(createJoinForm, /\/api\/interviews/);
  assert.match(createJoinForm, /interviewerJoinUrl/);
  assert.match(createJoinForm, /router\.push/);
});
```

- [ ] **Step 2: Run source test and verify it fails**

Run:

```bash
pnpm --filter @puddle/platform test -- tests/interviewer-room-source.test.mjs
```

Expected: FAIL because the form does not exist.

- [ ] **Step 3: Create launcher form**

Create `platform/app/dashboard/roles/[roleId]/CreateAndJoinInterviewForm.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface CreateAndJoinInterviewFormProps {
  readonly roleLabel: string;
}

interface CreateInterviewResponse {
  readonly interviewerJoinUrl?: string;
  readonly error?: string;
}

export function CreateAndJoinInterviewForm({ roleLabel }: CreateAndJoinInterviewFormProps) {
  const router = useRouter();
  const [candidateEmail, setCandidateEmail] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = candidateEmail.trim();
    if (!email) {
      setStatus("Enter the candidate email first.");
      return;
    }

    setIsSubmitting(true);
    setStatus("Creating interview...");
    try {
      const response = await fetch("/api/interviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateEmail: email }),
      });
      const payload = (await response.json().catch(() => ({}))) as CreateInterviewResponse;
      if (!response.ok || !payload.interviewerJoinUrl) {
        setStatus(payload.error ?? "Interview could not be created.");
        return;
      }
      router.push(payload.interviewerJoinUrl);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
        Candidate email
        <input
          type="email"
          value={candidateEmail}
          onChange={(event) => setCandidateEmail(event.target.value)}
          className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100"
        />
      </label>
      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex min-h-10 items-center justify-center rounded-md bg-slate-950 px-3 text-sm font-semibold !text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {isSubmitting ? "Creating..." : "Create and join interview"}
      </button>
      <div role="status" className="min-h-5 text-xs font-medium text-slate-500">
        {status || `Creates a host room for ${roleLabel}.`}
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Add launcher to role page**

In `platform/app/dashboard/roles/[roleId]/page.tsx`, add:

```ts
import { CreateAndJoinInterviewForm } from "./CreateAndJoinInterviewForm";
```

Replace the paragraph inside the `SectionPanel title="Send interviews"` aside with:

```tsx
            <p className="mb-4 text-sm leading-6 text-slate-600">
              Start a hosted Puddle room, copy the candidate link, and bring the AI interviewer in from the call controls.
            </p>
            <CreateAndJoinInterviewForm roleLabel={roleLabel} />
```

- [ ] **Step 5: Update dashboard foundation source test**

In `platform/tests/dashboard-foundation-source.test.mjs`, the test named `"dashboard chrome uses Ashby-first navigation without fake role controls"` currently asserts `CreateInterviewCard` is absent. Keep that assertion. Add this assertion near the role workspace test:

```js
assert.match(roleDetailSource, /CreateAndJoinInterviewForm/);
assert.match(roleDetailSource, /Start a hosted Puddle room/);
```

- [ ] **Step 6: Run platform source tests**

Run:

```bash
pnpm --filter @puddle/platform test -- tests/interviewer-room-source.test.mjs tests/dashboard-foundation-source.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Run platform build**

Run:

```bash
pnpm --filter @puddle/platform build
```

Expected: PASS.

- [ ] **Step 8: Commit dashboard launcher**

```bash
git add platform/app/dashboard/roles/[roleId]/CreateAndJoinInterviewForm.tsx platform/app/dashboard/roles/[roleId]/page.tsx platform/tests/interviewer-room-source.test.mjs platform/tests/dashboard-foundation-source.test.mjs
git commit -m "Add dashboard create-and-join interviewer launcher"
```

---

### Task 7: End-to-End Verification

**Files:**
- No required source changes unless verification finds a defect.

- [ ] **Step 1: Run backend focused tests**

Run:

```bash
pnpm --filter @puddle/backend test -- backend/test/interviewers.test.ts backend/test/invites.test.ts backend/test/livekit-egress.test.ts backend/test/migrations.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run platform focused tests**

Run:

```bash
pnpm --filter @puddle/platform test -- tests/interviewer-room-source.test.mjs tests/org-access-source.test.mjs tests/dashboard-foundation-source.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run package builds**

Run:

```bash
pnpm --filter @puddle/backend build
pnpm --filter @puddle/platform build
```

Expected: both PASS.

- [ ] **Step 4: Run full repo tests if focused tests pass**

Run:

```bash
pnpm test
```

Expected: PASS. If unrelated dirty-worktree tests fail, record the failing test names and confirm whether they pre-existed before changing this feature.

- [ ] **Step 5: Manual verification in local dev**

Run the connected dev stack:

```bash
pnpm dev
```

Manual checks:

1. Open dashboard as a same-org WorkOS user.
2. Navigate to a role workspace.
3. Enter a candidate email and click **Create and join interview**.
4. Confirm the host lands on `/dashboard/interviews/[sessionId]/join`.
5. Confirm the page is visually full-screen and shows **Copy candidate link**.
6. Copy the candidate URL and open it in a fresh unauthenticated browser profile.
7. Confirm the candidate URL shows the existing consent/preflight flow.
8. Join as interviewer and confirm the LiveKit token request succeeds.
9. Click **Start AI**, **Stop AI**, and **Resume AI**.
10. Confirm backend `events` / `audit_log` contain `ai_interviewer_start_requested`, `ai_interviewer_stop_requested`, and `ai_interviewer_resume_requested`.

- [ ] **Step 6: Commit verification notes if docs are updated**

If you add a verification note, create:

```text
docs/superpowers/verification/2026-06-18-interviewer-room-scaffolding.md
```

Commit it:

```bash
git add docs/superpowers/verification/2026-06-18-interviewer-room-scaffolding.md
git commit -m "Document interviewer room verification"
```

---

## Plan Self-Review

- Spec coverage: the plan covers authenticated interviewer route, candidate invite copy, candidate route preservation, explicit LiveKit participant roles, room capacity, interviewer-only AI control UI, durable AI control state/events, and auto-dispatch skip for interviewer-led sessions.
- Red-flag scan: every task has concrete code, commands, and expected outcomes.
- Type consistency: AI state names are `not_started`, `running`, and `stopped` on the platform; persisted backend states are `running` and `stopped`; control actions are `start`, `stop`, and `resume`.
- Scope check: true worker pause/resume is intentionally excluded. The plan records intent and prevents accidental auto-dispatch in interviewer-led sessions, matching the approved scaffolding scope.
