"""Realtime eval harness: pure measurement core + live session driver.

The module has two distinct surfaces:

``measure()`` — pure, synchronous, fully unit-tested.
    Takes a transcript, an ``InterviewPlan``, guardrail events, and a duration
    and returns an ``EvalMeasurement``.  No I/O, no imports of live SDKs.

``run_session()`` — async, live-API only, ``# pragma: no cover``.
    Drives an ``OpenAIWebsocketRealtimeSession`` with an ``AdaptiveCandidate``
    to produce an ``EvalMeasurement`` for Tasks 15-16.
"""

from __future__ import annotations

import asyncio
import difflib
import time
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict

from agent.controller.realtime.control_bus import ControlBus
from agent.controller.realtime.coverage import CoverageTracker
from agent.controller.realtime.plan_builder import InterviewPlan, build_interview_plan
from agent.domain.types import TranscriptTurn

if TYPE_CHECKING:
    from agent.eval.realtime.adaptive_candidate import AdaptiveCandidate
    from agent.voice.realtime.interface import RealtimeSession

# A question is "covered" if the agent's best matching turn has at least this
# difflib SequenceMatcher ratio against the question's verbatim_text.
_COVERAGE_SIMILARITY_THRESHOLD = 0.80


# ---------------------------------------------------------------------------
# EvalMeasurement
# ---------------------------------------------------------------------------


class EvalMeasurement(BaseModel):
    """Frozen result of one measured eval run."""

    model_config = ConfigDict(frozen=True)

    coverage_count: int
    total_required: int
    in_order: bool
    per_question_similarity: dict[str, float]  # question_id -> best difflib ratio
    guardrail_violations: list[str]
    duration_seconds: float


# ---------------------------------------------------------------------------
# Pure measurement
# ---------------------------------------------------------------------------


def measure(
    transcript: list[TranscriptTurn],
    plan: InterviewPlan,
    guardrail_events: list[str],
    duration_seconds: float,
) -> EvalMeasurement:
    """Deterministically measure how faithfully the agent ran the interview.

    Args:
        transcript: All turns (agent + candidate) from the session.
        plan: The ``InterviewPlan`` built for this rubric, which carries the
            ordered ``required_coverage`` list of (question_id, verbatim_text).
        guardrail_events: Guardrail violation strings collected during the run.
        duration_seconds: Wall-clock duration of the session.

    Returns:
        An ``EvalMeasurement`` with coverage, order, per-question similarity,
        guardrail violations, and duration.
    """
    agent_turns = [t for t in transcript if t.speaker == "agent"]

    per_question_similarity: dict[str, float] = {}
    # Maps question_id → index of the first agent turn whose similarity
    # exceeded the threshold (used for ordering check).
    first_match_index: dict[str, int] = {}

    for req in plan.required_coverage:
        best_sim = 0.0
        best_idx: int | None = None
        for idx, turn in enumerate(agent_turns):
            sim = difflib.SequenceMatcher(None, turn.text, req.verbatim_text).ratio()
            if sim > best_sim:
                best_sim = sim
                best_idx = idx
        per_question_similarity[req.question_id] = best_sim
        if best_sim >= _COVERAGE_SIMILARITY_THRESHOLD and best_idx is not None:
            first_match_index[req.question_id] = best_idx

    coverage_count = len(first_match_index)

    # in_order: the first-matching turn indices of covered questions must be
    # non-decreasing when iterated in required_coverage (script) order.
    covered_indices = [
        first_match_index[req.question_id]
        for req in plan.required_coverage
        if req.question_id in first_match_index
    ]
    in_order = all(a <= b for a, b in zip(covered_indices, covered_indices[1:], strict=False))

    return EvalMeasurement(
        coverage_count=coverage_count,
        total_required=len(plan.required_coverage),
        in_order=in_order,
        per_question_similarity=per_question_similarity,
        guardrail_violations=list(guardrail_events),
        duration_seconds=duration_seconds,
    )


# ---------------------------------------------------------------------------
# Live session driver  (pragma: no cover — only run in Tasks 15-16)
# ---------------------------------------------------------------------------


async def run_session(
    candidate: AdaptiveCandidate,
    session: RealtimeSession,
    rubric: Any,
    *,
    scorer: Any,
    guardrail_monitor: Any,
    max_turns: int,
) -> EvalMeasurement:
    """Drive a full interview and return the ``EvalMeasurement``.

    The session MUST be configured for TEXT output modality (not audio-only).
    Routes all tool calls through ``ControlBus`` so early ``close_interview``
    calls are denied and uncovered questions are re-issued (COVERAGE_BACKSTOP).
    Coverage is only complete — and close accepted — once every required question
    has been spoken and answered.
    """
    from agent.voice.realtime.interface import OutputTranscript, ToolCall

    plan = build_interview_plan(rubric)
    coverage = CoverageTracker(plan.required_coverage)
    bus = ControlBus(
        plan,
        coverage,
        probe_provider=lambda c: "Could you say a bit more about that?",
        deflection_line="Let's keep this on track and continue.",
    )

    transcript: list[TranscriptTurn] = []
    guardrail_events: list[str] = []
    turn_index = 0
    agent_turns = 0
    current_qid: str | None = None
    ended = False

    start = time.monotonic()

    await session.start(instructions=plan.instructions, tools=plan.tool_schemas)

    async for event in session.events():
        if isinstance(event, OutputTranscript):
            transcript.append(
                TranscriptTurn(
                    turn_index=turn_index,
                    speaker="agent",
                    text=event.text,
                    question_id=current_qid,
                )
            )
            turn_index += 1

            verdict = await asyncio.to_thread(guardrail_monitor.check_turn, event.text)
            if verdict.violation:
                guardrail_events.append(f"guardrail:{verdict.kind}:{event.text[:80]}")

            agent_turns += 1
            if agent_turns >= max_turns:
                break

            candidate_reply = await asyncio.to_thread(candidate.reply, event.text)

            transcript.append(
                TranscriptTurn(
                    turn_index=turn_index,
                    speaker="candidate",
                    text=candidate_reply,
                    question_id=None,
                )
            )
            turn_index += 1

            if current_qid:
                coverage.mark_covered(current_qid)

            await session.inject_message(candidate_reply)

        elif isinstance(event, ToolCall):
            args = event.arguments
            if event.name == "advance_question":
                next_qid = args.get("next_question_id", "")
                res = await asyncio.to_thread(bus.advance_question, next_qid)
            elif event.name == "request_probe":
                res = await asyncio.to_thread(bus.request_probe, args.get("category", ""))
            elif event.name == "flag_off_script":
                reason = args.get("reason", "")
                guardrail_events.append(f"off_script:{reason}")
                res = await asyncio.to_thread(bus.flag_off_script, reason)
            elif event.name == "close_interview":
                res = await asyncio.to_thread(bus.close_interview)
            else:
                res = None

            if res is not None:
                await session.respond_to_tool(event.call_id, res.speak)
                if res.question_id:
                    current_qid = res.question_id
                if res.ended:
                    ended = True

        if ended:
            break

    duration = time.monotonic() - start
    await session.aclose()

    return measure(transcript, plan, guardrail_events, duration)
