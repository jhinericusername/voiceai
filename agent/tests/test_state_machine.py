import pytest

from agent.controller.machine import InterviewStateMachine, InvalidTransition
from agent.controller.states import InterviewState


def test_initial_state_is_scheduled() -> None:
    sm = InterviewStateMachine(num_questions=4)
    assert sm.state == InterviewState.SCHEDULED


def test_happy_path_through_preflight_and_intro() -> None:
    sm = InterviewStateMachine(num_questions=4)
    sm.transition(InterviewState.CANDIDATE_JOINED)
    sm.transition(InterviewState.PREFLIGHT_COMPLETE)
    sm.transition(InterviewState.CONSENT_CAPTURED)
    sm.transition(InterviewState.INTRO)
    sm.transition(InterviewState.QUESTION_ASKING)
    assert sm.state == InterviewState.QUESTION_ASKING
    assert sm.current_question_index == 0


def test_scoring_loops_into_probing_then_closes_question() -> None:
    sm = InterviewStateMachine(num_questions=4)
    sm.fast_forward_to_question(0)
    sm.transition(InterviewState.QUESTION_ANSWERING)
    sm.transition(InterviewState.QUESTION_SCORING)
    sm.transition(InterviewState.QUESTION_PROBING)
    assert sm.probe_index == 0
    sm.transition(InterviewState.QUESTION_ANSWERING)
    sm.transition(InterviewState.QUESTION_SCORING)
    sm.transition(InterviewState.QUESTION_PROBING)
    assert sm.probe_index == 1
    sm.transition(InterviewState.QUESTION_SCORING)
    sm.transition(InterviewState.QUESTION_CLOSED)
    assert sm.state == InterviewState.QUESTION_CLOSED


def test_advancing_past_last_question_goes_to_closing() -> None:
    sm = InterviewStateMachine(num_questions=2)
    sm.fast_forward_to_question(1)
    sm.transition(InterviewState.QUESTION_ANSWERING)
    sm.transition(InterviewState.QUESTION_SCORING)
    sm.transition(InterviewState.QUESTION_CLOSED)
    sm.advance_question()
    assert sm.state == InterviewState.CLOSING


def test_advance_question_moves_to_next_index() -> None:
    sm = InterviewStateMachine(num_questions=4)
    sm.fast_forward_to_question(0)
    sm.transition(InterviewState.QUESTION_ANSWERING)
    sm.transition(InterviewState.QUESTION_SCORING)
    sm.transition(InterviewState.QUESTION_CLOSED)
    sm.advance_question()
    assert sm.state == InterviewState.QUESTION_ASKING
    assert sm.current_question_index == 1
    assert sm.probe_index == -1  # probe counter resets per question


def test_invalid_transition_raises() -> None:
    sm = InterviewStateMachine(num_questions=4)
    with pytest.raises(InvalidTransition):
        sm.transition(InterviewState.CLOSING)


def test_closing_then_finalizing_then_review_ready() -> None:
    sm = InterviewStateMachine(num_questions=1)
    sm.fast_forward_to_question(0)
    sm.transition(InterviewState.QUESTION_ANSWERING)
    sm.transition(InterviewState.QUESTION_SCORING)
    sm.transition(InterviewState.QUESTION_CLOSED)
    sm.advance_question()
    sm.transition(InterviewState.RECORDING_FINALIZING)
    sm.transition(InterviewState.REVIEW_READY)
    assert sm.state == InterviewState.REVIEW_READY


def test_disconnect_can_mark_incomplete_from_any_active_state() -> None:
    sm = InterviewStateMachine(num_questions=4)
    sm.fast_forward_to_question(0)
    sm.transition(InterviewState.QUESTION_ANSWERING)
    sm.mark_incomplete()
    assert sm.state == InterviewState.INCOMPLETE
