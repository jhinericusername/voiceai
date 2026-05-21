"""Pydantic domain types shared across the agent worker."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ReasonCode = Literal[
    "CONSENT",
    "INTRO",
    "SCRIPTED_QUESTION",
    "PROBE_LOW_CONFIDENCE",
    "AUDIO_REPAIR",
    "TIMEBOX_MOVE_ON",
    "CLOSING",
]

IntegritySignal = Literal[
    "reading_off_screen",
    "multiple_faces",
    "candidate_absent",
]

SessionStatus = Literal[
    "scheduled",
    "candidate_joined",
    "preflight_complete",
    "consent_captured",
    "in_progress",
    "closing",
    "recording_finalizing",
    "review_ready",
    "incomplete",
]

Speaker = Literal["candidate", "agent"]

HardStopBehavior = Literal["acknowledge_and_move_on"]


class RubricCategory(BaseModel):
    """One scored dimension of the rubric, with its 1-4 anchors."""

    model_config = ConfigDict(frozen=True)

    key: str
    name: str
    meaning: str
    anchors: dict[int, str]

    @field_validator("anchors")
    @classmethod
    def _anchors_cover_one_to_four(cls, value: dict[int, str]) -> dict[int, str]:
        if set(value.keys()) != {1, 2, 3, 4}:
            raise ValueError("anchors must define exactly levels 1, 2, 3, 4")
        return value


class Question(BaseModel):
    """A verbatim base question and its probing budget."""

    model_config = ConfigDict(frozen=True)

    script_version: str
    question_id: str
    verbatim_text: str
    rubric_categories: list[str]
    target_evidence: list[str]
    max_probes: int = 2
    soft_budget_seconds: int = 180
    hard_stop_behavior: HardStopBehavior = "acknowledge_and_move_on"


class Rubric(BaseModel):
    """The full rubric: categories, question plan, and the bare-minimum rule."""

    model_config = ConfigDict(frozen=True)

    script_version: str
    categories: list[RubricCategory]
    questions: list[Question]
    bare_minimum_rule: str
    total_cap_seconds: int


class TranscriptTurn(BaseModel):
    """One diarized turn of the interview transcript."""

    model_config = ConfigDict(frozen=True)

    turn_index: int
    speaker: Speaker
    text: str
    question_id: str | None
    unreliable: bool = False


class CategoryScore(BaseModel):
    """A finalized per-category score in the assessment."""

    model_config = ConfigDict(frozen=True)

    category: str
    score: int = Field(ge=1, le=4)
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_quotes: list[str]
    rationale: str
    low_confidence: bool


class Assessment(BaseModel):
    """The structured assessment delivered to a human reviewer."""

    model_config = ConfigDict(frozen=True)

    session_id: str
    script_version: str
    category_scores: list[CategoryScore]
    meets_bare_minimum: bool
    integrity_flags: list[str]


class AgentEvent(BaseModel):
    """One spoken agent utterance, logged with a reason code."""

    model_config = ConfigDict(frozen=True)

    session_id: str
    utterance: str
    reason_code: ReasonCode
    question_id: str | None
    category: str | None
    missing_element: str | None


class IntegrityEvent(BaseModel):
    """A non-scoring video integrity signal."""

    model_config = ConfigDict(frozen=True)

    session_id: str
    signal: IntegritySignal
    confidence: float = Field(ge=0.0, le=1.0)
    frame_timestamp_seconds: float


class ConsentRecord(BaseModel):
    """Captured candidate consent and AI disclosure acknowledgement."""

    model_config = ConfigDict(frozen=True)

    session_id: str
    candidate_email: str
    ai_disclosure_acknowledged: bool
    recording_consented: bool
    consented_at: str


class Session(BaseModel):
    """An interview session and its lifecycle status."""

    model_config = ConfigDict(frozen=True)

    session_id: str
    org_id: str
    candidate_email: str
    script_version: str
    status: SessionStatus
