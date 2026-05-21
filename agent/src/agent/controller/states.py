"""Interview Controller states.

The per-question N and per-probe M of the spec's state names are tracked as
counters on the machine; the enum holds the state *kinds*.
"""

from __future__ import annotations

from enum import Enum


class InterviewState(str, Enum):
    """The kinds of state the interview can be in."""

    SCHEDULED = "scheduled"
    CANDIDATE_JOINED = "candidate_joined"
    PREFLIGHT_COMPLETE = "preflight_complete"
    CONSENT_CAPTURED = "consent_captured"
    INTRO = "intro"
    QUESTION_ASKING = "question_asking"
    QUESTION_ANSWERING = "question_answering"
    QUESTION_SCORING = "question_scoring"
    QUESTION_PROBING = "question_probing"
    QUESTION_CLOSED = "question_closed"
    CLOSING = "closing"
    RECORDING_FINALIZING = "recording_finalizing"
    REVIEW_READY = "review_ready"
    INCOMPLETE = "incomplete"
