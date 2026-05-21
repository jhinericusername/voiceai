# TypeScript Coding Standards (ECC)

Applies to all code under `room/`, `review/`, `backend/`.

## Language & tooling
- TypeScript strict mode (`strict: true`, `noUncheckedIndexedAccess: true`).
- pnpm workspace; `vitest` for tests.
- ESM modules only.

## Structure
- Shared types live next to their feature; cross-package contracts are explicit.
- React apps: function components + hooks; no class components.
- Backend: Fastify plugins per concern; route handlers stay thin.

## Style
- `camelCase` for values, `PascalCase` for types/components, `UPPER_SNAKE` for constants.
- Prefer `const`; no `var`. Prefer `readonly` and immutable updates.
- No `any` — use `unknown` and narrow.
- Errors are typed; never swallow a rejected promise.

## Testing
- TDD: failing test first.
- Unit tests mock I/O; no live network.
- Name tests by behavior.
