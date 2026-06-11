# Puddle Voice Interviewer Agent — Run & Deploy Runbook

How to set up, test, run, and deploy the monorepo.

## Components

| Path | What | Runtime |
|---|---|---|
| `agent/` | LiveKit Agents worker — Voice I/O, Interview Controller, Scorer, Probe Generator, Video Perception | Python 3.12 (uv) |
| `backend/` | Scheduler/API, Orchestrator, Finalization, platform integration | Node 20+ (Fastify) |
| `room/` | Candidate interview web app | React + Vite (static build) |
| `review/` | Internal reviewer web app | React + Vite (static build) |
| `rubric/` | Rubric config (`pilot-v1.yaml`) | data |
| `corpus/` | Human-scored eval corpus (gitignored) | data |

## 1. Prerequisites

- **Node 20+** and **pnpm 9** — `corepack enable pnpm`
- **uv** — `brew install uv` (or https://astral.sh/uv). uv fetches and manages Python 3.12 automatically.
- A **PostgreSQL** database (this project uses Supabase).
- Provider accounts: **Anthropic**, **Google AI (Gemini)**, **Deepgram**, **Cartesia**, **LiveKit Cloud**.

## 2. Install

```bash
cd agent && uv sync --extra dev && cd ..
pnpm install
```

## 3. Environment

```bash
cp .env.example .env
```

Fill in every value — `.env.example` documents each variable and where to obtain it. Processes read these from the environment; load `.env` via your process manager or export the vars before launch. `.env` is gitignored.

## 4. Database

The schema (`backend/migrations/001_init.sql` — 6 tables) is **already applied** to the Supabase project via the Supabase MCP. For any fresh environment:

```bash
corepack pnpm@9.12.0 migrate:backend
```

Use exactly **one** migration path per environment — the Supabase MCP `apply_migration` **or** `pnpm migrate`, never both (the second run fails on "table already exists").

## 5. Tests

```bash
cd agent && uv run pytest          # 113 Python tests
pnpm -r test                       # 35 TypeScript tests (backend 26, review 5, room 4)
cd agent && uv run ruff check .    # Python lint
```

## 6. Run locally

### Connected platform against deployed dev

Use this for the normal product/UI workflow. It runs the platform locally and
forwards backend calls to the deployed dev backend through AWS SSM:

```bash
AWS_PROFILE=<dev-profile> pnpm dev:connected
```

Prerequisites:

- AWS CLI authenticated to the dev account.
- Session Manager plugin installed.
- The dev stack has `DevTunnelInstanceId` and `BackendInternalBaseUrl` outputs.
- `platform/.env.local` contains local WorkOS and site URL values.

The command starts a local tunnel on `127.0.0.1:18080` by default and runs the
platform with `PUDDLE_BACKEND_BASE_URL=http://127.0.0.1:18080`. Override the
tunnel port with `PUDDLE_CONNECTED_BACKEND_PORT`.

### Connected local backend against deployed dev resources

Use this only when changing backend code. It runs the backend locally while
forwarding Postgres traffic to the deployed dev RDS instance:

```bash
AWS_PROFILE=<dev-profile> LIVEKIT_URL=<wss://dev-livekit-host> pnpm dev:backend:connected
```

The command starts an RDS tunnel on `127.0.0.1:15432`, runs the backend on
`127.0.0.1:8080`, and starts the platform pointed at that local backend.
Override ports with `PUDDLE_CONNECTED_DB_PORT` and `PORT`.

Ashby self-serve onboarding requires `PUDDLE_INTEGRATION_SECRET_KEY` in the
backend runtime. The deployed backend receives it from Secrets Manager. If you
run `pnpm dev:backend:connected`, export the same dev secret locally before
testing Ashby onboarding routes.

Do not run migrations automatically from these workflows. Database migrations
remain a manual-gate operation.

### Backend API server without deployed resources

```bash
corepack pnpm@9.12.0 dev:backend
```
Local backend scripts load `../.env.local` from the repo root. Requires `DATABASE_URL`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`; optional `HOST` (default `0.0.0.0`), `PORT` (default `8080`). Endpoints: `POST /sessions` (internal scheduler), `POST /integration/sessions` (platform contract), `POST /candidate/invites/:token/join` (candidate invite join).

Health checks use `GET /healthz`; it returns 200 without touching Postgres,
LiveKit, or provider APIs.

### Candidate room app
```bash
cd room && pnpm dev
```

### Reviewer app
```bash
cd review && pnpm dev
```

### Agent worker
The launcher is `agent/src/agent/worker/__main__.py` — it registers `entrypoint` under the agent name `puddle-interviewer` (the name `backend` dispatches to via `AgentDispatchClient.createDispatch`). The voice loop is **real**: on dispatch the worker joins the room and runs an `AgentSession` with **Deepgram STT + Cartesia TTS + Silero VAD + the multilingual turn detector**, drives scripted prompts verbatim via `session.say()`, runs the Interview Controller / Scorer / Probe Generator, and persists the final `Assessment` to Postgres via asyncpg. Run it with a LiveKit Agents CLI subcommand — `dev` for local development, `start` for production:
```bash
cd agent && uv run --env-file ../.env python -m agent.worker dev
```
Requires `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`, `DATABASE_URL`.

### Run a test interview

End-to-end local loop — backend issues a candidate join token, room app self-serves a session and connects, agent worker joins on dispatch and runs the interview by voice, finalization writes the Assessment to Postgres.

1. **Terminal 1 — backend API** (issues join tokens, persists sessions):
   ```bash
   cd backend && pnpm install && pnpm build && node --env-file=../.env dist/server.js
   ```

2. **Terminal 2 — one-time model download** (Silero VAD + multilingual turn detector weights):
   ```bash
   cd agent && uv sync --extra dev && uv run --env-file ../.env python -m agent.worker download-files
   ```

3. **Terminal 2 — agent worker** (registers `puddle-interviewer`, waits for dispatch):
   ```bash
   cd agent && uv run --env-file ../.env python -m agent.worker dev
   ```

4. **Terminal 3 — room app** (Vite dev server; reads `VITE_BACKEND_URL`, defaults to `http://localhost:8080` — only set it if the backend isn't on that origin):
   ```bash
   cd room && pnpm install && pnpm dev
   ```

5. **Browser** — open the URL Vite prints. Click through **Landing → Consent → Preflight → WaitingRoom**, then **Join interview**. The room app calls `POST /integration/sessions` to self-serve `{ sessionId, room, token, wsUrl }`, connects with `livekit-client`, and the worker takes the turn. Complete the interview by voice.

6. **Verify in Postgres** (Supabase SQL editor, or `psql "$DATABASE_URL"`):
   ```sql
   select session_id, status from sessions order by created_at desc limit 1;
   -- expect: status = 'review_ready'

   select session_id, category_scores from assessments order by created_at desc limit 1;
   -- expect: category_scores contains the four rubric categories
   ```

## 7. Calibration (Scorer evaluation gate)

```bash
cd agent && ANTHROPIC_API_KEY=… uv run python -m agent.eval.calibrate
```
Needs human-scored corpus JSON under `corpus/`. See `docs/calibration/README.md`. Approving the Scorer for live scoring is a reduction-of-oversight decision requiring operator **and employment-counsel** sign-off.

## 8. Deploy

| Component | Shape | Notes |
|---|---|---|
| Agent worker | Long-running process / container | Connects outbound to LiveKit Cloud; scale horizontally by running N workers. Needs all agent + provider keys. |
| Backend server | Node service / container | Exposes the HTTP API; needs DB + LiveKit creds. Run migrations once per environment first. |
| `room`, `review` | Static `dist/` (`pnpm build`) | Deploy to any static host / CDN. |
| LiveKit | LiveKit Cloud project | Register the `puddle-interviewer` agent; configure Egress for recording. |
| Object storage | S3-compatible bucket | For interview media/artifacts — see §9. |

## 9. Known v1 gaps

These were out of the v1 implementation plan's scope — track them before a production launch:

- **LiveKit Egress / S3 recording** — out of scope for v1. The S3-style path layout exists (`backend/src/storage/layout.ts`), but no object-storage client is wired and no Egress is configured; interview audio/video is not persisted to durable storage.
- **Reviewer (`review/`) app** — UI shell only; not wired to live Assessments.
- **Platform integration** — only the local `/integration/sessions` contract exists; no external ATS / scheduler integration.
- **Calibration not approved for live scoring** — the calibration harness exists (§7) but the Scorer has not cleared the calibration gate; approving it for live use is a reduction-of-oversight decision requiring operator and employment-counsel sign-off.
- **Production hosting / deploy** — out of scope for v1; §8 describes the shape but no environment is stood up.
- **No CI/CD** — tests and lint are run manually.

**Deferred by design (not gaps):**

- **Video perception** — `InterviewRunner` accepts an optional `VideoPerceptionPipeline` and the integrity-flag path is wired through to the Assessment, but live video frame sampling and Gemini-backed perception are intentionally out of scope for this integration. `GEMINI_API_KEY` is left blank in `.env`; integrity flags stay empty in a live run.

### AWS backend deployment

The CDK app can deploy the backend as a private Fargate service behind an
internal ALB once a backend image has been pushed to the stack-created ECR repo.
Deploy fresh environments first with `deployBackendService=true`,
`backendDesiredCount=0`, `backendImageTag=<tag>`, and `liveKitUrl=<wss://...>`.
Public backend exposure remains blocked until request auth is implemented.

Run database migrations as a one-off ECS task from the emitted
`BackendMigrationTaskDefinitionArn`, then redeploy with `backendDesiredCount=1`
before sending real traffic to the backend.
