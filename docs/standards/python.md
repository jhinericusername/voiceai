# Python Coding Standards (ECC)

Applies to all code under `agent/`.

## Language & tooling
- Python 3.12; `uv` for env and dependency management.
- `ruff` for lint + import sort; `pytest` for tests (`asyncio_mode = auto`).
- All public functions and methods have full type hints; no bare `Any` without a comment.

## Structure
- Domain types are Pydantic v2 models in `agent/src/agent/domain/`.
- One module per component; modules expose a small, named public surface.
- No business logic in `__init__.py`.

## Style
- `snake_case` for functions/variables, `PascalCase` for classes, `UPPER_SNAKE` for constants.
- Prefer immutability: Pydantic models are `frozen=True` unless mutation is required.
- Functions do one thing; extract once a function exceeds ~40 lines.
- Errors are explicit exception types, never silent `except: pass`.

## Testing
- TDD: write the failing test first.
- Tests are deterministic — no network in unit tests; vendor SDKs are mocked.
- Each test asserts one behavior; name tests `test_<behavior>`.
