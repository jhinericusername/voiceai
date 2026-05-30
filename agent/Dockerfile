# syntax=docker/dockerfile:1

# Build from the repository root:
#   docker build -f agent/Dockerfile -t puddle-agent .

FROM ghcr.io/astral-sh/uv:0.8.3-python3.12-bookworm-slim AS deps
WORKDIR /app/agent

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

COPY agent/pyproject.toml agent/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/agent/.venv/bin:${PATH}" \
    PYTHONPATH="/app/agent/src"

WORKDIR /app

RUN groupadd --system puddle \
    && useradd --system --gid puddle --create-home --home-dir /home/puddle puddle \
    && mkdir -p /app/artifacts \
    && chown -R puddle:puddle /app/artifacts

COPY --from=deps /app/agent/.venv /app/agent/.venv
COPY agent/src /app/agent/src
COPY rubric /app/rubric

USER puddle
WORKDIR /app/agent

STOPSIGNAL SIGTERM

CMD ["python", "-m", "agent.worker", "start"]
