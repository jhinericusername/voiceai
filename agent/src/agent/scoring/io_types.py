"""Input and output types for the Live Rubric Scorer."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from agent.domain.types import TranscriptTurn


class ScorerInput(BaseModel):
    """Everything the Scorer needs to assess the current question."""

    model_config = ConfigDict(frozen=True)

    script_version: str
    question_id: str
    target_categories: list[str]
    transcript: list[TranscriptTurn]


class CategoryAssessment(BaseModel):
    """The Scorer's provisional assessment of one rubric category."""

    model_config = ConfigDict(frozen=True)

    category: str
    provisional_score: int = Field(ge=1, le=4)
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_quotes: list[str]
    missing_or_ambiguous: list[str]


class ScorerOutput(BaseModel):
    """The Scorer's full output for one scoring pass."""

    model_config = ConfigDict(frozen=True)

    assessments: list[CategoryAssessment]

    def by_category(self) -> dict[str, CategoryAssessment]:
        """Index assessments by their category key."""
        return {a.category: a for a in self.assessments}
