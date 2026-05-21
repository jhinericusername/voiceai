# Puddle Voice Interviewer Agent — repo instructions

## Coding standards
- Python code under `agent/` follows `docs/standards/python.md`.
- TypeScript code under `room/`, `review/`, `backend/` follows `docs/standards/typescript.md`.

## Layout
- `agent/` Python (uv, src layout under `agent/src/agent/`, tests under `agent/tests/`).
- `room/`, `review/`, `backend/` TypeScript pnpm workspace packages.
- `rubric/` rubric config data files. `corpus/` is gitignored.

## manual-gate operations
The autonomous build run must halt for operator approval before:
- applying a database schema migration,
- any deploy or release,
- bulk data writes to shared data,
- running an interview with a real candidate,
- enabling any reduction of human oversight over scoring.

## Commands
- Python tests: `cd agent && uv run pytest`
- TS tests: `pnpm -r test`
