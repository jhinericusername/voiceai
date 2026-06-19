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
    --model  realtime model name (default: gpt-realtime)

No live API calls are made at import time.  All SDK imports are deferred
inside ``main()`` so the module is safe to import in unit tests.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from dataclasses import dataclass
from pathlib import Path


# ---------------------------------------------------------------------------
# Transcript-quality metric (primary realtime-eval signal)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TranscriptQuality:
    """Result of measuring transcript quality for one realtime eval run.

    Attributes:
        required_questions_asked: Count of required question IDs that appeared
            in at least one agent turn.
        coverage_ratio: required_questions_asked / len(required_question_ids).
        speaker_attribution_ok: True iff every turn has a ``speaker`` value
            that is either ``"agent"`` or ``"candidate"``.
    """

    required_questions_asked: int
    coverage_ratio: float
    speaker_attribution_ok: bool


def measure_transcript_quality(
    turns: list[dict],
    required_question_ids: list[str],
) -> TranscriptQuality:
    """Measure transcript quality against the required question set.

    This is the PRIMARY metric for the realtime eval — it replaces
    live-score-fidelity as the top-level signal.  Offline scoring
    (``agent.scoring.scorer.Scorer``) remains available for a separate
    grading-quality run but is no longer reported here.

    Args:
        turns: List of turn dicts, each with at least ``"speaker"`` and
            optionally ``"questionId"``.  Speaker values should be ``"agent"``
            or ``"candidate"``.
        required_question_ids: The full ordered list of question IDs that the
            interview script requires the agent to ask.

    Returns:
        A frozen :class:`TranscriptQuality` dataclass with coverage counts,
        coverage ratio, and speaker-attribution health.
    """
    asked = {t.get("questionId") for t in turns if t.get("speaker") == "agent"}
    hit = sum(1 for qid in required_question_ids if qid in asked)
    total = max(1, len(required_question_ids))
    ok = all(t.get("speaker") in {"agent", "candidate"} for t in turns)
    return TranscriptQuality(
        required_questions_asked=hit,
        coverage_ratio=hit / total,
        speaker_attribution_ok=ok,
    )

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

_DEFAULT_MODEL = "gpt-realtime"
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
    ap.add_argument(
        "--candidate-model",
        default=_DEFAULT_CANDIDATE_MODEL,
        help="Anthropic model used for the AdaptiveCandidate",
    )
    return ap


async def _run(args: argparse.Namespace) -> None:  # pragma: no cover
    """Async body — all live SDK usage lives here."""
    import anthropic

    from agent.config import REALTIME
    from agent.controller.realtime.guardrail_monitor import GuardrailMonitor
    from agent.eval.realtime.adaptive_candidate import AdaptiveCandidate
    from agent.eval.realtime.harness import run_session, SessionResult
    from agent.rubric_loader import load_rubric
    from agent.voice.realtime.openai_ws_adapter import OpenAIWebsocketRealtimeSession

    # Rubric lives at <repo_root>/rubric/pilot-v1.yaml; run_eval.py is at
    # agent/src/agent/eval/realtime/run_eval.py so repo root is 5 levels up.
    _REPO_ROOT = Path(__file__).resolve().parents[5]
    rubric = load_rubric(_REPO_ROOT / "rubric" / "pilot-v1.yaml")

    persona = _LONG_PERSONA if args.mode == "long" else _ADAPTIVE_PERSONA
    anthropic_client = anthropic.Anthropic()
    candidate = AdaptiveCandidate(
        client=anthropic_client,
        persona=persona,
        model=args.candidate_model,
    )

    session = OpenAIWebsocketRealtimeSession(
        model=args.model,
        output_modalities=["text"],
    )

    guardrail_monitor = GuardrailMonitor(client=anthropic_client, model=REALTIME.guardrail_model)

    result: SessionResult = await run_session(
        candidate,
        session,
        rubric,
        guardrail_monitor=guardrail_monitor,
        max_turns=args.max_turns,
    )
    measurement = result.measurement

    # Determine output path.
    if args.out:
        out_path = Path(args.out)
    else:
        label = args.label or args.mode
        _RUNS_DIR.mkdir(parents=True, exist_ok=True)
        out_path = _RUNS_DIR / f"{args.mode}_{label}.json"

    # Build transcript-quality metric (PRIMARY realtime-eval signal).
    # Convert TranscriptTurn objects to the plain-dict shape that
    # measure_transcript_quality expects (it reads dict keys, not attributes).
    raw_turns = [
        {
            "speaker": t.speaker,
            "text": t.text,
            "questionId": t.question_id,
        }
        for t in result.transcript
    ]
    required_ids: list[str] = result.required_question_ids

    tq = measure_transcript_quality(raw_turns, required_question_ids=required_ids)

    payload = {
        "mode": args.mode,
        "label": args.label or args.mode,
        "model": args.model,
        "max_turns": args.max_turns,
        # PRIMARY: transcript-quality metric
        "transcript_quality": {
            "required_questions_asked": tq.required_questions_asked,
            "coverage_ratio": tq.coverage_ratio,
            "speaker_attribution_ok": tq.speaker_attribution_ok,
            "guardrail_leak_count": len(measurement.guardrail_violations),
        },
        # SECONDARY: legacy structural measurement (retained for grading-quality analysis)
        "measurement": measurement.model_dump(),
    }
    out_path.write_text(json.dumps(payload, indent=2))
    print(f"EvalMeasurement written to {out_path}")
    # PRIMARY metric headline
    print(
        f"  [transcript_quality]"
        f"  questions_asked: {tq.required_questions_asked}/{len(required_ids)}"
        f"  coverage_ratio: {tq.coverage_ratio:.2f}"
        f"  attribution_ok: {tq.speaker_attribution_ok}"
        f"  guardrail_leaks: {len(measurement.guardrail_violations)}"
    )
    # SECONDARY legacy line (kept for diff visibility)
    print(
        f"  [legacy]"
        f"  coverage: {measurement.coverage_count}/{measurement.total_required}"
        f"  in_order: {measurement.in_order}"
        f"  duration: {measurement.duration_seconds:.1f}s"
    )


def main() -> None:  # pragma: no cover
    ap = _build_argparser()
    args = ap.parse_args()
    asyncio.run(_run(args))


if __name__ == "__main__":  # pragma: no cover
    main()
