"""Persist the finished Assessment to PostgreSQL."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from agent.domain.types import Assessment


@dataclass(frozen=True)
class SqlStatement:
    """A parameterized SQL statement."""

    sql: str
    params: list[Any]


def build_assessment_insert(assessment: Assessment) -> SqlStatement:
    """Build the parameterized INSERT for the `assessments` table."""
    category_scores = json.dumps(
        [cs.model_dump() for cs in assessment.category_scores]
    )
    return SqlStatement(
        sql=(
            "INSERT INTO assessments "
            "(session_id, script_version, category_scores, "
            "meets_bare_minimum, integrity_flags) "
            "VALUES ($1, $2, $3::jsonb, $4, $5::jsonb)"
        ),
        params=[
            assessment.session_id,
            assessment.script_version,
            category_scores,
            assessment.meets_bare_minimum,
            json.dumps(assessment.integrity_flags),
        ],
    )


async def persist_assessment(  # pragma: no cover — live DB wiring
    database_url: str, assessment: Assessment
) -> None:
    """Write the Assessment and mark the session review-ready, atomically."""
    import asyncpg

    insert = build_assessment_insert(assessment)
    conn = await asyncpg.connect(database_url)
    try:
        async with conn.transaction():
            await conn.execute(insert.sql, *insert.params)
            await conn.execute(
                "UPDATE sessions SET status = 'review_ready', updated_at = now() "
                "WHERE session_id = $1",
                assessment.session_id,
            )
    finally:
        await conn.close()


async def mark_session_incomplete(  # pragma: no cover — live DB wiring
    database_url: str, session_id: str
) -> None:
    """Mark a session incomplete after a failed or abandoned interview."""
    import asyncpg

    conn = await asyncpg.connect(database_url)
    try:
        await conn.execute(
            "UPDATE sessions SET status = 'incomplete', updated_at = now() "
            "WHERE session_id = $1",
            session_id,
        )
    finally:
        await conn.close()
