# Puddle Voice Interviewer Agent

Monorepo for the Puddle first-party interview room and AI interviewer agent.

- `agent/` — Python LiveKit Agents worker (Voice I/O, Controller, Scorer, Probe Generator, Video Perception)
- `room/` — candidate interview room (React + Vite)
- `review/` — internal reviewer tool (React + Vite)
- `backend/` — Scheduler/API, Orchestrator, Finalization (Node + Fastify)
- `rubric/` — rubric config data files
- `corpus/` — human-scored interview corpus (gitignored)
- `docs/` — specs, plans, standards

## Setup

```bash
cd agent && uv sync --extra dev   # Python agent
pnpm install                      # TypeScript workspace
```
