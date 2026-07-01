"""Local console harness — talk to an exact copy of the deployed interviewer.

Production runs the interview purely from the prompt (no control tools; see
``worker.entrypoint`` ``control_tools_enabled=False``). This harness reuses the
SAME instructions (``build_interview_plan(..., include_tools=False)``) and the
SAME realtime model config (``build_realtime_model`` — ash voice, speed, semantic
VAD) as the deployed bot, but over your local mic/speakers via LiveKit Agents
console mode. No LiveKit server, backend, or candidate invite required.

What it does NOT run: the server-side guardrail monitor and event logging — those
don't change what you hear. Everything you experience — persona, accent, voice,
opener, questions, closer, intelligent probing — is identical to production.

Run:  ./scripts/local-interview.sh                         (from the repo root)
  or: cd agent && uv run python -m agent.local_interview console
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from agent.config import REALTIME
from agent.controller.realtime.plan_builder import build_interview_plan
from agent.rubric_loader import load_rubric
from agent.voice.realtime.livekit_adapter import (
    _OPENER_NUDGE,
    attach_interruption_logging,
    build_agent_session,
    build_realtime_model,
)

logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).parents[3]
_SCRIPT_VERSION = os.environ.get("PUDDLE_SCRIPT_VERSION", "pilot-v1")


def _load_env_local() -> None:
    """Load repo-root ``.env.local`` into ``os.environ`` (never overriding existing)."""
    env_path = _REPO_ROOT / ".env.local"
    if not env_path.exists():
        return
    for raw in env_path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


async def entrypoint(ctx) -> None:  # pragma: no cover - vendor console I/O
    """Join the local console room and run the exact production interviewer."""
    rubric = load_rubric(_REPO_ROOT / "rubric" / f"{_SCRIPT_VERSION}.yaml")
    plan = build_interview_plan(rubric, include_tools=False)

    from livekit.agents import Agent

    await ctx.connect()
    session = build_agent_session(build_realtime_model(REALTIME.model))
    attach_interruption_logging(session)
    await session.start(Agent(instructions=plan.instructions), room=ctx.room)
    # Kick off the scripted opener — without this the model waits silently for
    # the candidate to speak first (semantic VAD only fires on a candidate turn).
    session.generate_reply(instructions=_OPENER_NUDGE)
    logger.info("local interview started (script=%s, model=%s)", _SCRIPT_VERSION, REALTIME.model)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    _load_env_local()
    if not os.environ.get("OPENAI_API_KEY"):
        raise SystemExit(
            "OPENAI_API_KEY is not set — expected it in the repo-root .env.local."
        )

    from livekit.agents import WorkerOptions, cli

    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))


if __name__ == "__main__":
    main()
