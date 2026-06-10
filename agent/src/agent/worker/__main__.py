"""Launch the Puddle interviewer worker against LiveKit Cloud.

The worker registers under the agent name ``puddle-interviewer`` — the same
name the backend dispatches to (see ``backend/src/livekit/provision.ts``).
LiveKit credentials are read from the environment by the LiveKit Agents CLI:
``LIVEKIT_URL``, ``LIVEKIT_API_KEY``, ``LIVEKIT_API_SECRET``.

Run (the CLI takes a subcommand — ``dev`` for local development, ``start``
for production):

    uv run --env-file ../.env python -m agent.worker dev
"""

from livekit.agents import WorkerOptions, cli

from agent.worker.entrypoint import entrypoint, prewarm

if __name__ == "__main__":  # pragma: no cover — live LiveKit worker process
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name="puddle-interviewer",
        )
    )
