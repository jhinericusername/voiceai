"""Load and validate a rubric config file into a `Rubric` model."""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import ValidationError

from agent.domain.types import (
    Closer,
    Opener,
    Question,
    Rubric,
    RubricCategory,
    Style,
)


class RubricValidationError(Exception):
    """Raised when a rubric config file fails schema or referential validation."""


def load_rubric(path: Path) -> Rubric:
    """Parse a YAML rubric config and return a validated `Rubric`.

    Raises `RubricValidationError` on schema errors or when a question
    references a category that is not defined.
    """
    raw = yaml.safe_load(path.read_text())
    try:
        categories = [RubricCategory(**c) for c in raw["categories"]]
        questions = [
            Question(script_version=raw["script_version"], **q)
            for q in raw["questions"]
        ]
        style = Style(**raw["style"]) if raw.get("style") else None
        opener = Opener(**raw["opener"]) if raw.get("opener") else None
        closer = Closer(**raw["closer"]) if raw.get("closer") else None
        rubric = Rubric(
            script_version=raw["script_version"],
            categories=categories,
            questions=questions,
            bare_minimum_rule=raw["bare_minimum_rule"],
            total_cap_seconds=raw["total_cap_seconds"],
            style=style,
            opener=opener,
            closer=closer,
        )
    except (ValidationError, KeyError, TypeError) as exc:
        raise RubricValidationError(str(exc)) from exc

    known = {c.key for c in rubric.categories}
    for question in rubric.questions:
        unknown = set(question.rubric_categories) - known
        if unknown:
            raise RubricValidationError(
                f"question {question.question_id} references unknown "
                f"categories: {sorted(unknown)}"
            )
    return rubric
