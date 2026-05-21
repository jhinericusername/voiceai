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
cd backend && DATABASE_URL=postgresql://… pnpm migrate
```

Use exactly **one** migration path per environment — the Supabase MCP `apply_migration` **or** `pnpm migrate`, never both (the second run fails on "table already exists").

## 5. Tests

```bash
cd agent && uv run pytest          # 113 Python tests
pnpm -r test                       # 35 TypeScript tests (backend 26, review 5, room 4)
cd agent && uv run ruff check .    # Python lint
```

## 6. Run locally

### Backend API server
```bash
cd backend
pnpm build
node dist/server.js
```
Requires `DATABASE_URL`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`; optional `HOST` (default `0.0.0.0`), `PORT` (default `8080`). Endpoints: `POST /sessions` (internal scheduler), `POST /integration/sessions` (platform contract).

### Candidate room app
```bash
cd room && pnpm dev
```

### Reviewer app
```bash
cd review && pnpm dev
```

### Agent worker
The launcher is `agent/src/agent/worker/__main__.py` — it registers `entrypoint` under the agent name `puddle-interviewer` (the name `backend` dispatches to via `AgentDispatchClient.createDispatch`). Run it with a LiveKit Agents CLI subcommand — `dev` for local development, `start` for production:
```bash
cd agent && uv run --env-file ../.env python -m agent.worker dev
```
Requires `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`.

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

- **Video frame-pump** — `InterviewRunner` accepts an optional `VideoPerceptionPipeline`, but `_default_run_interview` does not construct one, and nothing samples frames from the candidate's LiveKit video track into `process_frame`. Integrity flags stay empty in a live run until this is wired. The turn-hint → turn-detector path is likewise unwired.
- **Object storage** — the S3-style path layout exists (`backend/src/storage/layout.ts`), but no object-storage client is wired; LiveKit Egress output and artifact upload need it.
- **No CI/CD** — tests and lint are run manually.
