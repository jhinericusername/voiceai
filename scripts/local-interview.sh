#!/usr/bin/env bash
# Talk to an exact copy of the deployed interviewer over your local mic/speakers.
# Same prompt + same realtime voice config as production (ash voice, speed, VAD),
# run in LiveKit Agents console mode — no server, backend, or candidate invite.
#
#   ./scripts/local-interview.sh            # console (talk to the bot)
#   ./scripts/local-interview.sh console
#
# Ctrl+C to quit. Requires OPENAI_API_KEY in repo-root .env.local (auto-loaded).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/agent"
exec uv run python -m agent.local_interview "${@:-console}"
