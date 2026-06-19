"""Pydantic domain types shared across the agent worker."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ReasonCode = Literal[
    "CONSENT",
    "INTRO",
    "ACK",
    "SCRIPTED_QUESTION",
    "PROBE_LOW_CONFIDENCE",
    "AUDIO_REPAIR",
    "TIMEBOX_MOVE_ON",
    "CLOSING",
    "REALTIME_QUESTION",
    "STEER",
    "GUARDRAIL_CORRECTION",
    "COVERAGE_BACKSTOP",
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


class PreQuestion(BaseModel):
    """An optional gating ask before a main question. Used by Q2's YC framing."""

    model_config = ConfigDict(frozen=True)

    ask: str
    branch_no: str = ""
    branch_yes: str = ""


class Question(BaseModel):
    """A verbatim base question and its probing budget.

    `variations` are alternate phrasings of the main question (e.g., used on a
    re-ask). `scripted_probes` is the canonical ordered probe pool — the
    Probe Generator consumes from this first and only falls back to the LLM
    when the pool is exhausted. `when_stuck` are the example/clarification
    nudges to use when a candidate stalls. `transition_in` is the short filler
    the controller speaks immediately before this question.
    """

    model_config = ConfigDict(frozen=True)

    script_version: str
    question_id: str
    verbatim_text: str
    rubric_categories: list[str]
    target_evidence: list[str]
    max_probes: int = 2
    soft_budget_seconds: int = 180
    hard_stop_behavior: HardStopBehavior = "acknowledge_and_move_on"
    transition_in: str = ""
    variations: list[str] = Field(default_factory=list)
    scripted_probes: list[str] = Field(default_factory=list)
    when_stuck: list[str] = Field(default_factory=list)
    pre_question: PreQuestion | None = None


class Style(BaseModel):
    """Reusable phrasing the controller picks from between turns."""

    model_config = ConfigDict(frozen=True)

    interviewer_name: str = ""
    company_name: str = ""
    interviewer_role: str = ""
    acknowledgments: list[str] = Field(default_factory=list)
    thinking_fillers: list[str] = Field(default_factory=list)
    vague_answer_nudges: list[str] = Field(default_factory=list)


class Opener(BaseModel):
    """The interview's opener block — greeting, small talk, introduction."""

    model_config = ConfigDict(frozen=True)

    greeting: str = ""
    small_talk_prompts: list[str] = Field(default_factory=list)
    reciprocation: str = ""
    introduction: str = ""
    soft_budget_seconds: int = 180


class Closer(BaseModel):
    """Wrap-up logistics + farewell."""

    model_config = ConfigDict(frozen=True)

    logistics_lead_in: str = ""
    logistics_questions: list[str] = Field(default_factory=list)
    wrap: str = ""


class Rubric(BaseModel):
    """The full rubric: categories, question plan, and the bare-minimum rule."""

    model_config = ConfigDict(frozen=True)

    script_version: str
    categories: list[RubricCategory]
    questions: list[Question]
    bare_minimum_rule: str
    total_cap_seconds: int
    style: Style | None = None
    opener: Opener | None = None
    closer: Closer | None = None


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
