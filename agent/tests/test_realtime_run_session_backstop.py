"""Unit tests for run_session's ControlBus close-backstop wiring.

TDD: written BEFORE the implementation (RED phase).

Drives run_session with a FakeRealtimeSession scripted so the agent:
  1. advance_question q1  → bus sets current_qid=q1
  2. OutputTranscript (q1 verbatim) → candidate answers → q1 marked covered
  3. close_interview EARLY (q2..qN uncovered) → bus DENIES, re-issues q2 verbatim
  4. OutputTranscript (q2 verbatim) → candidate answers → q2 marked covered
  5-N. advance + OutputTranscript for remaining questions until all covered
  N+1. close_interview AGAIN → bus ACCEPTS → ended=True → session closes

Asserts:
- early close_interview was denied (tool_response != closer_text)
- denial re-issued an uncovered verbatim
- loop continued (more injections after denial)
- final close was accepted (tool_response == closer_text)
- returned EvalMeasurement shows full coverage
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from agent.controller.realtime.plan_builder import build_interview_plan
from agent.eval.realtime.harness import EvalMeasurement, run_session
from agent.rubric_loader import load_rubric
from agent.voice.realtime.interface import FakeRealtimeSession, OutputTranscript, ToolCall

RUBRIC = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _stub_candidate(reply: str = "candidate answer") -> Any:
    m = MagicMock()
    m.reply.return_value = reply
    return m


def _stub_guardrail(violation: bool = False, kind: str = "") -> Any:
    verdict = MagicMock()
    verdict.violation = violation
    verdict.kind = kind
    m = MagicMock()
    m.check_turn.return_value = verdict
    return m


# ---------------------------------------------------------------------------
# Build the scripted event sequence
# ---------------------------------------------------------------------------
#
# We use the first two questions from the pilot rubric.  The script:
#   tc-adv-q1   → advance_question q1
#   OutputTranscript(q1 verbatim)
#   tc-close-early → close_interview (EARLY — q2..qN uncovered)
#   OutputTranscript(q2 verbatim injected by denial)
#   ...advance + OutputTranscript for every remaining required question
#   tc-close-final → close_interview (all covered)
#
# We only need q1 + the early close + the rest to complete coverage.
# For simplicity: drive all required questions through advance_question then
# fire the final close.  The plan has N required questions.


def _build_script() -> tuple[list[OutputTranscript | ToolCall], str, str]:
    """Return (script, early_close_call_id, final_close_call_id)."""
    plan = build_interview_plan(RUBRIC)
    required = plan.required_coverage  # ordered list of RequiredQuestion

    events: list[OutputTranscript | ToolCall] = []

    # Step 1: advance to q1
    q1 = required[0]
    events.append(ToolCall(
        call_id="tc-adv-q1",
        name="advance_question",
        arguments={"next_question_id": q1.question_id},
    ))
    # Step 2: agent speaks q1 verbatim → candidate will answer → q1 covered
    events.append(OutputTranscript(text=q1.verbatim_text))

    # Step 3: early close (q2..qN uncovered)
    events.append(ToolCall(call_id="tc-close-early", name="close_interview", arguments={}))

    # After denial, bus sets current_qid to q2 and re-issues q2 verbatim.
    # The agent will speak it; candidate answers; q2 gets covered.
    q2 = required[1]
    events.append(OutputTranscript(text=q2.verbatim_text))

    # Advance through remaining questions (q3..qN) to complete coverage.
    for rq in required[2:]:
        events.append(ToolCall(
            call_id=f"tc-adv-{rq.question_id}",
            name="advance_question",
            arguments={"next_question_id": rq.question_id},
        ))
        events.append(OutputTranscript(text=rq.verbatim_text))

    # Final close (all questions covered)
    events.append(ToolCall(call_id="tc-close-final", name="close_interview", arguments={}))

    return events, "tc-close-early", "tc-close-final"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_early_close_is_denied_and_coverage_completes() -> None:
    """Early close_interview is denied; uncovered verbatim re-issued; later close accepted."""
    plan = build_interview_plan(RUBRIC)
    script, early_id, final_id = _build_script()
    session = FakeRealtimeSession(scripted=script)

    result = await run_session(
        _stub_candidate(),
        session,
        RUBRIC,
        guardrail_monitor=_stub_guardrail(),
        max_turns=50,
    )

    # --- early close was DENIED ------------------------------------------------
    early_responses = [out for cid, out in session.tool_responses if cid == early_id]
    assert early_responses, "no tool response recorded for early close"
    early_speak = early_responses[0]

    assert early_speak != plan.closer_text, (
        f"early close should be denied; got closer_text {early_speak!r}"
    )
    uncovered_verbatims = {rq.verbatim_text for rq in plan.required_coverage}
    assert early_speak in uncovered_verbatims, (
        f"early denial must re-issue an uncovered verbatim; got {early_speak!r}"
    )

    # --- final close was ACCEPTED ---------------------------------------------
    final_responses = [out for cid, out in session.tool_responses if cid == final_id]
    assert final_responses, "no tool response recorded for final close"
    assert final_responses[0] == plan.closer_text, (
        f"final close should return closer_text; got {final_responses[0]!r}"
    )

    # --- session properly closed ----------------------------------------------
    assert session.closed

    # --- full coverage in measurement ----------------------------------------
    assert isinstance(result, EvalMeasurement)
    assert result.total_required == len(plan.required_coverage)
    assert result.coverage_count == result.total_required, (
        f"expected full coverage {result.total_required}/{result.total_required}; "
        f"got {result.coverage_count}"
    )


@pytest.mark.asyncio
async def test_loop_continues_after_early_close_denial() -> None:
    """Loop must not terminate at the early-close denial (more injections must follow)."""
    script, _early_id, _final_id = _build_script()
    session = FakeRealtimeSession(scripted=script)

    await run_session(
        _stub_candidate(),
        session,
        RUBRIC,
        guardrail_monitor=_stub_guardrail(),
        max_turns=50,
    )

    # Script has N OutputTranscript events (one per required question).
    # If loop exited at the early close there would be only 1 injection.
    plan = build_interview_plan(RUBRIC)
    expected_injections = len(plan.required_coverage)
    assert len(session.injections) >= expected_injections, (
        f"expected ≥{expected_injections} injections; got {len(session.injections)}"
    )
