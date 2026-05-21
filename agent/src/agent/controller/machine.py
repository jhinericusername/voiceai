"""The Interview Controller's deterministic state machine.

Transitions are validated against an explicit table; the per-question index
and per-probe index are counters advanced by `advance_question` and the
scoring→probing loop. Disconnect/failure can mark the interview incomplete
from any active state.
"""

from __future__ import annotations

from agent.controller.states import InterviewState

_S = InterviewState

# Allowed transitions, excluding the question loop and incomplete (handled
# specially because they depend on counters).
_ALLOWED: dict[InterviewState, set[InterviewState]] = {
    _S.SCHEDULED: {_S.CANDIDATE_JOINED},
    _S.CANDIDATE_JOINED: {_S.PREFLIGHT_COMPLETE},
    _S.PREFLIGHT_COMPLETE: {_S.CONSENT_CAPTURED},
    _S.CONSENT_CAPTURED: {_S.INTRO},
    _S.INTRO: {_S.QUESTION_ASKING},
    _S.QUESTION_ASKING: {_S.QUESTION_ANSWERING},
    _S.QUESTION_ANSWERING: {_S.QUESTION_SCORING},
    _S.QUESTION_SCORING: {_S.QUESTION_PROBING, _S.QUESTION_CLOSED},
    _S.QUESTION_PROBING: {_S.QUESTION_ANSWERING, _S.QUESTION_SCORING},
    _S.QUESTION_CLOSED: set(),  # advance_question() moves on from here
    _S.CLOSING: {_S.RECORDING_FINALIZING},
    _S.RECORDING_FINALIZING: {_S.REVIEW_READY},
    _S.REVIEW_READY: set(),
    _S.INCOMPLETE: set(),
}

# Active states from which a disconnect/failure may mark the run incomplete.
_ACTIVE = {
    _S.CANDIDATE_JOINED,
    _S.PREFLIGHT_COMPLETE,
    _S.CONSENT_CAPTURED,
    _S.INTRO,
    _S.QUESTION_ASKING,
    _S.QUESTION_ANSWERING,
    _S.QUESTION_SCORING,
    _S.QUESTION_PROBING,
    _S.QUESTION_CLOSED,
    _S.CLOSING,
    _S.RECORDING_FINALIZING,
}


class InvalidTransition(Exception):
    """Raised when a state transition is not permitted from the current state."""


class InterviewStateMachine:
    """Tracks interview state, the current question index, and the probe index."""

    def __init__(self, num_questions: int) -> None:
        if num_questions < 1:
            raise ValueError("an interview needs at least one question")
        self._num_questions = num_questions
        self._state = _S.SCHEDULED
        self._question_index = -1
        self._probe_index = -1

    @property
    def state(self) -> InterviewState:
        """The current state."""
        return self._state

    @property
    def current_question_index(self) -> int:
        """Zero-based index of the question in play (-1 before the first)."""
        return self._question_index

    @property
    def probe_index(self) -> int:
        """Zero-based index of the probe in play for this question (-1 = none)."""
        return self._probe_index

    def transition(self, to: InterviewState) -> None:
        """Move to `to` if the transition is allowed; else raise."""
        if to not in _ALLOWED.get(self._state, set()):
            raise InvalidTransition(f"{self._state.value} -> {to.value}")
        if to == _S.QUESTION_ASKING and self._question_index < 0:
            self._question_index = 0
        if to == _S.QUESTION_PROBING:
            self._probe_index += 1
        self._state = to

    def advance_question(self) -> None:
        """From QUESTION_CLOSED, move to the next question or to CLOSING."""
        if self._state != _S.QUESTION_CLOSED:
            raise InvalidTransition(
                f"advance_question requires QUESTION_CLOSED, got {self._state.value}"
            )
        if self._question_index + 1 >= self._num_questions:
            self._state = _S.CLOSING
            return
        self._question_index += 1
        self._probe_index = -1
        self._state = _S.QUESTION_ASKING

    def fast_forward_to_question(self, index: int) -> None:
        """Test/wiring helper: jump straight to QUESTION_ASKING at `index`."""
        if not 0 <= index < self._num_questions:
            raise ValueError(f"question index {index} out of range")
        self._question_index = index
        self._probe_index = -1
        self._state = _S.QUESTION_ASKING

    def mark_incomplete(self) -> None:
        """Mark the interview incomplete after a disconnect/hard failure."""
        if self._state not in _ACTIVE and self._state != _S.SCHEDULED:
            raise InvalidTransition(
                f"cannot mark incomplete from {self._state.value}"
            )
        self._state = _S.INCOMPLETE
