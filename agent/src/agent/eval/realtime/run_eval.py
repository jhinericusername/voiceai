"""CLI driver for the realtime eval harness.

Usage:
    cd agent && uv run --env-file ../.env \\
        python -m agent.eval.realtime.run_eval --mode adaptive
    cd agent && uv run --env-file ../.env \\
        python -m agent.eval.realtime.run_eval --mode long --label my-run

Options:
    --mode   adaptive | long
                 adaptive  = terse cooperative candidate (short session)
                 long      = verbose tangent-prone candidate (~15 min)
    --label  arbitrary tag appended to the output filename (default: mode)
    --out    explicit output path; overrides the default runs/ naming
    --model  realtime model name (default: gpt-4o-realtime-preview)

No live API calls are made at import time.  All SDK imports are deferred
inside ``main()`` so the module is safe to import in unit tests.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path

_RUNS_DIR = Path(__file__).resolve().parent / "runs"

_ADAPTIVE_PERSONA = (
    "You are a mid-level software engineer with 5 years of Python experience. "
    "You give concise, direct answers. You stay on topic and answer exactly "
    "what is asked without tangents."
)

_LONG_PERSONA = (
    "You are a senior software engineer who loves to tell long stories. "
    "You frequently go off on tangents about unrelated past projects, ask "
    "clarifying questions back to the interviewer, and take 2-3 minutes per "
    "answer. Simulate a realistic ~15-minute interview session."
)

_DEFAULT_MODEL = "gpt-4o-realtime-preview"
_DEFAULT_CANDIDATE_MODEL = "claude-haiku-4-5"


def _build_argparser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Run the realtime eval harness against the live OpenAI API.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    ap.add_argument(
        "--mode",
        choices=["adaptive", "long"],
        default="adaptive",
        help="Candidate persona: adaptive=terse, long=verbose/tangent-prone",
    )
    ap.add_argument(
        "--label",
        default="",
        help="Tag appended to the output filename (e.g. 'baseline')",
    )
    ap.add_argument(
        "--out",
        default="",
        help="Explicit output path; overrides the default runs/ naming",
    )
    ap.add_argument(
        "--model",
        default=os.environ.get("EVAL_REALTIME_MODEL", _DEFAULT_MODEL),
        help="OpenAI realtime model name",
    )
    ap.add_argument(
        "--max-turns",
        type=int,
        default=20,
        help="Maximum agent turns before the harness stops",
    )
    return ap


async def _run(args: argparse.Namespace) -> None:  # pragma: no cover
    """Async body — all live SDK usage lives here."""
    import anthropic

    from agent.controller.realtime.guardrail_monitor import GuardrailMonitor
    from agent.eval.realtime.adaptive_candidate import AdaptiveCandidate
    from agent.eval.realtime.harness import run_session
    from agent.rubric.loader import load_rubric
    from agent.scoring.scorer import Scorer
    from agent.voice.realtime.openai_ws_adapter import OpenAIWebsocketRealtimeSession

    rubric = load_rubric()

    persona = _LONG_PERSONA if args.mode == "long" else _ADAPTIVE_PERSONA
    anthropic_client = anthropic.Anthropic()
    candidate = AdaptiveCandidate(
        client=anthropic_client,
        persona=persona,
        model=_DEFAULT_CANDIDATE_MODEL,
    )

    session = OpenAIWebsocketRealtimeSession(
        model=args.model,
        output_modalities=["text"],
    )

    scorer = Scorer.default()
    guardrail_monitor = GuardrailMonitor.default()

    measurement = await run_session(
        candidate,
        session,
        rubric,
        scorer=scorer,
        guardrail_monitor=guardrail_monitor,
        max_turns=args.max_turns,
    )

    # Determine output path.
    if args.out:
        out_path = Path(args.out)
    else:
        label = args.label or args.mode
        _RUNS_DIR.mkdir(parents=True, exist_ok=True)
        out_path = _RUNS_DIR / f"{args.mode}_{label}.json"

    payload = {
        "mode": args.mode,
        "label": args.label or args.mode,
        "model": args.model,
        "max_turns": args.max_turns,
        "measurement": measurement.model_dump(),
    }
    out_path.write_text(json.dumps(payload, indent=2))
    print(f"EvalMeasurement written to {out_path}")
    print(
        f"  coverage: {measurement.coverage_count}/{measurement.total_required}"
        f"  in_order: {measurement.in_order}"
        f"  duration: {measurement.duration_seconds:.1f}s"
        f"  guardrail_violations: {len(measurement.guardrail_violations)}"
    )


def main() -> None:  # pragma: no cover
    ap = _build_argparser()
    args = ap.parse_args()
    asyncio.run(_run(args))


if __name__ == "__main__":  # pragma: no cover
    main()
