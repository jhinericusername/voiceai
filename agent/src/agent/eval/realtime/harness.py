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

import difflib
import time
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict

from agent.controller.realtime.plan_builder import InterviewPlan
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


async def run_session(  # pragma: no cover
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
    The ``OpenAIWebsocketRealtimeSession`` should be constructed with
    ``output_modalities=["text"]`` so the adapter emits ``OutputTranscript``
    events (it only translates ``response.output_text.*``, not
    ``response.audio_transcript.*``).

    Flow:
    1. Build the InterviewPlan from the rubric.
    2. Start the realtime session (sends ``session.update``).
    3. Consume the event stream turn by turn, up to ``max_turns``.
       - On ``OutputTranscript``: record an agent turn; ask the AdaptiveCandidate
         to reply; feed the reply back via ``session.inject_message()``.
       - On ``ToolCall``: check for ``close_interview`` to know when done;
         respond with a stub so the model continues.
    4. Collect guardrail violations from ``guardrail_monitor``.
    5. Call ``measure()`` and return.

    Network I/O throughout — excluded from unit-test coverage.
    """
    from agent.controller.realtime.plan_builder import build_interview_plan
    from agent.voice.realtime.interface import OutputTranscript, ToolCall

    plan = build_interview_plan(rubric)

    transcript: list[TranscriptTurn] = []
    guardrail_events: list[str] = []
    turn_index = 0
    agent_turns_count = 0
    ended = False

    start = time.monotonic()

    await session.start(instructions=plan.instructions, tools=plan.tool_schemas)

    async for event in session.events():
        if isinstance(event, OutputTranscript):
            # Record the agent turn.
            transcript.append(
                TranscriptTurn(
                    turn_index=turn_index,
                    speaker="agent",
                    text=event.text,
                    question_id=None,
                )
            )
            turn_index += 1

            # Check guardrails off-loop.
            verdict = guardrail_monitor.check_turn(event.text)
            if verdict.violation:
                guardrail_events.append(
                    f"guardrail:{verdict.kind}:{event.text[:80]}"
                )

            agent_turns_count += 1
            if agent_turns_count >= max_turns:
                break

            # AdaptiveCandidate produces a reply (sync LLM call).
            candidate_reply = candidate.reply(event.text)

            # Record the candidate turn.
            transcript.append(
                TranscriptTurn(
                    turn_index=turn_index,
                    speaker="candidate",
                    text=candidate_reply,
                    question_id=None,
                )
            )
            turn_index += 1

            # Feed the candidate's reply back into the realtime session so the
            # agent can continue.
            await session.inject_message(candidate_reply)

        elif isinstance(event, ToolCall):
            if event.name == "close_interview":
                ended = True
                # Acknowledge the close so the model can deliver its farewell.
                await session.respond_to_tool(event.call_id, plan.closer_text)
            elif event.name == "advance_question":
                qid = event.arguments.get("next_question_id", "")
                verbatim = next(
                    (
                        r.verbatim_text
                        for r in plan.required_coverage
                        if r.question_id == qid
                    ),
                    "",
                )
                await session.respond_to_tool(event.call_id, verbatim)
            elif event.name == "flag_off_script":
                reason = event.arguments.get("reason", "")
                guardrail_events.append(f"off_script:{reason}")
                await session.respond_to_tool(
                    event.call_id,
                    "That's not something I can discuss here — let's keep going.",
                )
            else:
                # Probe or unknown — return empty string so the model continues.
                await session.respond_to_tool(event.call_id, "")

        if ended:
            break

    duration = time.monotonic() - start
    await session.aclose()

    return measure(transcript, plan, guardrail_events, duration)
