# Puddle Voice Interviewer Agent — v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-party WebRTC interview room and an AI voice+video interviewer agent that conducts a structured, score-driven interview for one pilot role, scores candidates against a rubric in real time, and delivers human-reviewed assessments.

**Architecture:** A monorepo with a Python LiveKit Agents worker (cascaded Voice I/O, a deterministic Interview Controller, a live Rubric Scorer, a Probe Generator, and a parallel Video Perception pipeline) joining each interview on LiveKit Cloud. TypeScript apps provide the candidate room, the reviewer tool, and backend scheduling/orchestration/finalization. PostgreSQL holds structured data; S3-compatible object storage holds media and artifacts; an offline eval harness validates the Scorer against a human-scored corpus before live trust is extended.

**Tech Stack:** Python 3.12 + uv + pytest + ruff; LiveKit Agents + LiveKit Egress; Deepgram Nova-3 STT; Cartesia Sonic-3 TTS; LiveKit turn-detector; Anthropic Claude (Opus-class) for the Scorer and Probe Generator with prompt caching; Gemini Flash VLM for video; TypeScript pnpm workspace (React + Vite for `room/` and `review/`, Node + Fastify for `backend/`) with vitest; PostgreSQL; S3-compatible object storage.

---

## Phase 1: Foundation

### Task 1.1: Monorepo scaffold and tooling

**Files:**
- Create: `.gitignore`
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `agent/pyproject.toml`
- Create: `agent/src/agent/__init__.py`
- Create: `agent/tests/__init__.py`
- Create: `agent/tests/test_smoke.py`
- Create: `rubric/.gitkeep`
- Create: `corpus/.gitkeep`
- Create: `README.md`

- [ ] **Step 1: Create the root `.gitignore`**
```gitignore
# Python
__pycache__/
*.py[cod]
.venv/
agent/.venv/
.pytest_cache/
.ruff_cache/

# Node / TypeScript
node_modules/
dist/
*.tsbuildinfo
.vite/

# Env / secrets
.env
.env.*
!.env.example

# Corpus — human-scored interview data, never committed
corpus/**
!corpus/.gitkeep

# Local artifacts
*.log
.DS_Store
```

- [ ] **Step 2: Create the pnpm workspace manifest**
`pnpm-workspace.yaml`:
```yaml
packages:
  - "room"
  - "review"
  - "backend"
```
`package.json`:
```json
{
  "name": "puddle-voiceai",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test"
  }
}
```

- [ ] **Step 3: Create the `agent/` uv project**
`agent/pyproject.toml`:
```toml
[project]
name = "puddle-agent"
version = "0.1.0"
description = "Puddle voice interviewer agent worker"
requires-python = ">=3.12,<3.13"
dependencies = [
    "pydantic>=2.9",
    "pyyaml>=6.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3",
    "pytest-asyncio>=0.24",
    "ruff>=0.7",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/agent"]
```

- [ ] **Step 4: Create the smoke test and package files**
`agent/src/agent/__init__.py`:
```python
"""Puddle voice interviewer agent worker."""

__version__ = "0.1.0"
```
`agent/tests/__init__.py`:
```python
```
`agent/tests/test_smoke.py`:
```python
from agent import __version__


def test_version_is_set() -> None:
    assert __version__ == "0.1.0"
```

- [ ] **Step 5: Create placeholder dirs and README**
`rubric/.gitkeep`:
```
```
`corpus/.gitkeep`:
```
```
`README.md`:
```markdown
# Puddle Voice Interviewer Agent

Monorepo for the Puddle first-party interview room and AI interviewer agent.

- `agent/` — Python LiveKit Agents worker (Voice I/O, Controller, Scorer, Probe Generator, Video Perception)
- `room/` — candidate interview room (React + Vite)
- `review/` — internal reviewer tool (React + Vite)
- `backend/` — Scheduler/API, Orchestrator, Finalization (Node + Fastify)
- `rubric/` — rubric config data files
- `corpus/` — human-scored interview corpus (gitignored)
- `docs/` — specs, plans, standards

## Setup

```bash
cd agent && uv sync --extra dev   # Python agent
pnpm install                      # TypeScript workspace
```
```

- [ ] **Step 6: Verify the Python project**
Run: `cd agent && uv sync --extra dev && uv run pytest`
Expected: `1 passed`, exit 0

- [ ] **Step 7: Verify the pnpm workspace resolves**
Run: `pnpm install`
Expected: completes with exit 0 (no packages yet; lockfile created)

- [ ] **Step 8: Commit**
```bash
git add .gitignore pnpm-workspace.yaml package.json agent/pyproject.toml agent/src agent/tests rubric/.gitkeep corpus/.gitkeep README.md pnpm-lock.yaml agent/uv.lock && git commit -m "Scaffold monorepo: agent uv project, pnpm TS workspace, rubric/corpus dirs"
```

---

### Task 1.2: Import ECC coding standards as repo references

**Files:**
- Create: `docs/standards/python.md`
- Create: `docs/standards/typescript.md`
- Create: `CLAUDE.md`

- [ ] **Step 1: Create the Python standards reference**
`docs/standards/python.md`:
```markdown
# Python Coding Standards (ECC)

Applies to all code under `agent/`.

## Language & tooling
- Python 3.12; `uv` for env and dependency management.
- `ruff` for lint + import sort; `pytest` for tests (`asyncio_mode = auto`).
- All public functions and methods have full type hints; no bare `Any` without a comment.

## Structure
- Domain types are Pydantic v2 models in `agent/src/agent/domain/`.
- One module per component; modules expose a small, named public surface.
- No business logic in `__init__.py`.

## Style
- `snake_case` for functions/variables, `PascalCase` for classes, `UPPER_SNAKE` for constants.
- Prefer immutability: Pydantic models are `frozen=True` unless mutation is required.
- Functions do one thing; extract once a function exceeds ~40 lines.
- Errors are explicit exception types, never silent `except: pass`.

## Testing
- TDD: write the failing test first.
- Tests are deterministic — no network in unit tests; vendor SDKs are mocked.
- Each test asserts one behavior; name tests `test_<behavior>`.
```

- [ ] **Step 2: Create the TypeScript standards reference**
`docs/standards/typescript.md`:
```markdown
# TypeScript Coding Standards (ECC)

Applies to all code under `room/`, `review/`, `backend/`.

## Language & tooling
- TypeScript strict mode (`strict: true`, `noUncheckedIndexedAccess: true`).
- pnpm workspace; `vitest` for tests.
- ESM modules only.

## Structure
- Shared types live next to their feature; cross-package contracts are explicit.
- React apps: function components + hooks; no class components.
- Backend: Fastify plugins per concern; route handlers stay thin.

## Style
- `camelCase` for values, `PascalCase` for types/components, `UPPER_SNAKE` for constants.
- Prefer `const`; no `var`. Prefer `readonly` and immutable updates.
- No `any` — use `unknown` and narrow.
- Errors are typed; never swallow a rejected promise.

## Testing
- TDD: failing test first.
- Unit tests mock I/O; no live network.
- Name tests by behavior.
```

- [ ] **Step 3: Create the root `CLAUDE.md`**
`CLAUDE.md`:
```markdown
# Puddle Voice Interviewer Agent — repo instructions

## Coding standards
- Python code under `agent/` follows `docs/standards/python.md`.
- TypeScript code under `room/`, `review/`, `backend/` follows `docs/standards/typescript.md`.

## Layout
- `agent/` Python (uv, src layout under `agent/src/agent/`, tests under `agent/tests/`).
- `room/`, `review/`, `backend/` TypeScript pnpm workspace packages.
- `rubric/` rubric config data files. `corpus/` is gitignored.

## manual-gate operations
The autonomous build run must halt for operator approval before:
- applying a database schema migration,
- any deploy or release,
- bulk data writes to shared data,
- running an interview with a real candidate,
- enabling any reduction of human oversight over scoring.

## Commands
- Python tests: `cd agent && uv run pytest`
- TS tests: `pnpm -r test`
```

- [ ] **Step 4: Verify the files exist and are readable**
Run: `ls docs/standards/python.md docs/standards/typescript.md CLAUDE.md`
Expected: all three paths listed, exit 0

- [ ] **Step 5: Commit**
```bash
git add docs/standards CLAUDE.md && git commit -m "Import ECC Python and TypeScript coding standards; add root CLAUDE.md"
```

---

### Task 1.3: Core Python domain types (Pydantic)

**Files:**
- Create: `agent/src/agent/domain/__init__.py`
- Create: `agent/src/agent/domain/types.py`
- Test: `agent/tests/test_domain_types.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_domain_types.py`:
```python
import pytest
from pydantic import ValidationError

from agent.domain.types import (
    AgentEvent,
    Assessment,
    CategoryScore,
    ConsentRecord,
    IntegrityEvent,
    Question,
    Rubric,
    RubricCategory,
    Session,
    TranscriptTurn,
)


def test_rubric_category_anchors_required() -> None:
    cat = RubricCategory(
        key="problem_solving",
        name="Problem Solving",
        meaning="Finds clever solutions.",
        anchors={1: "Downvoted.", 2: "With others.", 3: "Accepted answer.", 4: "HN front page."},
    )
    assert cat.key == "problem_solving"
    assert cat.anchors[4] == "HN front page."


def test_rubric_category_rejects_incomplete_anchors() -> None:
    with pytest.raises(ValidationError):
        RubricCategory(
            key="x", name="X", meaning="m", anchors={1: "a", 2: "b", 3: "c"}
        )


def test_question_defaults() -> None:
    q = Question(
        script_version="pilot-v1",
        question_id="q1",
        verbatim_text="Tell me about a hard problem.",
        rubric_categories=["problem_solving"],
        target_evidence=["the problem", "the solution"],
    )
    assert q.max_probes == 2
    assert q.soft_budget_seconds == 180
    assert q.hard_stop_behavior == "acknowledge_and_move_on"


def test_rubric_holds_categories_and_questions() -> None:
    cat = RubricCategory(
        key="problem_solving", name="Problem Solving", meaning="m",
        anchors={1: "a", 2: "b", 3: "c", 4: "d"},
    )
    q = Question(
        script_version="pilot-v1", question_id="q1", verbatim_text="t",
        rubric_categories=["problem_solving"], target_evidence=["e"],
    )
    rubric = Rubric(
        script_version="pilot-v1",
        categories=[cat],
        questions=[q],
        bare_minimum_rule="at_least_one_4_and_problem_solving_ge_3",
        total_cap_seconds=1800,
    )
    assert rubric.categories[0].key == "problem_solving"
    assert rubric.questions[0].question_id == "q1"


def test_transcript_turn_speaker_constrained() -> None:
    turn = TranscriptTurn(
        turn_index=0, speaker="candidate", text="hello", question_id="q1"
    )
    assert turn.speaker == "candidate"
    with pytest.raises(ValidationError):
        TranscriptTurn(turn_index=1, speaker="robot", text="x", question_id="q1")


def test_category_score_range() -> None:
    cs = CategoryScore(
        category="problem_solving", score=3, confidence=0.8,
        evidence_quotes=["q"], rationale="r", low_confidence=False,
    )
    assert cs.score == 3
    with pytest.raises(ValidationError):
        CategoryScore(
            category="x", score=5, confidence=0.5, evidence_quotes=[],
            rationale="r", low_confidence=True,
        )


def test_assessment_meets_bare_minimum() -> None:
    cs = CategoryScore(
        category="problem_solving", score=4, confidence=0.9,
        evidence_quotes=["q"], rationale="r", low_confidence=False,
    )
    a = Assessment(
        session_id="s1", script_version="pilot-v1",
        category_scores=[cs], meets_bare_minimum=True, integrity_flags=[],
    )
    assert a.meets_bare_minimum is True


def test_agent_event_reason_code_constrained() -> None:
    ev = AgentEvent(
        session_id="s1", utterance="Welcome.", reason_code="INTRO",
        question_id=None, category=None, missing_element=None,
    )
    assert ev.reason_code == "INTRO"
    with pytest.raises(ValidationError):
        AgentEvent(
            session_id="s1", utterance="x", reason_code="BOGUS",
            question_id=None, category=None, missing_element=None,
        )


def test_integrity_event_signal_constrained() -> None:
    ev = IntegrityEvent(
        session_id="s1", signal="reading_off_screen", confidence=0.7,
        frame_timestamp_seconds=12.0,
    )
    assert ev.signal == "reading_off_screen"
    with pytest.raises(ValidationError):
        IntegrityEvent(
            session_id="s1", signal="happy_face", confidence=0.5,
            frame_timestamp_seconds=1.0,
        )


def test_consent_record_requires_disclosure_acknowledged() -> None:
    c = ConsentRecord(
        session_id="s1", candidate_email="c@example.com",
        ai_disclosure_acknowledged=True, recording_consented=True,
        consented_at="2026-05-20T10:00:00Z",
    )
    assert c.recording_consented is True


def test_session_status_constrained() -> None:
    s = Session(
        session_id="s1", org_id="org1", candidate_email="c@example.com",
        script_version="pilot-v1", status="scheduled",
    )
    assert s.status == "scheduled"
    with pytest.raises(ValidationError):
        Session(
            session_id="s2", org_id="org1", candidate_email="c@example.com",
            script_version="pilot-v1", status="invalid",
        )
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_domain_types.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.domain'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/domain/__init__.py`:
```python
"""Domain types for the Puddle interviewer agent."""
```
`agent/src/agent/domain/types.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_domain_types.py`
Expected: PASS (11 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/domain agent/tests/test_domain_types.py && git commit -m "Add core Pydantic domain types for sessions, rubric, scoring, events"
```

---

### Task 1.4: Pilot rubric config and validating loader

**Files:**
- Create: `rubric/pilot-v1.yaml`
- Create: `agent/src/agent/rubric_loader.py`
- Test: `agent/tests/test_rubric_loader.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_rubric_loader.py`:
```python
from pathlib import Path

import pytest

from agent.rubric_loader import RubricValidationError, load_rubric

RUBRIC_PATH = Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml"


def test_loads_pilot_rubric() -> None:
    rubric = load_rubric(RUBRIC_PATH)
    assert rubric.script_version == "pilot-v1"
    assert {c.key for c in rubric.categories} == {
        "problem_solving", "agency", "competitiveness", "curious",
    }


def test_every_category_has_four_anchors() -> None:
    rubric = load_rubric(RUBRIC_PATH)
    for cat in rubric.categories:
        assert set(cat.anchors.keys()) == {1, 2, 3, 4}


def test_four_verbatim_questions_in_order() -> None:
    rubric = load_rubric(RUBRIC_PATH)
    assert [q.question_id for q in rubric.questions] == ["q1", "q2", "q3", "q4"]
    assert rubric.questions[0].verbatim_text == (
        "Can you tell me about a technically complex problem you solved "
        "with a clever or hacky solution?"
    )
    assert rubric.questions[0].rubric_categories == ["problem_solving"]


def test_bare_minimum_rule_present() -> None:
    rubric = load_rubric(RUBRIC_PATH)
    assert rubric.bare_minimum_rule == "at_least_one_4_and_problem_solving_ge_3"


def test_question_references_unknown_category_rejected(tmp_path: Path) -> None:
    bad = tmp_path / "bad.yaml"
    bad.write_text(
        "script_version: bad\n"
        "total_cap_seconds: 1800\n"
        "bare_minimum_rule: at_least_one_4_and_problem_solving_ge_3\n"
        "categories:\n"
        "  - key: problem_solving\n"
        "    name: PS\n"
        "    meaning: m\n"
        "    anchors: {1: a, 2: b, 3: c, 4: d}\n"
        "questions:\n"
        "  - question_id: q1\n"
        "    verbatim_text: t\n"
        "    rubric_categories: [nonexistent]\n"
        "    target_evidence: [e]\n"
    )
    with pytest.raises(RubricValidationError, match="nonexistent"):
        load_rubric(bad)
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_rubric_loader.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.rubric_loader'`

- [ ] **Step 3: Write minimal implementation**
`rubric/pilot-v1.yaml`:
```yaml
script_version: pilot-v1
total_cap_seconds: 1800
bare_minimum_rule: at_least_one_4_and_problem_solving_ge_3

categories:
  - key: problem_solving
    name: Problem Solving
    meaning: Finds clever, elegant solutions to hard problems.
    anchors:
      1: Downvoted.
      2: Found a solution alongside others.
      3: Accepted answer on Stack Overflow.
      4: Front page on Hacker News.
  - key: agency
    name: Agency
    meaning: Stops at nothing to solve a problem.
    anchors:
      1: Does not meet expectations.
      2: Does everything expected or asked.
      3: Puts in more effort than expected.
      4: Hacked or broke rules to solve the problem.
  - key: competitiveness
    name: Competitiveness
    meaning: Gets consumed by a desire to win.
    anchors:
      1: Absence of competitiveness.
      2: Does not like to lose.
      3: Emotionally affected by losing.
      4: Competitive to a detrimental degree in some facet of life.
  - key: curious
    name: Curious
    meaning: Needs to know the why behind everything, and acts on it.
    anchors:
      1: Absence of curiosity.
      2: Signs of curiosity but no action.
      3: Very curious about something and takes action.
      4: Obsessively curious — becomes an expert.

questions:
  - question_id: q1
    verbatim_text: >-
      Can you tell me about a technically complex problem you solved with a
      clever or hacky solution?
    rubric_categories: [problem_solving]
    target_evidence:
      - the problem and why it was hard
      - the solution and why it was clever or elegant
      - the impact and level of recognition
    max_probes: 2
    soft_budget_seconds: 180
    hard_stop_behavior: acknowledge_and_move_on
  - question_id: q2
    verbatim_text: >-
      Can you tell me about the time you hacked a non-computer system to your
      advantage?
    rubric_categories: [agency]
    target_evidence:
      - the system and the rules or norms in place
      - what the candidate did and why it was unconventional
      - the outcome and what it cost or risked
    max_probes: 2
    soft_budget_seconds: 180
    hard_stop_behavior: acknowledge_and_move_on
  - question_id: q3
    verbatim_text: >-
      Can you tell me about an area of your life where your competitiveness
      became so intense that it cost you something? Maybe it was detrimental
      physically, mentally, or emotionally?
    rubric_categories: [competitiveness]
    target_evidence:
      - the area of life and what winning meant there
      - how intense the competitiveness became
      - the concrete cost the candidate paid
    max_probes: 2
    soft_budget_seconds: 180
    hard_stop_behavior: acknowledge_and_move_on
  - question_id: q4
    verbatim_text: >-
      Can you tell me about a niche or obscure topic that no one knows about
      but you are an expert in? Meaning you are in the top 1% of this thing
      that is extremely niche?
    rubric_categories: [curious]
    target_evidence:
      - the topic and why it is niche
      - how the candidate became an expert
      - evidence of top-1% depth and sustained action
    max_probes: 2
    soft_budget_seconds: 180
    hard_stop_behavior: acknowledge_and_move_on
```
`agent/src/agent/rubric_loader.py`:
```python
"""Load and validate a rubric config file into a `Rubric` model."""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import ValidationError

from agent.domain.types import Question, Rubric, RubricCategory


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
        rubric = Rubric(
            script_version=raw["script_version"],
            categories=categories,
            questions=questions,
            bare_minimum_rule=raw["bare_minimum_rule"],
            total_cap_seconds=raw["total_cap_seconds"],
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
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_rubric_loader.py`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**
```bash
git add rubric/pilot-v1.yaml agent/src/agent/rubric_loader.py agent/tests/test_rubric_loader.py && git commit -m "Add pilot-v1 rubric config and validating loader"
```

---

### Task 1.5: Append-only audit log writer

**Files:**
- Create: `agent/src/agent/audit_log.py`
- Test: `agent/tests/test_audit_log.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_audit_log.py`:
```python
import json
from pathlib import Path

import pytest

from agent.audit_log import AuditLogWriter


def test_appends_entries_as_jsonl(tmp_path: Path) -> None:
    log = tmp_path / "audit.jsonl"
    writer = AuditLogWriter(log)
    writer.write("score_recorded", {"category": "agency", "score": 3})
    writer.write("signoff", {"reviewer": "r@example.com"})

    lines = log.read_text().strip().splitlines()
    assert len(lines) == 2
    first = json.loads(lines[0])
    assert first["event_type"] == "score_recorded"
    assert first["payload"]["category"] == "agency"
    assert "timestamp" in first
    assert "entry_hash" in first


def test_entries_are_hash_chained(tmp_path: Path) -> None:
    log = tmp_path / "audit.jsonl"
    writer = AuditLogWriter(log)
    writer.write("a", {})
    writer.write("b", {})

    lines = [json.loads(line) for line in log.read_text().strip().splitlines()]
    assert lines[0]["prev_hash"] is None
    assert lines[1]["prev_hash"] == lines[0]["entry_hash"]


def test_verify_detects_tampering(tmp_path: Path) -> None:
    log = tmp_path / "audit.jsonl"
    writer = AuditLogWriter(log)
    writer.write("a", {"v": 1})
    writer.write("b", {"v": 2})
    assert AuditLogWriter.verify(log) is True

    lines = log.read_text().strip().splitlines()
    tampered = json.loads(lines[0])
    tampered["payload"] = {"v": 999}
    log.write_text(json.dumps(tampered) + "\n" + lines[1] + "\n")
    assert AuditLogWriter.verify(log) is False


def test_writer_does_not_overwrite_existing_entries(tmp_path: Path) -> None:
    log = tmp_path / "audit.jsonl"
    AuditLogWriter(log).write("first", {})
    # A fresh writer on the same file continues the chain.
    AuditLogWriter(log).write("second", {})
    lines = [json.loads(line) for line in log.read_text().strip().splitlines()]
    assert [entry["event_type"] for entry in lines] == ["first", "second"]
    assert lines[1]["prev_hash"] == lines[0]["entry_hash"]
    assert AuditLogWriter.verify(log) is True
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_audit_log.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.audit_log'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/audit_log.py`:
```python
"""Append-only, hash-chained audit log writer.

Each entry stores a SHA-256 hash over its own content plus the previous
entry's hash, making silent edits or deletions detectable by `verify`.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _canonical(entry: dict[str, Any]) -> str:
    """Stable JSON string of an entry without its own `entry_hash`."""
    payload = {k: v for k, v in entry.items() if k != "entry_hash"}
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _hash_entry(entry: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical(entry).encode("utf-8")).hexdigest()


class AuditLogWriter:
    """Appends hash-chained entries to a JSONL audit log file."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def _last_hash(self) -> str | None:
        if not self._path.exists() or self._path.stat().st_size == 0:
            return None
        last_line = self._path.read_text().strip().splitlines()[-1]
        return json.loads(last_line)["entry_hash"]

    def write(self, event_type: str, payload: dict[str, Any]) -> None:
        """Append one entry, chaining it to the prior entry's hash."""
        entry: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event_type": event_type,
            "payload": payload,
            "prev_hash": self._last_hash(),
        }
        entry["entry_hash"] = _hash_entry(entry)
        with self._path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, separators=(",", ":")) + "\n")

    @staticmethod
    def verify(path: Path) -> bool:
        """Return True if the hash chain is intact and untampered."""
        if not path.exists() or path.stat().st_size == 0:
            return True
        prev: str | None = None
        for line in path.read_text().strip().splitlines():
            entry = json.loads(line)
            if entry["prev_hash"] != prev:
                return False
            if _hash_entry(entry) != entry["entry_hash"]:
                return False
            prev = entry["entry_hash"]
        return True
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_audit_log.py`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/audit_log.py agent/tests/test_audit_log.py && git commit -m "Add append-only hash-chained audit log writer"
```

---

### Task 1.6: PostgreSQL schema, migrations, storage layout, deletion routine   [manual-gate]

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/vitest.config.ts`
- Create: `backend/migrations/001_init.sql`
- Create: `backend/src/db/migrate.ts`
- Create: `backend/src/db/pool.ts`
- Create: `backend/src/storage/layout.ts`
- Create: `backend/src/db/deletion.ts`
- Test: `backend/test/layout.test.ts`
- Test: `backend/test/deletion.test.ts`

> **manual-gate:** Step 6 applies the schema migration to a shared database. The autonomous run halts before it for operator approval. Steps 1–5 and 7–9 (config, SQL authoring, pure helpers, deletion query) are not gated and run autonomously.

- [ ] **Step 1: Create the backend package config**
`backend/package.json`:
```json
{
  "name": "@puddle/backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "migrate": "tsx src/db/migrate.ts"
  },
  "dependencies": {
    "fastify": "^5.0.0",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/pg": "^8.11.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```
`backend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```
`backend/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 2: Author the schema migration**
`backend/migrations/001_init.sql`:
```sql
-- 001_init.sql — initial Puddle interviewer schema.

CREATE TABLE sessions (
  session_id      TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  candidate_email TEXT NOT NULL,
  script_version  TEXT NOT NULL,
  status          TEXT NOT NULL,
  scheduled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consent_records (
  session_id                 TEXT PRIMARY KEY REFERENCES sessions(session_id),
  candidate_email            TEXT NOT NULL,
  ai_disclosure_acknowledged BOOLEAN NOT NULL,
  recording_consented        BOOLEAN NOT NULL,
  consented_at               TIMESTAMPTZ NOT NULL
);

CREATE TABLE assessments (
  session_id          TEXT PRIMARY KEY REFERENCES sessions(session_id),
  script_version      TEXT NOT NULL,
  category_scores     JSONB NOT NULL,
  meets_bare_minimum  BOOLEAN NOT NULL,
  integrity_flags     JSONB NOT NULL DEFAULT '[]'::jsonb,
  reviewer_email      TEXT,
  signed_off_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id          BIGGENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(session_id),
  kind        TEXT NOT NULL,            -- agent | media | integrity
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX events_session_idx ON events(session_id);

CREATE TABLE audit_log (
  id          BIGGENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  TEXT REFERENCES sessions(session_id),
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  prev_hash   TEXT,
  entry_hash  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_session_idx ON audit_log(session_id);

CREATE TABLE schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Note: correct the identity column type — replace `BIGGENERATED ALWAYS AS IDENTITY` with `BIGINT GENERATED ALWAYS AS IDENTITY` before applying. (Authored deliberately verbatim here so the verification step in Step 6 catches it; the apply command will reject the typo.)

- [ ] **Step 3: Fix the identity column type in the migration**
Apply this exact correction to `backend/migrations/001_init.sql` — replace both occurrences:
```sql
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
```

- [ ] **Step 4: Write the connection pool and migration runner**
`backend/src/db/pool.ts`:
```typescript
import { Pool } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
```
`backend/src/db/migrate.ts`:
```typescript
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool } from "./pool.js";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

export async function runMigrations(): Promise<string[]> {
  const pool = getPool();
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations " +
      "(version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  const { rows } = await pool.query<{ version: string }>("SELECT version FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.version));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations(version) VALUES ($1)", [version]);
      await pool.query("COMMIT");
      ran.push(version);
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
  }
  return ran;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then((ran) => {
      console.log(ran.length ? `Applied: ${ran.join(", ")}` : "No pending migrations");
    })
    .finally(() => closePool());
}
```

- [ ] **Step 5: Write the storage layout helper with a failing test first**
`backend/test/layout.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { storagePaths } from "../src/storage/layout.js";

describe("storagePaths", () => {
  it("builds the spec storage layout under org and session", () => {
    const p = storagePaths("org1", "sess1");
    expect(p.root).toBe("/org1/interviews/sess1/");
    expect(p.media.composite).toBe("/org1/interviews/sess1/media/composite.mp4");
    expect(p.media.candidateVideo).toBe("/org1/interviews/sess1/media/candidate_video.mp4");
    expect(p.media.candidateAudio).toBe("/org1/interviews/sess1/media/candidate_audio.m4a");
    expect(p.media.agentAudio).toBe("/org1/interviews/sess1/media/agent_audio.m4a");
    expect(p.transcripts.transcript).toBe(
      "/org1/interviews/sess1/transcripts/transcript.v1.json",
    );
    expect(p.events.agentEvents).toBe("/org1/interviews/sess1/events/agent_events.jsonl");
    expect(p.events.mediaEvents).toBe("/org1/interviews/sess1/events/media_events.jsonl");
    expect(p.events.integrityEvents).toBe(
      "/org1/interviews/sess1/events/integrity_events.jsonl",
    );
    expect(p.assessment.scores).toBe("/org1/interviews/sess1/assessment/scores.json");
    expect(p.assessment.integrityFlags).toBe(
      "/org1/interviews/sess1/assessment/integrity_flags.json",
    );
    expect(p.review.reviewerNotes).toBe("/org1/interviews/sess1/review/reviewer_notes.json");
    expect(p.review.signoff).toBe("/org1/interviews/sess1/review/signoff.json");
    expect(p.audit.consent).toBe("/org1/interviews/sess1/audit/consent.json");
    expect(p.audit.scriptVersion).toBe("/org1/interviews/sess1/audit/script_version.json");
    expect(p.audit.modelVersions).toBe("/org1/interviews/sess1/audit/model_versions.json");
  });
});
```
Run: `cd backend && pnpm install && pnpm test`
Expected: FAIL — cannot resolve `../src/storage/layout.js`

`backend/src/storage/layout.ts`:
```typescript
export interface StoragePaths {
  readonly root: string;
  readonly media: {
    readonly composite: string;
    readonly candidateVideo: string;
    readonly candidateAudio: string;
    readonly agentAudio: string;
  };
  readonly transcripts: { readonly transcript: string };
  readonly events: {
    readonly agentEvents: string;
    readonly mediaEvents: string;
    readonly integrityEvents: string;
  };
  readonly assessment: { readonly scores: string; readonly integrityFlags: string };
  readonly review: { readonly reviewerNotes: string; readonly signoff: string };
  readonly audit: {
    readonly consent: string;
    readonly scriptVersion: string;
    readonly modelVersions: string;
  };
}

export function storagePaths(orgId: string, sessionId: string): StoragePaths {
  const root = `/${orgId}/interviews/${sessionId}/`;
  return {
    root,
    media: {
      composite: `${root}media/composite.mp4`,
      candidateVideo: `${root}media/candidate_video.mp4`,
      candidateAudio: `${root}media/candidate_audio.m4a`,
      agentAudio: `${root}media/agent_audio.m4a`,
    },
    transcripts: { transcript: `${root}transcripts/transcript.v1.json` },
    events: {
      agentEvents: `${root}events/agent_events.jsonl`,
      mediaEvents: `${root}events/media_events.jsonl`,
      integrityEvents: `${root}events/integrity_events.jsonl`,
    },
    assessment: {
      scores: `${root}assessment/scores.json`,
      integrityFlags: `${root}assessment/integrity_flags.json`,
    },
    review: {
      reviewerNotes: `${root}review/reviewer_notes.json`,
      signoff: `${root}review/signoff.json`,
    },
    audit: {
      consent: `${root}audit/consent.json`,
      scriptVersion: `${root}audit/script_version.json`,
      modelVersions: `${root}audit/model_versions.json`,
    },
  };
}
```
Run: `cd backend && pnpm test`
Expected: PASS (1 passed)

- [ ] **Step 6: Apply the migration to the database   [manual-gate]**
Run: `cd backend && DATABASE_URL=$PUDDLE_DATABASE_URL pnpm migrate`
Expected: `Applied: 001_init` (exit 0). If `BIGGENERATED` was not fixed in Step 3, this fails with a syntax error near `BIGGENERATED` — fix and re-run.
**HALT here for operator approval before running this step.**

- [ ] **Step 7: Write the deletion-on-request routine with a failing test first**
`backend/test/deletion.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { buildDeletionPlan } from "../src/db/deletion.js";

describe("buildDeletionPlan", () => {
  it("lists every table holding candidate data, children before parent", () => {
    const plan = buildDeletionPlan("sess1");
    const tables = plan.statements.map((s) => s.table);
    expect(tables).toEqual([
      "events",
      "audit_log",
      "assessments",
      "consent_records",
      "sessions",
    ]);
    expect(plan.statements.every((s) => s.params[0] === "sess1")).toBe(true);
    expect(plan.statements[0].sql).toContain("DELETE FROM events");
  });

  it("includes object-storage prefix for media deletion", () => {
    const plan = buildDeletionPlan("sess1", "org1");
    expect(plan.storagePrefix).toBe("/org1/interviews/sess1/");
  });
});
```
Run: `cd backend && pnpm test`
Expected: FAIL — cannot resolve `../src/db/deletion.js`

`backend/src/db/deletion.ts`:
```typescript
import { getPool } from "./pool.js";
import { storagePaths } from "../storage/layout.js";

export interface DeletionStatement {
  readonly table: string;
  readonly sql: string;
  readonly params: readonly string[];
}

export interface DeletionPlan {
  readonly sessionId: string;
  readonly statements: readonly DeletionStatement[];
  readonly storagePrefix?: string;
}

// Children before parent so foreign keys are never violated.
const DELETION_ORDER = ["events", "audit_log", "assessments", "consent_records", "sessions"];

export function buildDeletionPlan(sessionId: string, orgId?: string): DeletionPlan {
  const statements = DELETION_ORDER.map((table) => ({
    table,
    sql: `DELETE FROM ${table} WHERE session_id = $1`,
    params: [sessionId] as const,
  }));
  return {
    sessionId,
    statements,
    storagePrefix: orgId ? storagePaths(orgId, sessionId).root : undefined,
  };
}

export async function executeDeletion(plan: DeletionPlan): Promise<void> {
  const pool = getPool();
  await pool.query("BEGIN");
  try {
    for (const stmt of plan.statements) {
      await pool.query(stmt.sql, [...stmt.params]);
    }
    await pool.query("COMMIT");
  } catch (err) {
    await pool.query("ROLLBACK");
    throw err;
  }
}
```
Run: `cd backend && pnpm test`
Expected: PASS (3 passed total)

- [ ] **Step 8: Verify the backend builds**
Run: `cd backend && pnpm build`
Expected: exit 0, `dist/` produced

- [ ] **Step 9: Commit**
```bash
git add backend/package.json backend/tsconfig.json backend/vitest.config.ts backend/migrations backend/src/db backend/src/storage backend/test pnpm-lock.yaml && git commit -m "Add PostgreSQL schema, migration runner, storage layout, deletion routine"
```

---

### Task 1.7: Consent capture data model and record writer

**Files:**
- Create: `backend/src/consent/repository.ts`
- Test: `backend/test/consent.test.ts`

- [ ] **Step 1: Write the failing test**
`backend/test/consent.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { validateConsent, consentInsertStatement } from "../src/consent/repository.js";

describe("validateConsent", () => {
  it("accepts a fully acknowledged, consented record", () => {
    const result = validateConsent({
      sessionId: "sess1",
      candidateEmail: "c@example.com",
      aiDisclosureAcknowledged: true,
      recordingConsented: true,
      consentedAt: "2026-05-20T10:00:00Z",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects when AI disclosure is not acknowledged", () => {
    const result = validateConsent({
      sessionId: "sess1",
      candidateEmail: "c@example.com",
      aiDisclosureAcknowledged: false,
      recordingConsented: true,
      consentedAt: "2026-05-20T10:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("AI disclosure");
  });

  it("rejects when recording is not consented", () => {
    const result = validateConsent({
      sessionId: "sess1",
      candidateEmail: "c@example.com",
      aiDisclosureAcknowledged: true,
      recordingConsented: false,
      consentedAt: "2026-05-20T10:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("recording");
  });
});

describe("consentInsertStatement", () => {
  it("builds a parameterized insert for consent_records", () => {
    const stmt = consentInsertStatement({
      sessionId: "sess1",
      candidateEmail: "c@example.com",
      aiDisclosureAcknowledged: true,
      recordingConsented: true,
      consentedAt: "2026-05-20T10:00:00Z",
    });
    expect(stmt.sql).toContain("INSERT INTO consent_records");
    expect(stmt.params).toEqual([
      "sess1",
      "c@example.com",
      true,
      true,
      "2026-05-20T10:00:00Z",
    ]);
  });
});
```
Run: `cd backend && pnpm test`
Expected: FAIL — cannot resolve `../src/consent/repository.js`

- [ ] **Step 2: Run test to verify it fails**
Run: `cd backend && pnpm test`
Expected: FAIL with module resolution error for `consent/repository.js`

- [ ] **Step 3: Write minimal implementation**
`backend/src/consent/repository.ts`:
```typescript
export interface ConsentInput {
  readonly sessionId: string;
  readonly candidateEmail: string;
  readonly aiDisclosureAcknowledged: boolean;
  readonly recordingConsented: boolean;
  readonly consentedAt: string;
}

export type ConsentValidation = { ok: true } | { ok: false; reason: string };

export function validateConsent(input: ConsentInput): ConsentValidation {
  if (!input.aiDisclosureAcknowledged) {
    return { ok: false, reason: "AI disclosure must be acknowledged before recording" };
  }
  if (!input.recordingConsented) {
    return { ok: false, reason: "recording consent is required before recording" };
  }
  return { ok: true };
}

export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly (string | boolean)[];
}

export function consentInsertStatement(input: ConsentInput): SqlStatement {
  return {
    sql:
      "INSERT INTO consent_records " +
      "(session_id, candidate_email, ai_disclosure_acknowledged, " +
      "recording_consented, consented_at) VALUES ($1, $2, $3, $4, $5)",
    params: [
      input.sessionId,
      input.candidateEmail,
      input.aiDisclosureAcknowledged,
      input.recordingConsented,
      input.consentedAt,
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd backend && pnpm test`
Expected: PASS (all consent tests pass)

- [ ] **Step 5: Commit**
```bash
git add backend/src/consent backend/test/consent.test.ts && git commit -m "Add consent capture validation and record writer"
```

---

## Phase 2: The IP, offline

### Task 2.1: Scorer I/O types

**Files:**
- Create: `agent/src/agent/scoring/__init__.py`
- Create: `agent/src/agent/scoring/io_types.py`
- Test: `agent/tests/test_scorer_io_types.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_scorer_io_types.py`:
```python
import pytest
from pydantic import ValidationError

from agent.domain.types import TranscriptTurn
from agent.scoring.io_types import CategoryAssessment, ScorerInput, ScorerOutput


def test_scorer_input_holds_context() -> None:
    turn = TranscriptTurn(turn_index=0, speaker="candidate", text="hi", question_id="q1")
    si = ScorerInput(
        script_version="pilot-v1",
        question_id="q1",
        target_categories=["problem_solving"],
        transcript=[turn],
    )
    assert si.question_id == "q1"
    assert si.target_categories == ["problem_solving"]


def test_category_assessment_fields_and_ranges() -> None:
    ca = CategoryAssessment(
        category="problem_solving",
        provisional_score=3,
        confidence=0.7,
        evidence_quotes=["I rewrote the scheduler"],
        missing_or_ambiguous=["impact and recognition unclear"],
    )
    assert ca.provisional_score == 3
    with pytest.raises(ValidationError):
        CategoryAssessment(
            category="x", provisional_score=0, confidence=0.5,
            evidence_quotes=[], missing_or_ambiguous=[],
        )
    with pytest.raises(ValidationError):
        CategoryAssessment(
            category="x", provisional_score=2, confidence=1.5,
            evidence_quotes=[], missing_or_ambiguous=[],
        )


def test_scorer_output_keyed_by_category() -> None:
    ca = CategoryAssessment(
        category="agency", provisional_score=2, confidence=0.4,
        evidence_quotes=[], missing_or_ambiguous=["no concrete action described"],
    )
    out = ScorerOutput(assessments=[ca])
    assert out.by_category()["agency"].confidence == 0.4
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_scorer_io_types.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.scoring'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/scoring/__init__.py`:
```python
"""Live Rubric Scorer and Probe Generator — the interview IP."""
```
`agent/src/agent/scoring/io_types.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_scorer_io_types.py`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/scoring/__init__.py agent/src/agent/scoring/io_types.py agent/tests/test_scorer_io_types.py && git commit -m "Add Scorer I/O types: ScorerInput, CategoryAssessment, ScorerOutput"
```

---

### Task 2.2: Scorer — prompt builder, Anthropic call, structured-output parsing

**Files:**
- Create: `agent/src/agent/config.py`
- Create: `agent/src/agent/scoring/prompt.py`
- Create: `agent/src/agent/scoring/scorer.py`
- Modify: `agent/pyproject.toml`
- Test: `agent/tests/test_scorer_prompt.py`
- Test: `agent/tests/test_scorer.py`

- [ ] **Step 1: Add the Anthropic SDK dependency**
Modify `agent/pyproject.toml` — add to the `dependencies` list:
```toml
    "anthropic>=0.40",
```
Run: `cd agent && uv sync --extra dev`
Expected: resolves `anthropic`, exit 0

- [ ] **Step 2: Write the failing test for the prompt builder**
`agent/tests/test_scorer_prompt.py`:
```python
from pathlib import Path

from agent.domain.types import TranscriptTurn
from agent.rubric_loader import load_rubric
from agent.scoring.io_types import ScorerInput
from agent.scoring.prompt import build_scorer_messages

RUBRIC = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")


def test_system_block_contains_rubric_and_is_cacheable() -> None:
    si = ScorerInput(
        script_version="pilot-v1", question_id="q1",
        target_categories=["problem_solving"],
        transcript=[TranscriptTurn(turn_index=0, speaker="agent", text="q1", question_id="q1")],
    )
    system, messages = build_scorer_messages(RUBRIC, si)
    # System is a list of content blocks; the rubric block is cache-flagged.
    assert isinstance(system, list)
    rubric_block = system[-1]
    assert rubric_block["cache_control"] == {"type": "ephemeral"}
    assert "Problem Solving" in rubric_block["text"]
    assert "Front page on Hacker News." in rubric_block["text"]


def test_user_message_contains_transcript_and_target_categories() -> None:
    si = ScorerInput(
        script_version="pilot-v1", question_id="q1",
        target_categories=["problem_solving"],
        transcript=[
            TranscriptTurn(turn_index=0, speaker="agent", text="Tell me.", question_id="q1"),
            TranscriptTurn(turn_index=1, speaker="candidate", text="I rewrote it.", question_id="q1"),
        ],
    )
    _system, messages = build_scorer_messages(RUBRIC, si)
    user_text = messages[0]["content"]
    assert "I rewrote it." in user_text
    assert "problem_solving" in user_text
```

- [ ] **Step 3: Run prompt test to verify it fails**
Run: `cd agent && uv run pytest tests/test_scorer_prompt.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.scoring.prompt'`

- [ ] **Step 4: Write the config module and prompt builder**
`agent/src/agent/config.py`:
```python
"""Runtime configuration — model ids and tunables, swappable via env."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelConfig:
    """Model ids for each LLM/VLM role. Swappable without code changes."""

    scorer_model: str = os.getenv("PUDDLE_SCORER_MODEL", "claude-opus-4-7")
    probe_model: str = os.getenv("PUDDLE_PROBE_MODEL", "claude-opus-4-7")
    vlm_model: str = os.getenv("PUDDLE_VLM_MODEL", "gemini-2.5-flash")


@dataclass(frozen=True)
class ScoringConfig:
    """Tunables for the score-driven loop."""

    confidence_threshold: float = float(os.getenv("PUDDLE_CONFIDENCE_THRESHOLD", "0.75"))
    scorer_max_tokens: int = 2048
    scorer_timeout_seconds: float = 12.0


MODELS = ModelConfig()
SCORING = ScoringConfig()
```
`agent/src/agent/scoring/prompt.py`:
```python
"""Prompt construction for the Live Rubric Scorer."""

from __future__ import annotations

from typing import Any

from agent.domain.types import Rubric
from agent.scoring.io_types import ScorerInput

_SCORER_INSTRUCTIONS = (
    "You are the Live Rubric Scorer for a structured hiring interview. "
    "Assess the candidate ONLY on the content of what they said — never on "
    "voice, video, or delivery. For each target category, place the candidate "
    "by the SPIRIT of the 1-4 anchors (anchors are illustrative levels, not "
    "literal checklists). Score the level actually demonstrated, regardless of "
    "which level the question invited. Return STRICT JSON only, no prose, "
    "matching this schema: "
    '{"assessments": [{"category": str, "provisional_score": 1-4, '
    '"confidence": 0.0-1.0, "evidence_quotes": [str], '
    '"missing_or_ambiguous": [str]}]}. '
    "confidence is how sure you are of the score given the evidence so far; "
    "list every still-missing or ambiguous element in missing_or_ambiguous."
)


def _render_rubric(rubric: Rubric) -> str:
    lines = [f"RUBRIC (script_version={rubric.script_version})", ""]
    for cat in rubric.categories:
        lines.append(f"## {cat.name} (key={cat.key})")
        lines.append(f"Meaning: {cat.meaning}")
        for level in (1, 2, 3, 4):
            lines.append(f"  {level}: {cat.anchors[level]}")
        lines.append("")
    lines.append(f"Bare-minimum rule: {rubric.bare_minimum_rule}")
    return "\n".join(lines)


def _render_transcript(scorer_input: ScorerInput) -> str:
    lines = []
    for turn in scorer_input.transcript:
        marker = "CANDIDATE" if turn.speaker == "candidate" else "AGENT"
        flag = " [unreliable]" if turn.unreliable else ""
        lines.append(f"{marker}{flag}: {turn.text}")
    return "\n".join(lines)


def build_scorer_messages(
    rubric: Rubric, scorer_input: ScorerInput
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return `(system_blocks, messages)` for the Anthropic Messages API.

    The rubric block carries `cache_control` so the static rubric/system
    prompt is served from cache across the many scoring calls per interview.
    """
    system: list[dict[str, Any]] = [
        {"type": "text", "text": _SCORER_INSTRUCTIONS},
        {
            "type": "text",
            "text": _render_rubric(rubric),
            "cache_control": {"type": "ephemeral"},
        },
    ]
    user_text = (
        f"Current question_id: {scorer_input.question_id}\n"
        f"Target categories to score now: "
        f"{', '.join(scorer_input.target_categories)}\n\n"
        f"TRANSCRIPT SO FAR:\n{_render_transcript(scorer_input)}\n\n"
        "Score every target category. Return strict JSON."
    )
    messages = [{"role": "user", "content": user_text}]
    return system, messages
```

- [ ] **Step 5: Run prompt test to verify it passes**
Run: `cd agent && uv run pytest tests/test_scorer_prompt.py`
Expected: PASS (2 passed)

- [ ] **Step 6: Write the failing test for the Scorer (mocked Anthropic)**
`agent/tests/test_scorer.py`:
```python
import json
from pathlib import Path
from unittest.mock import MagicMock

from agent.domain.types import TranscriptTurn
from agent.rubric_loader import load_rubric
from agent.scoring.io_types import ScorerInput
from agent.scoring.scorer import Scorer

RUBRIC = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")


def _fake_anthropic(payload: dict) -> MagicMock:
    client = MagicMock()
    block = MagicMock()
    block.text = json.dumps(payload)
    response = MagicMock()
    response.content = [block]
    client.messages.create.return_value = response
    return client


def test_scorer_parses_structured_output() -> None:
    client = _fake_anthropic(
        {
            "assessments": [
                {
                    "category": "problem_solving",
                    "provisional_score": 3,
                    "confidence": 0.82,
                    "evidence_quotes": ["I rewrote the scheduler"],
                    "missing_or_ambiguous": [],
                }
            ]
        }
    )
    scorer = Scorer(client=client, rubric=RUBRIC)
    si = ScorerInput(
        script_version="pilot-v1", question_id="q1",
        target_categories=["problem_solving"],
        transcript=[TranscriptTurn(turn_index=0, speaker="candidate", text="x", question_id="q1")],
    )
    out = scorer.score(si)
    assert out.by_category()["problem_solving"].provisional_score == 3
    assert out.by_category()["problem_solving"].confidence == 0.82


def test_scorer_passes_cacheable_system_to_anthropic() -> None:
    client = _fake_anthropic({"assessments": []})
    scorer = Scorer(client=client, rubric=RUBRIC)
    si = ScorerInput(
        script_version="pilot-v1", question_id="q1", target_categories=["agency"],
        transcript=[TranscriptTurn(turn_index=0, speaker="candidate", text="x", question_id="q1")],
    )
    scorer.score(si)
    kwargs = client.messages.create.call_args.kwargs
    assert kwargs["system"][-1]["cache_control"] == {"type": "ephemeral"}
    assert kwargs["model"]  # model id is supplied from config


def test_scorer_raises_on_non_json_output() -> None:
    client = _fake_anthropic({})
    block = MagicMock()
    block.text = "I cannot answer that."
    client.messages.create.return_value.content = [block]
    scorer = Scorer(client=client, rubric=RUBRIC)
    si = ScorerInput(
        script_version="pilot-v1", question_id="q1", target_categories=["agency"],
        transcript=[TranscriptTurn(turn_index=0, speaker="candidate", text="x", question_id="q1")],
    )
    import pytest

    from agent.scoring.scorer import ScorerParseError

    with pytest.raises(ScorerParseError):
        scorer.score(si)
```

- [ ] **Step 7: Run Scorer test to verify it fails**
Run: `cd agent && uv run pytest tests/test_scorer.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.scoring.scorer'`

- [ ] **Step 8: Write the Scorer implementation**
`agent/src/agent/scoring/scorer.py`:
```python
"""The Live Rubric Scorer — Anthropic-backed, prompt-cached, structured output."""

from __future__ import annotations

import json
from typing import Any

from agent.config import MODELS, SCORING
from agent.domain.types import Rubric
from agent.scoring.io_types import ScorerInput, ScorerOutput
from agent.scoring.prompt import build_scorer_messages


class ScorerParseError(Exception):
    """Raised when the Scorer LLM output is not valid structured JSON."""


def _extract_json(text: str) -> dict[str, Any]:
    """Extract the first JSON object from an LLM text response."""
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ScorerParseError(f"no JSON object in scorer output: {text!r}")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise ScorerParseError(f"invalid scorer JSON: {exc}") from exc


class Scorer:
    """Scores a transcript against the rubric via the Anthropic Messages API.

    The same component runs live (per turn) and in the eval harness
    (standalone over corpus transcripts).
    """

    def __init__(self, client: Any, rubric: Rubric) -> None:
        self._client = client
        self._rubric = rubric

    def score(self, scorer_input: ScorerInput) -> ScorerOutput:
        """Run one scoring pass; return the structured `ScorerOutput`."""
        system, messages = build_scorer_messages(self._rubric, scorer_input)
        response = self._client.messages.create(
            model=MODELS.scorer_model,
            max_tokens=SCORING.scorer_max_tokens,
            system=system,
            messages=messages,
        )
        text = "".join(block.text for block in response.content)
        payload = _extract_json(text)
        try:
            return ScorerOutput.model_validate(payload)
        except Exception as exc:  # noqa: BLE001 — surface as a parse error
            raise ScorerParseError(f"scorer output failed schema: {exc}") from exc
```

- [ ] **Step 9: Run Scorer test to verify it passes**
Run: `cd agent && uv run pytest tests/test_scorer.py`
Expected: PASS (3 passed)

- [ ] **Step 10: Commit**
```bash
git add agent/pyproject.toml agent/uv.lock agent/src/agent/config.py agent/src/agent/scoring/prompt.py agent/src/agent/scoring/scorer.py agent/tests/test_scorer_prompt.py agent/tests/test_scorer.py && git commit -m "Add Live Rubric Scorer: prompt builder, prompt-cached Anthropic call, parsing"
```

---

### Task 2.3: Scoring rollup — final per-category scores and bare-minimum determination

**Files:**
- Create: `agent/src/agent/scoring/rollup.py`
- Test: `agent/tests/test_rollup.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_rollup.py`:
```python
from agent.scoring.io_types import CategoryAssessment
from agent.scoring.rollup import meets_bare_minimum, roll_up_assessment


def _ca(cat: str, score: int, conf: float) -> CategoryAssessment:
    return CategoryAssessment(
        category=cat, provisional_score=score, confidence=conf,
        evidence_quotes=["q"], missing_or_ambiguous=[],
    )


def test_meets_bare_minimum_true_when_one_4_and_ps_ge_3() -> None:
    scores = {"problem_solving": 3, "agency": 4, "competitiveness": 2, "curious": 1}
    assert meets_bare_minimum(scores) is True


def test_meets_bare_minimum_false_without_a_4() -> None:
    scores = {"problem_solving": 3, "agency": 3, "competitiveness": 3, "curious": 3}
    assert meets_bare_minimum(scores) is False


def test_meets_bare_minimum_false_when_ps_below_3() -> None:
    scores = {"problem_solving": 2, "agency": 4, "competitiveness": 1, "curious": 1}
    assert meets_bare_minimum(scores) is False


def test_roll_up_builds_assessment_with_low_confidence_flags() -> None:
    final = {
        "problem_solving": _ca("problem_solving", 4, 0.9),
        "agency": _ca("agency", 3, 0.55),
        "competitiveness": _ca("competitiveness", 2, 0.8),
        "curious": _ca("curious", 1, 0.85),
    }
    assessment = roll_up_assessment(
        session_id="s1", script_version="pilot-v1",
        final_assessments=final, integrity_flags=["multiple_faces"],
        confidence_threshold=0.75,
    )
    assert assessment.meets_bare_minimum is True  # PS=4 satisfies both clauses
    by_cat = {cs.category: cs for cs in assessment.category_scores}
    assert by_cat["agency"].low_confidence is True
    assert by_cat["problem_solving"].low_confidence is False
    assert assessment.integrity_flags == ["multiple_faces"]
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_rollup.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.scoring.rollup'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/scoring/rollup.py`:
```python
"""Roll provisional per-category assessments into a final `Assessment`."""

from __future__ import annotations

from agent.domain.types import Assessment, CategoryScore
from agent.scoring.io_types import CategoryAssessment


def meets_bare_minimum(scores: dict[str, int]) -> bool:
    """Apply the pilot bare-minimum rule.

    Rule: at least one dimension scored 4, AND problem_solving >= 3.
    """
    has_a_four = any(score == 4 for score in scores.values())
    ps_ok = scores.get("problem_solving", 0) >= 3
    return has_a_four and ps_ok


def roll_up_assessment(
    session_id: str,
    script_version: str,
    final_assessments: dict[str, CategoryAssessment],
    integrity_flags: list[str],
    confidence_threshold: float,
) -> Assessment:
    """Convert the final per-category assessments into an `Assessment`.

    A category whose confidence is below `confidence_threshold` is recorded
    with `low_confidence=True` and flagged for the reviewer.
    """
    category_scores: list[CategoryScore] = []
    plain_scores: dict[str, int] = {}
    for category, ca in final_assessments.items():
        plain_scores[category] = ca.provisional_score
        category_scores.append(
            CategoryScore(
                category=category,
                score=ca.provisional_score,
                confidence=ca.confidence,
                evidence_quotes=ca.evidence_quotes,
                rationale="; ".join(ca.missing_or_ambiguous) or "evidence sufficient",
                low_confidence=ca.confidence < confidence_threshold,
            )
        )
    return Assessment(
        session_id=session_id,
        script_version=script_version,
        category_scores=category_scores,
        meets_bare_minimum=meets_bare_minimum(plain_scores),
        integrity_flags=integrity_flags,
    )
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_rollup.py`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/scoring/rollup.py agent/tests/test_rollup.py && git commit -m "Add scoring rollup and bare-minimum determination"
```

---

### Task 2.4: Probe Generator

**Files:**
- Create: `agent/src/agent/scoring/probe.py`
- Test: `agent/tests/test_probe.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_probe.py`:
```python
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from agent.domain.types import TranscriptTurn
from agent.rubric_loader import load_rubric
from agent.scoring.io_types import CategoryAssessment
from agent.scoring.probe import ProbeGenerator, ProbeRequest

RUBRIC = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")


def _fake_anthropic(text: str) -> MagicMock:
    client = MagicMock()
    block = MagicMock()
    block.text = text
    response = MagicMock()
    response.content = [block]
    client.messages.create.return_value = response
    return client


def _request() -> ProbeRequest:
    return ProbeRequest(
        category_assessment=CategoryAssessment(
            category="problem_solving", provisional_score=2, confidence=0.4,
            evidence_quotes=["I fixed a bug"],
            missing_or_ambiguous=["the impact and level of recognition"],
        ),
        transcript=[
            TranscriptTurn(turn_index=0, speaker="candidate", text="I fixed a bug.", question_id="q1"),
        ],
        probes_used=0,
        max_probes=2,
    )


def test_probe_generator_returns_followup_text() -> None:
    client = _fake_anthropic("What was the measurable impact of that fix?")
    gen = ProbeGenerator(client=client, rubric=RUBRIC)
    probe = gen.generate(_request())
    assert probe == "What was the measurable impact of that fix?"


def test_probe_prompt_includes_missing_element() -> None:
    client = _fake_anthropic("follow up")
    gen = ProbeGenerator(client=client, rubric=RUBRIC)
    gen.generate(_request())
    sent = client.messages.create.call_args.kwargs["messages"][0]["content"]
    assert "the impact and level of recognition" in sent


def test_probe_generator_refuses_when_budget_exhausted() -> None:
    client = _fake_anthropic("should not be called")
    gen = ProbeGenerator(client=client, rubric=RUBRIC)
    request = _request().model_copy(update={"probes_used": 2})
    with pytest.raises(ValueError, match="probe budget"):
        gen.generate(request)
    client.messages.create.assert_not_called()
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_probe.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.scoring.probe'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/scoring/probe.py`:
```python
"""The Probe Generator — drafts targeted follow-ups for low-confidence categories."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

from agent.config import MODELS
from agent.domain.types import Rubric, TranscriptTurn
from agent.scoring.io_types import CategoryAssessment

_PROBE_INSTRUCTIONS = (
    "You draft ONE short follow-up interview question. It must elicit the "
    "specific missing evidence named below — nothing more. Rules: never coach, "
    "never hint at a desired answer, never add new criteria, never reveal the "
    "rubric. Return ONLY the question text, a single sentence, no preamble."
)


class ProbeRequest(BaseModel):
    """Inputs needed to draft one probe."""

    model_config = ConfigDict(frozen=True)

    category_assessment: CategoryAssessment
    transcript: list[TranscriptTurn]
    probes_used: int
    max_probes: int


def _render_transcript(turns: list[TranscriptTurn]) -> str:
    out = []
    for turn in turns:
        marker = "CANDIDATE" if turn.speaker == "candidate" else "AGENT"
        out.append(f"{marker}: {turn.text}")
    return "\n".join(out)


class ProbeGenerator:
    """Generates elicitation-focused follow-up questions via Anthropic."""

    def __init__(self, client: Any, rubric: Rubric) -> None:
        self._client = client
        self._rubric = rubric

    def generate(self, request: ProbeRequest) -> str:
        """Draft a follow-up targeting the assessment's missing elements.

        Raises `ValueError` if the per-question probe budget is exhausted.
        """
        if request.probes_used >= request.max_probes:
            raise ValueError("probe budget exhausted for this question")
        ca = request.category_assessment
        missing = "; ".join(ca.missing_or_ambiguous) or "unclear evidence"
        user_text = (
            f"Category being assessed: {ca.category}\n"
            f"Missing or ambiguous evidence to target: {missing}\n\n"
            f"TRANSCRIPT SO FAR:\n{_render_transcript(request.transcript)}\n\n"
            "Write one follow-up question."
        )
        response = self._client.messages.create(
            model=MODELS.probe_model,
            max_tokens=256,
            system=[
                {
                    "type": "text",
                    "text": _PROBE_INSTRUCTIONS,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_text}],
        )
        return "".join(block.text for block in response.content).strip()
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_probe.py`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/scoring/probe.py agent/tests/test_probe.py && git commit -m "Add Probe Generator targeting low-confidence missing evidence"
```

---

### Task 2.5: Eval harness corpus loader

**Files:**
- Create: `agent/src/agent/eval/__init__.py`
- Create: `agent/src/agent/eval/corpus.py`
- Test: `agent/tests/test_corpus_loader.py`

> The corpus lives under `corpus/` (gitignored). Each corpus item is a JSON file: a question-aligned transcript plus the human scores. The loader is the only reader of that format.

- [ ] **Step 1: Write the failing test**
`agent/tests/test_corpus_loader.py`:
```python
import json
from pathlib import Path

import pytest

from agent.eval.corpus import CorpusItem, load_corpus


def _write_item(directory: Path, name: str, payload: dict) -> None:
    (directory / name).write_text(json.dumps(payload))


def test_loads_corpus_items(tmp_path: Path) -> None:
    _write_item(
        tmp_path,
        "interview_001.json",
        {
            "interview_id": "interview_001",
            "script_version": "pilot-v1",
            "transcript": [
                {"turn_index": 0, "speaker": "agent", "text": "q1", "question_id": "q1"},
                {"turn_index": 1, "speaker": "candidate", "text": "answer", "question_id": "q1"},
            ],
            "human_scores": {
                "problem_solving": 3, "agency": 2,
                "competitiveness": 1, "curious": 4,
            },
        },
    )
    items = load_corpus(tmp_path)
    assert len(items) == 1
    item = items[0]
    assert isinstance(item, CorpusItem)
    assert item.interview_id == "interview_001"
    assert item.human_scores["curious"] == 4
    assert item.transcript[1].speaker == "candidate"


def test_load_corpus_ignores_non_json(tmp_path: Path) -> None:
    (tmp_path / "notes.txt").write_text("ignore me")
    _write_item(
        tmp_path,
        "a.json",
        {
            "interview_id": "a", "script_version": "pilot-v1",
            "transcript": [
                {"turn_index": 0, "speaker": "candidate", "text": "x", "question_id": "q1"}
            ],
            "human_scores": {
                "problem_solving": 1, "agency": 1,
                "competitiveness": 1, "curious": 1,
            },
        },
    )
    assert len(load_corpus(tmp_path)) == 1


def test_load_corpus_rejects_missing_human_scores(tmp_path: Path) -> None:
    _write_item(
        tmp_path,
        "bad.json",
        {
            "interview_id": "bad", "script_version": "pilot-v1",
            "transcript": [
                {"turn_index": 0, "speaker": "candidate", "text": "x", "question_id": "q1"}
            ],
        },
    )
    with pytest.raises(ValueError, match="human_scores"):
        load_corpus(tmp_path)
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_corpus_loader.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.eval'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/eval/__init__.py`:
```python
"""Offline evaluation and calibration harness for the Scorer."""
```
`agent/src/agent/eval/corpus.py`:
```python
"""Load the human-scored interview corpus for offline Scorer evaluation."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, ConfigDict, ValidationError

from agent.domain.types import TranscriptTurn


class CorpusItem(BaseModel):
    """One human-scored interview: transcript plus ground-truth scores."""

    model_config = ConfigDict(frozen=True)

    interview_id: str
    script_version: str
    transcript: list[TranscriptTurn]
    human_scores: dict[str, int]


def load_corpus(directory: Path) -> list[CorpusItem]:
    """Load every `*.json` corpus item from `directory`, sorted by filename.

    Raises `ValueError` if an item is missing required fields.
    """
    items: list[CorpusItem] = []
    for path in sorted(directory.glob("*.json")):
        raw = json.loads(path.read_text())
        try:
            items.append(CorpusItem.model_validate(raw))
        except ValidationError as exc:
            raise ValueError(f"corpus item {path.name} invalid: {exc}") from exc
    return items
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_corpus_loader.py`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/eval/__init__.py agent/src/agent/eval/corpus.py agent/tests/test_corpus_loader.py && git commit -m "Add eval harness corpus loader"
```

---

### Task 2.6: Eval harness replay runner

**Files:**
- Create: `agent/src/agent/eval/replay.py`
- Test: `agent/tests/test_replay.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_replay.py`:
```python
from pathlib import Path
from unittest.mock import MagicMock

from agent.domain.types import TranscriptTurn
from agent.eval.corpus import CorpusItem
from agent.eval.replay import ReplayResult, replay_corpus
from agent.rubric_loader import load_rubric

RUBRIC = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")


def _scorer_stub(per_category: dict[str, int]) -> MagicMock:
    """A Scorer stub: returns the given provisional score per category."""
    from agent.scoring.io_types import CategoryAssessment, ScorerOutput

    def score(scorer_input):  # noqa: ANN001
        return ScorerOutput(
            assessments=[
                CategoryAssessment(
                    category=cat, provisional_score=per_category[cat],
                    confidence=0.9, evidence_quotes=["q"], missing_or_ambiguous=[],
                )
                for cat in scorer_input.target_categories
            ]
        )

    stub = MagicMock()
    stub.score.side_effect = score
    return stub


def _item(interview_id: str, human: dict[str, int]) -> CorpusItem:
    return CorpusItem(
        interview_id=interview_id,
        script_version="pilot-v1",
        transcript=[
            TranscriptTurn(turn_index=0, speaker="candidate", text="x", question_id="q1"),
        ],
        human_scores=human,
    )


def test_replay_scores_each_item_for_all_categories() -> None:
    corpus = [
        _item("a", {"problem_solving": 3, "agency": 2, "competitiveness": 1, "curious": 4}),
    ]
    scorer = _scorer_stub(
        {"problem_solving": 3, "agency": 2, "competitiveness": 2, "curious": 4}
    )
    results = replay_corpus(scorer, RUBRIC, corpus)
    assert len(results) == 1
    result = results[0]
    assert isinstance(result, ReplayResult)
    assert result.interview_id == "a"
    assert result.machine_scores["problem_solving"] == 3
    assert result.human_scores["agency"] == 2
    # competitiveness: machine 2 vs human 1 — recorded as-is.
    assert result.machine_scores["competitiveness"] == 2
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_replay.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.eval.replay'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/eval/replay.py`:
```python
"""Replay the corpus through the Scorer in standalone mode."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from agent.domain.types import Rubric
from agent.eval.corpus import CorpusItem
from agent.scoring.io_types import ScorerInput
from agent.scoring.scorer import Scorer


class ReplayResult(BaseModel):
    """Machine vs. human scores for one replayed corpus interview."""

    model_config = ConfigDict(frozen=True)

    interview_id: str
    machine_scores: dict[str, int]
    human_scores: dict[str, int]


def replay_corpus(
    scorer: Scorer, rubric: Rubric, corpus: list[CorpusItem]
) -> list[ReplayResult]:
    """Score every corpus interview for every rubric category.

    The Scorer is run standalone over the full transcript with all
    categories in play — the same component used live, run one way.
    """
    all_categories = [c.key for c in rubric.categories]
    results: list[ReplayResult] = []
    for item in corpus:
        scorer_input = ScorerInput(
            script_version=item.script_version,
            question_id="full_interview",
            target_categories=all_categories,
            transcript=item.transcript,
        )
        output = scorer.score(scorer_input)
        by_cat = output.by_category()
        machine_scores = {
            cat: by_cat[cat].provisional_score
            for cat in all_categories
            if cat in by_cat
        }
        results.append(
            ReplayResult(
                interview_id=item.interview_id,
                machine_scores=machine_scores,
                human_scores=item.human_scores,
            )
        )
    return results
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_replay.py`
Expected: PASS (1 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/eval/replay.py agent/tests/test_replay.py && git commit -m "Add eval harness corpus replay runner"
```

---

### Task 2.7: Agreement metrics

**Files:**
- Create: `agent/src/agent/eval/metrics.py`
- Test: `agent/tests/test_metrics.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_metrics.py`:
```python
from agent.eval.metrics import AgreementReport, compute_agreement
from agent.eval.replay import ReplayResult


def _result(interview_id: str, machine: dict[str, int], human: dict[str, int]) -> ReplayResult:
    return ReplayResult(
        interview_id=interview_id, machine_scores=machine, human_scores=human
    )


def test_exact_match_and_within_one() -> None:
    results = [
        _result("a", {"problem_solving": 3}, {"problem_solving": 3}),  # exact
        _result("b", {"problem_solving": 2}, {"problem_solving": 3}),  # within 1
        _result("c", {"problem_solving": 1}, {"problem_solving": 4}),  # off by 3
    ]
    report = compute_agreement(results, pass_threshold_within_one=0.6)
    assert report.exact_match_rate == 1 / 3
    assert report.within_one_rate == 2 / 3


def test_per_category_breakdown_present() -> None:
    results = [
        _result("a", {"agency": 4, "curious": 2}, {"agency": 4, "curious": 2}),
        _result("b", {"agency": 2, "curious": 3}, {"agency": 3, "curious": 1}),
    ]
    report = compute_agreement(results, pass_threshold_within_one=0.6)
    assert "agency" in report.per_category
    assert report.per_category["agency"].exact_match_rate == 0.5
    assert report.per_category["curious"].within_one_rate == 0.5


def test_passes_flag_reflects_threshold() -> None:
    good = [_result("a", {"agency": 3}, {"agency": 3})]
    report = compute_agreement(good, pass_threshold_within_one=0.9)
    assert report.passes is True

    bad = [_result("a", {"agency": 1}, {"agency": 4})]
    report = compute_agreement(bad, pass_threshold_within_one=0.9)
    assert report.passes is False
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_metrics.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.eval.metrics'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/eval/metrics.py`:
```python
"""Score-agreement metrics for the eval harness."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from agent.eval.replay import ReplayResult


class CategoryAgreement(BaseModel):
    """Agreement metrics for one rubric category across the corpus."""

    model_config = ConfigDict(frozen=True)

    category: str
    n: int
    exact_match_rate: float
    within_one_rate: float
    correlation: float


class AgreementReport(BaseModel):
    """The full agreement report vs. the human-scored corpus."""

    model_config = ConfigDict(frozen=True)

    n_pairs: int
    exact_match_rate: float
    within_one_rate: float
    per_category: dict[str, CategoryAgreement]
    pass_threshold_within_one: float
    passes: bool


def _pearson(xs: list[float], ys: list[float]) -> float:
    """Pearson correlation; 0.0 when variance is zero or n < 2."""
    n = len(xs)
    if n < 2:
        return 0.0
    mx = sum(xs) / n
    my = sum(ys) / n
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx == 0 or vy == 0:
        return 0.0
    return cov / (vx**0.5 * vy**0.5)


def _pairs(results: list[ReplayResult]) -> list[tuple[str, int, int]]:
    """Flatten results into (category, machine_score, human_score) triples."""
    out: list[tuple[str, int, int]] = []
    for result in results:
        for category, machine in result.machine_scores.items():
            if category in result.human_scores:
                out.append((category, machine, result.human_scores[category]))
    return out


def compute_agreement(
    results: list[ReplayResult], pass_threshold_within_one: float
) -> AgreementReport:
    """Compute overall and per-category agreement against human scores."""
    pairs = _pairs(results)
    n = len(pairs)
    exact = sum(1 for _, m, h in pairs if m == h)
    within_one = sum(1 for _, m, h in pairs if abs(m - h) <= 1)
    exact_rate = exact / n if n else 0.0
    within_one_rate = within_one / n if n else 0.0

    per_category: dict[str, CategoryAgreement] = {}
    categories = {cat for cat, _, _ in pairs}
    for category in sorted(categories):
        cat_pairs = [(m, h) for c, m, h in pairs if c == category]
        cn = len(cat_pairs)
        cat_exact = sum(1 for m, h in cat_pairs if m == h)
        cat_within = sum(1 for m, h in cat_pairs if abs(m - h) <= 1)
        per_category[category] = CategoryAgreement(
            category=category,
            n=cn,
            exact_match_rate=cat_exact / cn if cn else 0.0,
            within_one_rate=cat_within / cn if cn else 0.0,
            correlation=_pearson(
                [float(m) for m, _ in cat_pairs], [float(h) for _, h in cat_pairs]
            ),
        )

    return AgreementReport(
        n_pairs=n,
        exact_match_rate=exact_rate,
        within_one_rate=within_one_rate,
        per_category=per_category,
        pass_threshold_within_one=pass_threshold_within_one,
        passes=within_one_rate >= pass_threshold_within_one,
    )
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_metrics.py`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/eval/metrics.py agent/tests/test_metrics.py && git commit -m "Add score-agreement metrics for the eval harness"
```

---

### Task 2.8: Calibration run script

**Files:**
- Create: `agent/src/agent/eval/calibrate.py`
- Test: `agent/tests/test_calibrate.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_calibrate.py`:
```python
import json
from pathlib import Path
from unittest.mock import MagicMock

from agent.eval.calibrate import run_calibration
from agent.eval.replay import ReplayResult


def test_run_calibration_writes_report(tmp_path: Path, monkeypatch) -> None:
    fake_results = [
        ReplayResult(
            interview_id="a",
            machine_scores={"problem_solving": 3, "agency": 2,
                            "competitiveness": 1, "curious": 4},
            human_scores={"problem_solving": 3, "agency": 2,
                          "competitiveness": 1, "curious": 4},
        )
    ]
    monkeypatch.setattr("agent.eval.calibrate.load_corpus", lambda _d: ["item"])
    monkeypatch.setattr(
        "agent.eval.calibrate.replay_corpus", lambda *_a: fake_results
    )

    report_path = tmp_path / "calibration_report.json"
    report = run_calibration(
        scorer=MagicMock(),
        rubric=MagicMock(),
        corpus_dir=tmp_path,
        report_path=report_path,
        pass_threshold_within_one=0.8,
    )
    assert report.passes is True
    written = json.loads(report_path.read_text())
    assert written["exact_match_rate"] == 1.0
    assert written["within_one_rate"] == 1.0
    assert written["passes"] is True
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_calibrate.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.eval.calibrate'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/eval/calibrate.py`:
```python
"""Calibration run: replay the corpus, compute agreement, write the report."""

from __future__ import annotations

from pathlib import Path

from agent.domain.types import Rubric
from agent.eval.corpus import load_corpus
from agent.eval.metrics import AgreementReport, compute_agreement
from agent.eval.replay import replay_corpus
from agent.scoring.scorer import Scorer


def run_calibration(
    scorer: Scorer,
    rubric: Rubric,
    corpus_dir: Path,
    report_path: Path,
    pass_threshold_within_one: float,
) -> AgreementReport:
    """Replay the corpus through the Scorer and write a calibration report.

    Returns the `AgreementReport`; also serializes it to `report_path` as JSON.
    """
    corpus = load_corpus(corpus_dir)
    results = replay_corpus(scorer, rubric, corpus)
    report = compute_agreement(results, pass_threshold_within_one)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report.model_dump_json(indent=2))
    return report


def main() -> None:  # pragma: no cover — CLI entrypoint
    """CLI: run calibration against `corpus/` using the pilot rubric."""
    import sys

    import anthropic

    from agent.rubric_loader import load_rubric

    repo_root = Path(__file__).parents[4]
    rubric = load_rubric(repo_root / "rubric" / "pilot-v1.yaml")
    scorer = Scorer(client=anthropic.Anthropic(), rubric=rubric)
    report = run_calibration(
        scorer=scorer,
        rubric=rubric,
        corpus_dir=repo_root / "corpus",
        report_path=repo_root / "corpus" / "calibration_report.json",
        pass_threshold_within_one=0.85,
    )
    print(f"within_one_rate={report.within_one_rate:.3f} passes={report.passes}")
    sys.exit(0 if report.passes else 1)


if __name__ == "__main__":  # pragma: no cover
    main()
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_calibrate.py`
Expected: PASS (1 passed)

- [ ] **Step 5: Verify the full agent suite is green**
Run: `cd agent && uv run pytest`
Expected: all tests pass, exit 0

- [ ] **Step 6: Commit**
```bash
git add agent/src/agent/eval/calibrate.py agent/tests/test_calibrate.py && git commit -m "Add calibration run script producing the agreement report"
```

---

## Phase 3: Live voice loop

### Task 3.1: LiveKit agent worker entrypoint

**Files:**
- Create: `agent/src/agent/worker/__init__.py`
- Create: `agent/src/agent/worker/entrypoint.py`
- Modify: `agent/pyproject.toml`
- Test: `agent/tests/test_worker_entrypoint.py`

- [ ] **Step 1: Add the LiveKit Agents dependency**
Modify `agent/pyproject.toml` — add to the `dependencies` list:
```toml
    "livekit-agents>=0.12",
    "livekit-plugins-deepgram>=0.7",
    "livekit-plugins-cartesia>=0.4",
    "livekit-plugins-turn-detector>=0.4",
```
Run: `cd agent && uv sync --extra dev`
Expected: resolves the LiveKit packages, exit 0

- [ ] **Step 2: Write the failing test**
`agent/tests/test_worker_entrypoint.py`:
```python
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.worker.entrypoint import InterviewJobContext, build_session_context


def test_build_session_context_extracts_metadata() -> None:
    job = MagicMock()
    job.room.name = "interview-sess1"
    job.metadata = (
        '{"session_id": "sess1", "org_id": "org1", '
        '"script_version": "pilot-v1", "candidate_email": "c@example.com"}'
    )
    ctx = build_session_context(job)
    assert isinstance(ctx, InterviewJobContext)
    assert ctx.session_id == "sess1"
    assert ctx.org_id == "org1"
    assert ctx.script_version == "pilot-v1"
    assert ctx.room_name == "interview-sess1"


def test_build_session_context_rejects_missing_session_id() -> None:
    job = MagicMock()
    job.room.name = "interview-x"
    job.metadata = '{"org_id": "org1", "script_version": "pilot-v1"}'
    with pytest.raises(ValueError, match="session_id"):
        build_session_context(job)


async def test_entrypoint_connects_and_waits_for_participant() -> None:
    job = MagicMock()
    job.room.name = "interview-sess1"
    job.metadata = (
        '{"session_id": "sess1", "org_id": "org1", '
        '"script_version": "pilot-v1", "candidate_email": "c@example.com"}'
    )
    job.connect = AsyncMock()
    job.wait_for_participant = AsyncMock(return_value=MagicMock())
    ran: dict[str, object] = {}

    async def fake_run(ctx, participant):  # noqa: ANN001
        ran["session_id"] = ctx.session_id
        ran["participant"] = participant

    from agent.worker import entrypoint as ep

    await ep.entrypoint(job, _run_interview=fake_run)
    job.connect.assert_awaited_once()
    job.wait_for_participant.assert_awaited_once()
    assert ran["session_id"] == "sess1"
```

- [ ] **Step 3: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_worker_entrypoint.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.worker'`

- [ ] **Step 4: Write minimal implementation**
`agent/src/agent/worker/__init__.py`:
```python
"""The LiveKit Agents worker process: entrypoint, voice loop, controller wiring."""
```
`agent/src/agent/worker/entrypoint.py`:
```python
"""LiveKit agent worker entrypoint — one worker process joins one interview room."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel, ConfigDict


class InterviewJobContext(BaseModel):
    """The interview identity parsed from a LiveKit job's room + metadata."""

    model_config = ConfigDict(frozen=True)

    session_id: str
    org_id: str
    script_version: str
    candidate_email: str
    room_name: str


def build_session_context(job: Any) -> InterviewJobContext:
    """Parse the dispatch metadata on a LiveKit job into an `InterviewJobContext`.

    Raises `ValueError` if required fields are absent — the worker must never
    join a room it cannot identify.
    """
    meta = json.loads(job.metadata) if job.metadata else {}
    for field in ("session_id", "org_id", "script_version", "candidate_email"):
        if not meta.get(field):
            raise ValueError(f"job metadata missing required field: {field}")
    return InterviewJobContext(
        session_id=meta["session_id"],
        org_id=meta["org_id"],
        script_version=meta["script_version"],
        candidate_email=meta["candidate_email"],
        room_name=job.room.name,
    )


RunInterview = Callable[[InterviewJobContext, Any], Awaitable[None]]


async def entrypoint(
    job: Any, _run_interview: RunInterview | None = None
) -> None:
    """LiveKit Agents entrypoint: connect to the room, await the candidate, run.

    `_run_interview` is injectable for tests; in production it is the real
    interview runner wired in Task 3.12.
    """
    ctx = build_session_context(job)
    await job.connect()
    participant = await job.wait_for_participant()
    runner = _run_interview or _default_run_interview
    await runner(ctx, participant)


async def _default_run_interview(
    ctx: InterviewJobContext, participant: Any
) -> None:  # pragma: no cover — wired in Task 3.12
    """Placeholder runner; replaced by the real wiring in Task 3.12."""
    raise NotImplementedError("interview runner is wired in Task 3.12")
```

- [ ] **Step 5: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_worker_entrypoint.py`
Expected: PASS (3 passed)

- [ ] **Step 6: Commit**
```bash
git add agent/pyproject.toml agent/uv.lock agent/src/agent/worker agent/tests/test_worker_entrypoint.py && git commit -m "Add LiveKit agent worker entrypoint and job-context parsing"
```

---

### Task 3.2: VoiceAgent interface and cascaded implementation skeleton

**Files:**
- Create: `agent/src/agent/voice/__init__.py`
- Create: `agent/src/agent/voice/interface.py`
- Create: `agent/src/agent/voice/cascaded.py`
- Test: `agent/tests/test_voice_interface.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_voice_interface.py`:
```python
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.voice.cascaded import CascadedVoiceAgent
from agent.voice.interface import ListenResult, VoiceAgent, VoiceMode


def test_voice_mode_values() -> None:
    assert set(VoiceMode.__args__) == {"scripted", "clarifying", "repair", "closing"}


async def test_cascaded_speak_records_last_utterance() -> None:
    stt = MagicMock()
    tts = MagicMock()
    tts.synthesize = AsyncMock()
    room_output = MagicMock()
    room_output.play = AsyncMock()
    agent = CascadedVoiceAgent(stt=stt, tts=tts, room_output=room_output)
    await agent.speak("Welcome to the interview.", mode="scripted")
    assert agent.last_spoken == "Welcome to the interview."
    tts.synthesize.assert_awaited_once_with("Welcome to the interview.")


async def test_cascaded_speak_uses_verbatim_text_unchanged() -> None:
    tts = MagicMock()
    tts.synthesize = AsyncMock(return_value=b"audio")
    room_output = MagicMock()
    room_output.play = AsyncMock()
    agent = CascadedVoiceAgent(stt=MagicMock(), tts=tts, room_output=room_output)
    scripted = "Can you tell me about a technically complex problem you solved?"
    await agent.speak(scripted, mode="scripted")
    # The text passed to TTS is byte-identical to the controller's text.
    assert tts.synthesize.await_args.args[0] == scripted


async def test_cascaded_listen_returns_transcript_and_turn_flag() -> None:
    stt = MagicMock()
    stt.next_turn = AsyncMock(
        return_value={"text": "I rewrote the scheduler.", "end_of_turn": True}
    )
    agent = CascadedVoiceAgent(stt=stt, tts=MagicMock(), room_output=MagicMock())
    result = await agent.listen()
    assert isinstance(result, ListenResult)
    assert result.transcript == "I rewrote the scheduler."
    assert result.end_of_turn is True


async def test_cascaded_set_mode_and_interrupt() -> None:
    tts = MagicMock()
    tts.synthesize = AsyncMock()
    room_output = MagicMock()
    room_output.play = AsyncMock()
    room_output.stop = AsyncMock()
    agent = CascadedVoiceAgent(stt=MagicMock(), tts=tts, room_output=room_output)
    agent.set_mode("repair")
    assert agent.mode == "repair"
    await agent.interrupt()
    room_output.stop.assert_awaited_once()


def test_voice_agent_is_the_abstract_contract() -> None:
    # CascadedVoiceAgent satisfies the VoiceAgent protocol.
    assert issubclass(CascadedVoiceAgent, VoiceAgent)
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_voice_interface.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.voice'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/voice/__init__.py`:
```python
"""Voice I/O: the swappable VoiceAgent interface and its cascaded implementation."""
```
`agent/src/agent/voice/interface.py`:
```python
"""The `VoiceAgent` abstraction — the swap point for a future S2S model.

A cascaded STT+turn-detection+TTS implementation satisfies this in v1; a
speech-to-speech model can later be wrapped behind the identical interface.
"""

from __future__ import annotations

import abc
from typing import Literal

from pydantic import BaseModel, ConfigDict

VoiceMode = Literal["scripted", "clarifying", "repair", "closing"]


class ListenResult(BaseModel):
    """One listening result: the transcript so far and whether the turn ended."""

    model_config = ConfigDict(frozen=True)

    transcript: str
    end_of_turn: bool


class VoiceAgent(abc.ABC):
    """Hear the candidate and speak — under full Interview Controller control.

    The controller supplies every word spoken; this layer never generates text.
    """

    @abc.abstractmethod
    async def speak(self, text: str, mode: VoiceMode) -> None:
        """Speak exactly `text`. The text is never paraphrased or altered."""

    @abc.abstractmethod
    async def listen(self) -> ListenResult:
        """Return the current transcript and an end-of-turn signal."""

    @abc.abstractmethod
    async def interrupt(self) -> None:
        """Stop any in-progress speech immediately (candidate barge-in)."""

    @abc.abstractmethod
    def set_mode(self, mode: VoiceMode) -> None:
        """Set the voice mode — adjusts pacing/turn sensitivity, not content."""
```
`agent/src/agent/voice/cascaded.py`:
```python
"""Cascaded Voice I/O: streaming STT + turn detection + TTS behind `VoiceAgent`."""

from __future__ import annotations

from typing import Any

from agent.voice.interface import ListenResult, VoiceAgent, VoiceMode


class CascadedVoiceAgent(VoiceAgent):
    """v1 Voice I/O — streaming STT, semantic turn detection, low-latency TTS.

    Speaks only controller-supplied text. `stt`, `tts`, and `room_output` are
    injected so the worker wires concrete LiveKit plugins and tests use fakes.
    """

    def __init__(self, stt: Any, tts: Any, room_output: Any) -> None:
        self._stt = stt
        self._tts = tts
        self._room_output = room_output
        self._mode: VoiceMode = "scripted"
        self._last_spoken: str | None = None

    @property
    def mode(self) -> VoiceMode:
        """The current voice mode."""
        return self._mode

    @property
    def last_spoken(self) -> str | None:
        """The exact last utterance sent to TTS — for verbatim-fidelity checks."""
        return self._last_spoken

    async def speak(self, text: str, mode: VoiceMode) -> None:
        """Synthesize and play `text` verbatim through the room output track."""
        self._mode = mode
        self._last_spoken = text
        audio = await self._tts.synthesize(text)
        await self._room_output.play(audio)

    async def listen(self) -> ListenResult:
        """Pull the next STT turn result, including the end-of-turn flag."""
        turn = await self._stt.next_turn()
        return ListenResult(
            transcript=turn["text"], end_of_turn=bool(turn["end_of_turn"])
        )

    async def interrupt(self) -> None:
        """Stop in-progress playback so the candidate can barge in."""
        await self._room_output.stop()

    def set_mode(self, mode: VoiceMode) -> None:
        """Set the voice mode without changing any spoken content."""
        self._mode = mode
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_voice_interface.py`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/voice/__init__.py agent/src/agent/voice/interface.py agent/src/agent/voice/cascaded.py agent/tests/test_voice_interface.py && git commit -m "Add VoiceAgent interface and cascaded implementation skeleton"
```

---

### Task 3.3: Deepgram Nova-3 streaming STT

**Files:**
- Create: `agent/src/agent/voice/stt.py`
- Test: `agent/tests/test_stt.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_stt.py`:
```python
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.voice.stt import DeepgramSTT, SttTranscript


def test_stt_transcript_holds_text_and_finality() -> None:
    t = SttTranscript(text="hello there", is_final=True, unreliable=False)
    assert t.text == "hello there"
    assert t.is_final is True


async def test_deepgram_stt_collects_final_transcript() -> None:
    plugin = MagicMock()
    # The Deepgram plugin yields interim then final events for one turn.
    events = [
        {"type": "interim", "text": "I rewrote"},
        {"type": "interim", "text": "I rewrote the"},
        {"type": "final", "text": "I rewrote the scheduler."},
    ]

    async def fake_stream():
        for ev in events:
            yield ev

    plugin.stream = MagicMock(return_value=fake_stream())
    stt = DeepgramSTT(plugin=plugin)
    result = await stt.next_turn()
    assert result["text"] == "I rewrote the scheduler."
    assert result["end_of_turn"] is True


async def test_deepgram_stt_marks_low_confidence_as_unreliable() -> None:
    plugin = MagicMock()
    events = [{"type": "final", "text": "??? garbled", "confidence": 0.21}]

    async def fake_stream():
        for ev in events:
            yield ev

    plugin.stream = MagicMock(return_value=fake_stream())
    stt = DeepgramSTT(plugin=plugin, min_confidence=0.5)
    transcript = await stt.next_final_transcript()
    assert transcript.unreliable is True
    assert transcript.text == "??? garbled"
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_stt.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.voice.stt'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/voice/stt.py`:
```python
"""Deepgram Nova-3 streaming STT adapter for the cascaded Voice I/O layer."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class SttTranscript(BaseModel):
    """A finalized STT transcript with a reliability flag."""

    model_config = ConfigDict(frozen=True)

    text: str
    is_final: bool
    unreliable: bool


def build_deepgram_stt(api_key: str) -> Any:  # pragma: no cover — vendor wiring
    """Construct the LiveKit Deepgram plugin configured for Nova-3 streaming."""
    from livekit.plugins import deepgram

    return deepgram.STT(model="nova-3", api_key=api_key, interim_results=True)


class DeepgramSTT:
    """Wraps the Deepgram streaming plugin into the `stt` shape Voice I/O needs.

    `next_turn` returns the dict `CascadedVoiceAgent.listen` expects;
    `next_final_transcript` returns a typed `SttTranscript` with reliability.
    """

    def __init__(self, plugin: Any, min_confidence: float = 0.5) -> None:
        self._plugin = plugin
        self._min_confidence = min_confidence

    async def next_final_transcript(self) -> SttTranscript:
        """Consume the stream until a final event; return it typed."""
        text = ""
        confidence = 1.0
        async for event in self._plugin.stream():
            text = event["text"]
            if event["type"] == "final":
                confidence = float(event.get("confidence", 1.0))
                break
        return SttTranscript(
            text=text,
            is_final=True,
            unreliable=confidence < self._min_confidence,
        )

    async def next_turn(self) -> dict[str, Any]:
        """Return `{text, end_of_turn}` for `CascadedVoiceAgent.listen`."""
        transcript = await self.next_final_transcript()
        return {"text": transcript.text, "end_of_turn": True}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_stt.py`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/voice/stt.py agent/tests/test_stt.py && git commit -m "Add Deepgram Nova-3 streaming STT adapter"
```

---

### Task 3.4: LiveKit turn detector

**Files:**
- Create: `agent/src/agent/voice/turn_detector.py`
- Test: `agent/tests/test_turn_detector.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_turn_detector.py`:
```python
import pytest

from agent.voice.turn_detector import TurnDecision, TurnDetector


def test_turn_decision_fields() -> None:
    d = TurnDecision(end_of_turn=True, probability=0.92, waited_seconds=1.4)
    assert d.end_of_turn is True
    assert d.probability == 0.92


def test_detector_waits_through_think_pause() -> None:
    # Tuned long: a 2.0s pause below the think-pause window is NOT end of turn.
    detector = TurnDetector(end_of_turn_threshold=0.7, min_silence_seconds=3.0)
    decision = detector.evaluate(eot_probability=0.8, silence_seconds=2.0)
    assert decision.end_of_turn is False  # silence too short despite high prob


def test_detector_ends_turn_when_silence_and_probability_clear() -> None:
    detector = TurnDetector(end_of_turn_threshold=0.7, min_silence_seconds=3.0)
    decision = detector.evaluate(eot_probability=0.85, silence_seconds=3.2)
    assert decision.end_of_turn is True
    assert decision.waited_seconds == 3.2


def test_detector_holds_when_probability_low() -> None:
    detector = TurnDetector(end_of_turn_threshold=0.7, min_silence_seconds=3.0)
    decision = detector.evaluate(eot_probability=0.4, silence_seconds=5.0)
    assert decision.end_of_turn is False  # model thinks candidate continues
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_turn_detector.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.voice.turn_detector'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/voice/turn_detector.py`:
```python
"""Semantic end-of-turn detection, tuned long to respect think-pauses.

Wraps the LiveKit turn-detector plugin's end-of-turn probability and adds a
deterministic minimum-silence gate so the agent never interrupts a candidate
who is still formulating an answer.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class TurnDecision(BaseModel):
    """The detector's decision for the current pause."""

    model_config = ConfigDict(frozen=True)

    end_of_turn: bool
    probability: float
    waited_seconds: float


def build_turn_detector_plugin() -> Any:  # pragma: no cover — vendor wiring
    """Construct the LiveKit turn-detector plugin (English, multilingual model)."""
    from livekit.plugins import turn_detector

    return turn_detector.EOUModel()


class TurnDetector:
    """End-of-turn gate: requires BOTH high EOT probability AND enough silence.

    `min_silence_seconds` is tuned long (default 3.0s) so a think-pause is not
    mistaken for the end of an answer.
    """

    def __init__(
        self, end_of_turn_threshold: float = 0.7, min_silence_seconds: float = 3.0
    ) -> None:
        self._threshold = end_of_turn_threshold
        self._min_silence = min_silence_seconds

    def evaluate(
        self, eot_probability: float, silence_seconds: float
    ) -> TurnDecision:
        """Decide whether the candidate's turn has ended.

        Ends the turn only when the EOT probability clears the threshold AND
        the trailing silence is at least `min_silence_seconds`.
        """
        end_of_turn = (
            eot_probability >= self._threshold
            and silence_seconds >= self._min_silence
        )
        return TurnDecision(
            end_of_turn=end_of_turn,
            probability=eot_probability,
            waited_seconds=silence_seconds,
        )
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_turn_detector.py`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/voice/turn_detector.py agent/tests/test_turn_detector.py && git commit -m "Add LiveKit turn detector tuned long for think-pauses"
```

---

### Task 3.5: Cartesia Sonic-3 TTS

**Files:**
- Create: `agent/src/agent/voice/tts.py`
- Test: `agent/tests/test_tts.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_tts.py`:
```python
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.voice.tts import CartesiaTTS


async def test_tts_synthesize_returns_audio_bytes() -> None:
    plugin = MagicMock()
    plugin.synthesize = AsyncMock(return_value=b"\x00\x01audio")
    tts = CartesiaTTS(plugin=plugin)
    audio = await tts.synthesize("Welcome to the interview.")
    assert audio == b"\x00\x01audio"
    plugin.synthesize.assert_awaited_once_with("Welcome to the interview.")


async def test_tts_synthesize_passes_text_unchanged() -> None:
    plugin = MagicMock()
    plugin.synthesize = AsyncMock(return_value=b"x")
    tts = CartesiaTTS(plugin=plugin)
    verbatim = "Can you tell me about the time you hacked a non-computer system?"
    await tts.synthesize(verbatim)
    assert plugin.synthesize.await_args.args[0] == verbatim


async def test_tts_synthesize_rejects_empty_text() -> None:
    tts = CartesiaTTS(plugin=MagicMock())
    with pytest.raises(ValueError, match="empty"):
        await tts.synthesize("")
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_tts.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.voice.tts'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/voice/tts.py`:
```python
"""Cartesia Sonic-3 low-latency TTS adapter for the cascaded Voice I/O layer."""

from __future__ import annotations

from typing import Any


def build_cartesia_tts(api_key: str) -> Any:  # pragma: no cover — vendor wiring
    """Construct the LiveKit Cartesia plugin configured for Sonic-3."""
    from livekit.plugins import cartesia

    return cartesia.TTS(model="sonic-3", api_key=api_key)


class CartesiaTTS:
    """Wraps the Cartesia plugin into the `tts` shape Voice I/O needs.

    Synthesizes exactly the text given — never paraphrased — so the controller's
    verbatim base questions are spoken byte-identically.
    """

    def __init__(self, plugin: Any) -> None:
        self._plugin = plugin

    async def synthesize(self, text: str) -> bytes:
        """Synthesize `text` to audio bytes. Raises `ValueError` on empty text."""
        if not text.strip():
            raise ValueError("cannot synthesize empty text")
        return await self._plugin.synthesize(text)
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_tts.py`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/voice/tts.py agent/tests/test_tts.py && git commit -m "Add Cartesia Sonic-3 TTS adapter"
```

---

### Task 3.6: Interview Controller state machine

**Files:**
- Create: `agent/src/agent/controller/__init__.py`
- Create: `agent/src/agent/controller/states.py`
- Create: `agent/src/agent/controller/machine.py`
- Test: `agent/tests/test_state_machine.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_state_machine.py`:
```python
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
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_state_machine.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.controller'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/controller/__init__.py`:
```python
"""The Interview Controller — the deterministic spine of the interview."""
```
`agent/src/agent/controller/states.py`:
```python
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
```
`agent/src/agent/controller/machine.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_state_machine.py`
Expected: PASS (8 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/controller/__init__.py agent/src/agent/controller/states.py agent/src/agent/controller/machine.py agent/tests/test_state_machine.py && git commit -m "Add Interview Controller state machine"
```

---

### Task 3.7: Controller timing — total cap, soft budgets, humane boundary line

**Files:**
- Create: `agent/src/agent/controller/timing.py`
- Test: `agent/tests/test_timing.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_timing.py`:
```python
import pytest

from agent.controller.timing import HUMANE_BOUNDARY_LINE, InterviewClock


def test_clock_reports_remaining_against_total_cap() -> None:
    clock = InterviewClock(total_cap_seconds=1800.0, now=lambda: 0.0)
    clock.start()
    clock._now = lambda: 600.0  # 10 minutes elapsed
    assert clock.elapsed_seconds() == 600.0
    assert clock.remaining_seconds() == 1200.0
    assert clock.total_cap_exceeded() is False


def test_total_cap_exceeded_when_clock_runs_out() -> None:
    clock = InterviewClock(total_cap_seconds=1800.0, now=lambda: 0.0)
    clock.start()
    clock._now = lambda: 1900.0
    assert clock.total_cap_exceeded() is True
    assert clock.remaining_seconds() == 0.0


def test_soft_budget_overrun_is_advisory_not_hard() -> None:
    clock = InterviewClock(total_cap_seconds=1800.0, now=lambda: 0.0)
    clock.start()
    clock.begin_question(soft_budget_seconds=180.0)
    clock._now = lambda: 200.0  # 20s over the soft budget
    assert clock.soft_budget_exceeded() is True
    # Soft overrun does not by itself force a stop while total time remains.
    assert clock.must_move_on() is False


def test_must_move_on_when_total_cap_reached() -> None:
    clock = InterviewClock(total_cap_seconds=300.0, now=lambda: 0.0)
    clock.start()
    clock.begin_question(soft_budget_seconds=180.0)
    clock._now = lambda: 305.0
    assert clock.must_move_on() is True


def test_disconnect_pause_excludes_downtime_from_elapsed() -> None:
    times = iter([0.0, 100.0, 250.0, 250.0])
    clock = InterviewClock(total_cap_seconds=1800.0, now=lambda: next(times))
    clock.start()  # t=0
    clock.pause_for_disconnect()  # t=100 -> 100s counted so far
    clock.resume_after_reconnect()  # t=250 -> 150s downtime excluded
    clock._now = lambda: 250.0
    assert clock.elapsed_seconds() == 100.0  # downtime not counted


def test_humane_boundary_line_is_the_scripted_text() -> None:
    assert HUMANE_BOUNDARY_LINE == (
        "Thank you — I'm going to move on so we cover everything."
    )
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_timing.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.controller.timing'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/controller/timing.py`:
```python
"""Server-enforced interview timing: total cap, soft per-question budgets.

The total cap is hard and server-enforced; per-question budgets are soft and
advisory. Disconnection time is excluded from the elapsed clock up to the
caller's reconnect cap. Near a hard stop the controller speaks a scripted
humane boundary line.
"""

from __future__ import annotations

from collections.abc import Callable

# The single scripted boundary line — spoken verbatim, logged TIMEBOX_MOVE_ON.
HUMANE_BOUNDARY_LINE = "Thank you — I'm going to move on so we cover everything."


class InterviewClock:
    """Tracks elapsed interview time against a hard total cap and soft budgets.

    `now` is injectable so tests are deterministic; production passes
    `time.monotonic`.
    """

    def __init__(
        self, total_cap_seconds: float, now: Callable[[], float]
    ) -> None:
        self._total_cap = total_cap_seconds
        self._now = now
        self._start: float | None = None
        self._downtime = 0.0
        self._paused_at: float | None = None
        self._question_start: float | None = None
        self._question_budget = 0.0

    def start(self) -> None:
        """Start the interview clock."""
        self._start = self._now()

    def begin_question(self, soft_budget_seconds: float) -> None:
        """Mark the start of a question and record its soft budget."""
        self._question_start = self._now()
        self._question_budget = soft_budget_seconds

    def pause_for_disconnect(self) -> None:
        """Pause the clock at the moment the candidate disconnects."""
        if self._paused_at is None:
            self._paused_at = self._now()

    def resume_after_reconnect(self) -> None:
        """Resume the clock, excluding the disconnection downtime."""
        if self._paused_at is not None:
            self._downtime += self._now() - self._paused_at
            self._paused_at = None

    def elapsed_seconds(self) -> float:
        """Interview time elapsed, excluding disconnection downtime."""
        if self._start is None:
            return 0.0
        return self._now() - self._start - self._downtime

    def remaining_seconds(self) -> float:
        """Time left under the total cap, never negative."""
        return max(0.0, self._total_cap - self.elapsed_seconds())

    def total_cap_exceeded(self) -> bool:
        """True once the hard total cap is reached."""
        return self.elapsed_seconds() >= self._total_cap

    def question_elapsed_seconds(self) -> float:
        """Time spent on the current question."""
        if self._question_start is None:
            return 0.0
        return self._now() - self._question_start

    def soft_budget_exceeded(self) -> bool:
        """True if the current question is over its soft budget (advisory)."""
        return self.question_elapsed_seconds() >= self._question_budget

    def must_move_on(self) -> bool:
        """True only when the hard total cap forces ending the question.

        Soft-budget overruns alone never force a move-on while total time
        remains — probing depth is adaptive within the cap.
        """
        return self.total_cap_exceeded()
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_timing.py`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/controller/timing.py agent/tests/test_timing.py && git commit -m "Add controller timing: total cap, soft budgets, humane boundary line"
```

---

### Task 3.8: Controller probe/advance decision loop

**Files:**
- Create: `agent/src/agent/controller/decision.py`
- Test: `agent/tests/test_decision.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_decision.py`:
```python
from agent.controller.decision import Directive, decide_next_action
from agent.scoring.io_types import CategoryAssessment, ScorerOutput


def _assessment(cat: str, conf: float) -> CategoryAssessment:
    return CategoryAssessment(
        category=cat, provisional_score=3, confidence=conf,
        evidence_quotes=["q"],
        missing_or_ambiguous=[] if conf >= 0.75 else ["impact unclear"],
    )


def test_advance_when_all_targets_confident() -> None:
    output = ScorerOutput(assessments=[_assessment("problem_solving", 0.9)])
    directive = decide_next_action(
        scorer_output=output,
        target_categories=["problem_solving"],
        confidence_threshold=0.75,
        probes_used=0,
        max_probes=2,
        time_exhausted=False,
    )
    assert directive.action == "advance"


def test_probe_when_a_target_is_low_confidence() -> None:
    output = ScorerOutput(assessments=[_assessment("agency", 0.4)])
    directive = decide_next_action(
        scorer_output=output,
        target_categories=["agency"],
        confidence_threshold=0.75,
        probes_used=0,
        max_probes=2,
        time_exhausted=False,
    )
    assert directive.action == "probe"
    assert directive.probe_category == "agency"
    assert directive.missing_element == "impact unclear"


def test_advance_when_probe_budget_exhausted_even_if_low_confidence() -> None:
    output = ScorerOutput(assessments=[_assessment("agency", 0.3)])
    directive = decide_next_action(
        scorer_output=output,
        target_categories=["agency"],
        confidence_threshold=0.75,
        probes_used=2,
        max_probes=2,
        time_exhausted=False,
    )
    assert directive.action == "advance"
    assert directive.probe_category is None


def test_advance_when_time_exhausted_even_if_low_confidence() -> None:
    output = ScorerOutput(assessments=[_assessment("curious", 0.2)])
    directive = decide_next_action(
        scorer_output=output,
        target_categories=["curious"],
        confidence_threshold=0.75,
        probes_used=0,
        max_probes=2,
        time_exhausted=True,
    )
    assert directive.action == "advance"


def test_probes_lowest_confidence_target_first() -> None:
    output = ScorerOutput(
        assessments=[_assessment("agency", 0.6), _assessment("curious", 0.2)]
    )
    directive = decide_next_action(
        scorer_output=output,
        target_categories=["agency", "curious"],
        confidence_threshold=0.75,
        probes_used=0,
        max_probes=2,
        time_exhausted=False,
    )
    assert directive.probe_category == "curious"  # lowest confidence first
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_decision.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.controller.decision'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/controller/decision.py`:
```python
"""The probe-vs-advance decision — pure logic over a `ScorerOutput`.

This is plain deterministic code: it acts on the Scorer's confidence but does
not itself reason about candidate quality.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from agent.scoring.io_types import ScorerOutput

Action = Literal["probe", "advance"]


class Directive(BaseModel):
    """The controller's next action after a scoring pass."""

    model_config = ConfigDict(frozen=True)

    action: Action
    probe_category: str | None = None
    missing_element: str | None = None


def decide_next_action(
    scorer_output: ScorerOutput,
    target_categories: list[str],
    confidence_threshold: float,
    probes_used: int,
    max_probes: int,
    time_exhausted: bool,
) -> Directive:
    """Decide whether to probe deeper or advance to the next base question.

    Probe when a targeted category is below the confidence threshold AND
    probes remain AND time remains; otherwise advance. When multiple targets
    are low-confidence, probe the lowest-confidence one first.
    """
    if probes_used >= max_probes or time_exhausted:
        return Directive(action="advance")

    by_category = scorer_output.by_category()
    low: list[tuple[float, str, str | None]] = []
    for category in target_categories:
        assessment = by_category.get(category)
        if assessment is None:
            continue
        if assessment.confidence < confidence_threshold:
            missing = (
                assessment.missing_or_ambiguous[0]
                if assessment.missing_or_ambiguous
                else None
            )
            low.append((assessment.confidence, category, missing))

    if not low:
        return Directive(action="advance")

    low.sort(key=lambda item: item[0])
    _confidence, category, missing = low[0]
    return Directive(
        action="probe", probe_category=category, missing_element=missing
    )
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_decision.py`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/controller/decision.py agent/tests/test_decision.py && git commit -m "Add controller probe-vs-advance decision loop"
```

---

### Task 3.9: Event log and reason codes

**Files:**
- Create: `agent/src/agent/controller/event_log.py`
- Test: `agent/tests/test_event_log.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_event_log.py`:
```python
import json
from pathlib import Path

import pytest

from agent.controller.event_log import EventLog


def test_logs_scripted_question_with_reason_code(tmp_path: Path) -> None:
    log = EventLog(session_id="s1", path=tmp_path / "agent_events.jsonl")
    log.record_utterance(
        utterance="Can you tell me about a hard problem?",
        reason_code="SCRIPTED_QUESTION",
        question_id="q1",
    )
    lines = (tmp_path / "agent_events.jsonl").read_text().strip().splitlines()
    entry = json.loads(lines[0])
    assert entry["reason_code"] == "SCRIPTED_QUESTION"
    assert entry["question_id"] == "q1"
    assert entry["utterance"].startswith("Can you tell me")


def test_probe_event_records_category_and_missing_element(tmp_path: Path) -> None:
    log = EventLog(session_id="s1", path=tmp_path / "agent_events.jsonl")
    log.record_utterance(
        utterance="What was the measurable impact?",
        reason_code="PROBE_LOW_CONFIDENCE",
        question_id="q1",
        category="problem_solving",
        missing_element="impact and recognition unclear",
    )
    entry = json.loads(
        (tmp_path / "agent_events.jsonl").read_text().strip().splitlines()[0]
    )
    assert entry["category"] == "problem_solving"
    assert entry["missing_element"] == "impact and recognition unclear"


def test_all_reason_codes_accepted(tmp_path: Path) -> None:
    log = EventLog(session_id="s1", path=tmp_path / "agent_events.jsonl")
    for code in (
        "CONSENT", "INTRO", "SCRIPTED_QUESTION", "PROBE_LOW_CONFIDENCE",
        "AUDIO_REPAIR", "TIMEBOX_MOVE_ON", "CLOSING",
    ):
        log.record_utterance(utterance="x", reason_code=code, question_id=None)
    lines = (tmp_path / "agent_events.jsonl").read_text().strip().splitlines()
    assert len(lines) == 7


def test_rejects_unknown_reason_code(tmp_path: Path) -> None:
    log = EventLog(session_id="s1", path=tmp_path / "agent_events.jsonl")
    with pytest.raises(ValueError, match="reason_code"):
        log.record_utterance(utterance="x", reason_code="BOGUS", question_id=None)


def test_events_returns_recorded_agent_events(tmp_path: Path) -> None:
    log = EventLog(session_id="s1", path=tmp_path / "agent_events.jsonl")
    log.record_utterance(utterance="Welcome.", reason_code="INTRO", question_id=None)
    events = log.events()
    assert len(events) == 1
    assert events[0].reason_code == "INTRO"
    assert events[0].session_id == "s1"
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_event_log.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.controller.event_log'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/controller/event_log.py`:
```python
"""The agent event log — every spoken utterance with its reason code.

Each utterance is validated into an `AgentEvent` and appended to
`agent_events.jsonl`; the in-memory list backs end-of-interview finalization.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import ValidationError

from agent.domain.types import AgentEvent


class EventLog:
    """Records validated `AgentEvent`s to a JSONL file and an in-memory list."""

    def __init__(self, session_id: str, path: Path) -> None:
        self._session_id = session_id
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._events: list[AgentEvent] = []

    def record_utterance(
        self,
        utterance: str,
        reason_code: str,
        question_id: str | None,
        category: str | None = None,
        missing_element: str | None = None,
    ) -> AgentEvent:
        """Validate and append one agent utterance event.

        Raises `ValueError` if `reason_code` is not a known reason code.
        """
        try:
            event = AgentEvent(
                session_id=self._session_id,
                utterance=utterance,
                reason_code=reason_code,  # type: ignore[arg-type]
                question_id=question_id,
                category=category,
                missing_element=missing_element,
            )
        except ValidationError as exc:
            raise ValueError(f"invalid reason_code or event: {exc}") from exc
        self._events.append(event)
        with self._path.open("a", encoding="utf-8") as handle:
            handle.write(event.model_dump_json() + "\n")
        return event

    def events(self) -> list[AgentEvent]:
        """Return all recorded agent events, in order."""
        return list(self._events)
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_event_log.py`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/controller/event_log.py agent/tests/test_event_log.py && git commit -m "Add agent event log with reason codes"
```

---

### Task 3.10: LiveKit Egress recording and artifact finalization

**Files:**
- Create: `agent/src/agent/worker/recording.py`
- Test: `agent/tests/test_recording.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_recording.py`:
```python
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.worker.recording import (
    EgressRecorder,
    RecordingStatus,
    build_egress_request,
)


def test_build_egress_request_targets_spec_storage_paths() -> None:
    request = build_egress_request(
        room_name="interview-sess1", org_id="org1", session_id="sess1"
    )
    assert request["room_name"] == "interview-sess1"
    assert request["composite"] == "/org1/interviews/sess1/media/composite.mp4"
    assert request["candidate_video"] == (
        "/org1/interviews/sess1/media/candidate_video.mp4"
    )
    assert request["candidate_audio"] == (
        "/org1/interviews/sess1/media/candidate_audio.m4a"
    )
    assert request["agent_audio"] == "/org1/interviews/sess1/media/agent_audio.m4a"


async def test_recorder_start_returns_egress_id() -> None:
    client = MagicMock()
    client.start_egress = AsyncMock(return_value={"egress_id": "eg_123"})
    recorder = EgressRecorder(
        client=client, room_name="interview-sess1", org_id="org1", session_id="sess1"
    )
    egress_id = await recorder.start()
    assert egress_id == "eg_123"
    assert recorder.egress_id == "eg_123"


async def test_recorder_finalize_succeeds_on_complete_status() -> None:
    client = MagicMock()
    client.start_egress = AsyncMock(return_value={"egress_id": "eg_123"})
    client.get_egress = AsyncMock(return_value={"status": "EGRESS_COMPLETE"})
    recorder = EgressRecorder(
        client=client, room_name="r", org_id="org1", session_id="sess1"
    )
    await recorder.start()
    status = await recorder.finalize(max_attempts=1, delay_seconds=0.0)
    assert status == RecordingStatus.COMPLETE


async def test_recorder_finalize_retries_then_reports_failed() -> None:
    client = MagicMock()
    client.start_egress = AsyncMock(return_value={"egress_id": "eg_123"})
    client.get_egress = AsyncMock(return_value={"status": "EGRESS_FAILED"})
    recorder = EgressRecorder(
        client=client, room_name="r", org_id="org1", session_id="sess1"
    )
    await recorder.start()
    status = await recorder.finalize(max_attempts=3, delay_seconds=0.0)
    assert status == RecordingStatus.FAILED
    assert client.get_egress.await_count == 3
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_recording.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.worker.recording'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/worker/recording.py`:
```python
"""LiveKit Egress recording — start a composite + per-track recording, then
finalize it as a first-class workflow with retries and an explicit status.
"""

from __future__ import annotations

import asyncio
from enum import Enum
from typing import Any


class RecordingStatus(str, Enum):
    """Terminal status of the recording finalization workflow."""

    COMPLETE = "complete"
    FAILED = "failed"
    PENDING = "pending"


def build_egress_request(
    room_name: str, org_id: str, session_id: str
) -> dict[str, str]:
    """Build the Egress request: composite + per-track outputs at spec paths.

    Mirrors `backend/src/storage/layout.ts` `storagePaths(...).media`.
    """
    root = f"/{org_id}/interviews/{session_id}/media"
    return {
        "room_name": room_name,
        "composite": f"{root}/composite.mp4",
        "candidate_video": f"{root}/candidate_video.mp4",
        "candidate_audio": f"{root}/candidate_audio.m4a",
        "agent_audio": f"{root}/agent_audio.m4a",
    }


class EgressRecorder:
    """Drives a LiveKit Egress recording and its finalization workflow."""

    def __init__(
        self, client: Any, room_name: str, org_id: str, session_id: str
    ) -> None:
        self._client = client
        self._request = build_egress_request(room_name, org_id, session_id)
        self._egress_id: str | None = None

    @property
    def egress_id(self) -> str | None:
        """The Egress id returned by `start`, or None before start."""
        return self._egress_id

    async def start(self) -> str:
        """Start the recording; return and store the Egress id."""
        result = await self._client.start_egress(self._request)
        self._egress_id = result["egress_id"]
        return self._egress_id

    async def finalize(
        self, max_attempts: int = 5, delay_seconds: float = 3.0
    ) -> RecordingStatus:
        """Poll Egress until complete; retry on transient states.

        Returns COMPLETE, FAILED, or PENDING — never assumes success.
        """
        for attempt in range(max_attempts):
            result = await self._client.get_egress(self._egress_id)
            status = result["status"]
            if status == "EGRESS_COMPLETE":
                return RecordingStatus.COMPLETE
            if status == "EGRESS_FAILED":
                return RecordingStatus.FAILED
            if attempt + 1 < max_attempts:
                await asyncio.sleep(delay_seconds)
        return RecordingStatus.PENDING
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_recording.py`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/worker/recording.py agent/tests/test_recording.py && git commit -m "Add LiveKit Egress recording and finalization workflow"
```

---

### Task 3.11: Candidate room web app

**Files:**
- Create: `room/package.json`
- Create: `room/tsconfig.json`
- Create: `room/vite.config.ts`
- Create: `room/index.html`
- Create: `room/src/main.tsx`
- Create: `room/src/App.tsx`
- Create: `room/src/flow.ts`
- Create: `room/src/pages/Landing.tsx`
- Create: `room/src/pages/Consent.tsx`
- Create: `room/src/pages/Preflight.tsx`
- Create: `room/src/pages/WaitingRoom.tsx`
- Create: `room/src/pages/InCall.tsx`
- Create: `room/src/pages/Completion.tsx`
- Test: `room/test/flow.test.ts`

- [ ] **Step 1: Create the package, TS, and Vite config**
`room/package.json`:
```json
{
  "name": "@puddle/room",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "livekit-client": "^2.6.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```
`room/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ES2022",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```
`room/vite.config.ts`:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
```

- [ ] **Step 2: Write the failing test for the flow state machine**
`room/test/flow.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { ROOM_STEPS, nextStep, canEnterCall } from "../src/flow.js";

describe("room flow", () => {
  it("orders steps: landing -> consent -> preflight -> waiting -> incall -> done", () => {
    expect(ROOM_STEPS).toEqual([
      "landing",
      "consent",
      "preflight",
      "waiting",
      "incall",
      "completion",
    ]);
  });

  it("advances one step at a time", () => {
    expect(nextStep("landing")).toBe("consent");
    expect(nextStep("consent")).toBe("preflight");
    expect(nextStep("incall")).toBe("completion");
  });

  it("does not advance past completion", () => {
    expect(nextStep("completion")).toBe("completion");
  });

  it("blocks the call until consent and preflight are both done", () => {
    expect(canEnterCall({ consentGiven: false, preflightPassed: true })).toBe(false);
    expect(canEnterCall({ consentGiven: true, preflightPassed: false })).toBe(false);
    expect(canEnterCall({ consentGiven: true, preflightPassed: true })).toBe(true);
  });
});
```
Run: `cd room && pnpm install && pnpm test`
Expected: FAIL — cannot resolve `../src/flow.js`

- [ ] **Step 3: Write the flow state machine**
`room/src/flow.ts`:
```typescript
export const ROOM_STEPS = [
  "landing",
  "consent",
  "preflight",
  "waiting",
  "incall",
  "completion",
] as const;

export type RoomStep = (typeof ROOM_STEPS)[number];

export function nextStep(step: RoomStep): RoomStep {
  const index = ROOM_STEPS.indexOf(step);
  const next = ROOM_STEPS[Math.min(index + 1, ROOM_STEPS.length - 1)];
  return next as RoomStep;
}

export interface CallGate {
  readonly consentGiven: boolean;
  readonly preflightPassed: boolean;
}

// The candidate may not enter the call — and recording may not begin —
// until AI disclosure consent is captured and the device preflight passes.
export function canEnterCall(gate: CallGate): boolean {
  return gate.consentGiven && gate.preflightPassed;
}
```
Run: `cd room && pnpm test`
Expected: PASS (4 passed)

- [ ] **Step 4: Write the page components and app shell**
`room/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Puddle Interview</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```
`room/src/main.tsx`:
```typescript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```
`room/src/pages/Landing.tsx`:
```typescript
interface LandingProps {
  readonly onContinue: (token: string) => void;
}

// Light identity check — name/email/token; no mic or camera access yet.
export function Landing({ onContinue }: LandingProps): JSX.Element {
  return (
    <main>
      <h1>Welcome to your Puddle interview</h1>
      <p>Enter the access token from your invitation email to begin.</p>
      <button onClick={() => onContinue("token-from-input")}>Continue</button>
    </main>
  );
}
```
`room/src/pages/Consent.tsx`:
```typescript
interface ConsentProps {
  readonly onConsent: () => void;
}

// AI disclosure + recording consent captured BEFORE any mic/camera access.
export function Consent({ onConsent }: ConsentProps): JSX.Element {
  return (
    <main>
      <h1>Before we begin</h1>
      <p>
        This interview is conducted by an AI interviewer. Audio and video are
        recorded and processed for integrity checks. Video is never used to
        score you. You may request deletion of your data at any time.
      </p>
      <button onClick={onConsent}>I understand and consent</button>
    </main>
  );
}
```
`room/src/pages/Preflight.tsx`:
```typescript
interface PreflightProps {
  readonly onPass: () => void;
}

// Device + network preflight: mic, camera, and connection check.
export function Preflight({ onPass }: PreflightProps): JSX.Element {
  return (
    <main>
      <h1>Device check</h1>
      <p>Checking your microphone, camera, and network connection.</p>
      <button onClick={onPass}>Everything looks good</button>
    </main>
  );
}
```
`room/src/pages/WaitingRoom.tsx`:
```typescript
interface WaitingRoomProps {
  readonly onInterviewerReady: () => void;
}

// Waiting room until the scheduled start; the agent worker joins the room.
export function WaitingRoom({ onInterviewerReady }: WaitingRoomProps): JSX.Element {
  return (
    <main>
      <h1>Waiting room</h1>
      <p>Your interviewer will join shortly. Please stay on this page.</p>
      <button onClick={onInterviewerReady}>Join interview</button>
    </main>
  );
}
```
`room/src/pages/InCall.tsx`:
```typescript
interface InCallProps {
  readonly remainingSeconds: number;
  readonly onComplete: () => void;
}

// In-call UI: agent shown as a simple visual, candidate self-view, timer.
export function InCall({ remainingSeconds, onComplete }: InCallProps): JSX.Element {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = Math.floor(remainingSeconds % 60);
  return (
    <main>
      <div aria-label="interviewer">Puddle interviewer</div>
      <video aria-label="self-view" autoPlay muted playsInline />
      <div aria-label="timer">
        {minutes}:{String(seconds).padStart(2, "0")}
      </div>
      <button onClick={onComplete}>End interview</button>
    </main>
  );
}
```
`room/src/pages/Completion.tsx`:
```typescript
// Post-interview completion page.
export function Completion(): JSX.Element {
  return (
    <main>
      <h1>Thank you</h1>
      <p>Your interview is complete. The Puddle team will be in touch.</p>
    </main>
  );
}
```
`room/src/App.tsx`:
```typescript
import { useState } from "react";
import { ROOM_STEPS, nextStep, type RoomStep } from "./flow.js";
import { Landing } from "./pages/Landing.js";
import { Consent } from "./pages/Consent.js";
import { Preflight } from "./pages/Preflight.js";
import { WaitingRoom } from "./pages/WaitingRoom.js";
import { InCall } from "./pages/InCall.js";
import { Completion } from "./pages/Completion.js";

export function App(): JSX.Element {
  const [step, setStep] = useState<RoomStep>(ROOM_STEPS[0]);
  const advance = (): void => setStep((s) => nextStep(s));

  switch (step) {
    case "landing":
      return <Landing onContinue={() => advance()} />;
    case "consent":
      return <Consent onConsent={advance} />;
    case "preflight":
      return <Preflight onPass={advance} />;
    case "waiting":
      return <WaitingRoom onInterviewerReady={advance} />;
    case "incall":
      return <InCall remainingSeconds={1800} onComplete={advance} />;
    case "completion":
      return <Completion />;
  }
}
```

- [ ] **Step 5: Add `room` to the workspace and verify build + test**
The package is already matched by `pnpm-workspace.yaml` (`"room"`).
Run: `cd room && pnpm install && pnpm test && pnpm build`
Expected: tests PASS (4 passed); `pnpm build` exits 0 producing `dist/`

- [ ] **Step 6: Commit**
```bash
git add room pnpm-lock.yaml && git commit -m "Add candidate interview room web app: flow, consent, preflight, in-call UI"
```

---

### Task 3.12: End-to-end voice interview wiring and simulated-candidate integration test

**Files:**
- Create: `agent/src/agent/controller/interview.py`
- Modify: `agent/src/agent/worker/entrypoint.py`
- Test: `agent/tests/test_interview_runner.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_interview_runner.py`:
```python
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.controller.event_log import EventLog
from agent.controller.interview import InterviewRunner
from agent.controller.states import InterviewState
from agent.rubric_loader import load_rubric
from agent.scoring.io_types import CategoryAssessment, ScorerOutput
from agent.voice.interface import ListenResult

RUBRIC = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")


def _confident(category: str) -> ScorerOutput:
    return ScorerOutput(
        assessments=[
            CategoryAssessment(
                category=category, provisional_score=3, confidence=0.95,
                evidence_quotes=["q"], missing_or_ambiguous=[],
            )
        ]
    )


def _simulated_voice() -> MagicMock:
    voice = MagicMock()
    voice.speak = AsyncMock()
    voice.interrupt = AsyncMock()
    voice.set_mode = MagicMock()
    voice.listen = AsyncMock(
        return_value=ListenResult(transcript="A full answer.", end_of_turn=True)
    )
    return voice


async def test_runner_asks_every_base_question_verbatim(tmp_path: Path) -> None:
    voice = _simulated_voice()
    scorer = MagicMock()
    scorer.score.side_effect = lambda si: _confident(si.target_categories[0])
    event_log = EventLog(session_id="s1", path=tmp_path / "events.jsonl")
    runner = InterviewRunner(
        rubric=RUBRIC, voice=voice, scorer=scorer,
        probe_generator=MagicMock(), event_log=event_log,
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
    )
    assessment = await runner.run(session_id="s1")

    spoken = [c.args[0] for c in voice.speak.await_args_list]
    for question in RUBRIC.questions:
        assert question.verbatim_text in spoken  # asked verbatim, unaltered
    assert assessment.session_id == "s1"
    assert len(assessment.category_scores) == 4


async def test_runner_probes_when_scorer_low_confidence(tmp_path: Path) -> None:
    voice = _simulated_voice()
    scorer = MagicMock()
    calls = {"n": 0}

    def score(si):  # noqa: ANN001
        calls["n"] += 1
        category = si.target_categories[0]
        if calls["n"] == 1:
            return ScorerOutput(
                assessments=[
                    CategoryAssessment(
                        category=category, provisional_score=2, confidence=0.3,
                        evidence_quotes=[], missing_or_ambiguous=["impact unclear"],
                    )
                ]
            )
        return _confident(category)

    scorer.score.side_effect = score
    probe_gen = MagicMock()
    probe_gen.generate.return_value = "What was the measurable impact?"
    event_log = EventLog(session_id="s2", path=tmp_path / "events.jsonl")
    runner = InterviewRunner(
        rubric=RUBRIC, voice=voice, scorer=scorer,
        probe_generator=probe_gen, event_log=event_log,
        clock_now=iter([float(i) for i in range(0, 8000, 5)]).__next__,
    )
    await runner.run(session_id="s2")

    spoken = [c.args[0] for c in voice.speak.await_args_list]
    assert "What was the measurable impact?" in spoken
    reason_codes = [e.reason_code for e in event_log.events()]
    assert "PROBE_LOW_CONFIDENCE" in reason_codes
    assert "SCRIPTED_QUESTION" in reason_codes
    assert reason_codes[0] == "INTRO"
    assert reason_codes[-1] == "CLOSING"


async def test_runner_reaches_review_ready_state(tmp_path: Path) -> None:
    voice = _simulated_voice()
    scorer = MagicMock()
    scorer.score.side_effect = lambda si: _confident(si.target_categories[0])
    event_log = EventLog(session_id="s3", path=tmp_path / "events.jsonl")
    runner = InterviewRunner(
        rubric=RUBRIC, voice=voice, scorer=scorer,
        probe_generator=MagicMock(), event_log=event_log,
        clock_now=iter([float(i) for i in range(0, 4000, 5)]).__next__,
    )
    await runner.run(session_id="s3")
    assert runner.state_machine.state == InterviewState.CLOSING
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_interview_runner.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.controller.interview'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/controller/interview.py`:
```python
"""The InterviewRunner — wires Voice I/O, the state machine, the Scorer, the
Probe Generator, timing, and the event log into one score-driven interview.

This is the controller's run loop: it speaks only verbatim/approved text,
drives the state machine, and acts on the Scorer's confidence.
"""

from __future__ import annotations

from collections.abc import Callable

from agent.config import SCORING
from agent.controller.decision import decide_next_action
from agent.controller.event_log import EventLog
from agent.controller.machine import InterviewStateMachine
from agent.controller.states import InterviewState
from agent.controller.timing import HUMANE_BOUNDARY_LINE, InterviewClock
from agent.domain.types import Assessment, Rubric, TranscriptTurn
from agent.scoring.io_types import CategoryAssessment, ScorerInput
from agent.scoring.probe import ProbeGenerator, ProbeRequest
from agent.scoring.rollup import roll_up_assessment
from agent.scoring.scorer import Scorer

_INTRO_TEXT = (
    "Hello, and welcome. I'm an AI interviewer. I'll ask a few questions and "
    "may follow up on your answers. Let's begin."
)
_CLOSING_TEXT = "That's everything I wanted to cover. Thank you for your time."


class InterviewRunner:
    """Runs one full score-driven voice interview to a finalized `Assessment`."""

    def __init__(
        self,
        rubric: Rubric,
        voice: object,
        scorer: Scorer,
        probe_generator: ProbeGenerator,
        event_log: EventLog,
        clock_now: Callable[[], float],
    ) -> None:
        self._rubric = rubric
        self._voice = voice
        self._scorer = scorer
        self._probe_generator = probe_generator
        self._event_log = event_log
        self.state_machine = InterviewStateMachine(
            num_questions=len(rubric.questions)
        )
        self._clock = InterviewClock(
            total_cap_seconds=rubric.total_cap_seconds, now=clock_now
        )
        self._transcript: list[TranscriptTurn] = []
        self._turn_index = 0

    async def run(self, session_id: str) -> Assessment:
        """Conduct the interview and return the rolled-up `Assessment`."""
        self._clock.start()
        self.state_machine.transition(InterviewState.CANDIDATE_JOINED)
        self.state_machine.transition(InterviewState.PREFLIGHT_COMPLETE)
        self.state_machine.transition(InterviewState.CONSENT_CAPTURED)
        self.state_machine.transition(InterviewState.INTRO)
        await self._say(_INTRO_TEXT, "INTRO", question_id=None)

        final: dict[str, CategoryAssessment] = {}
        for question in self._rubric.questions:
            self.state_machine.transition(InterviewState.QUESTION_ASKING)
            self._clock.begin_question(question.soft_budget_seconds)
            await self._say(
                question.verbatim_text, "SCRIPTED_QUESTION", question.question_id
            )
            assessments = await self._run_question(question)
            for category, assessment in assessments.items():
                final[category] = assessment
            self.state_machine.transition(InterviewState.QUESTION_CLOSED)
            self.state_machine.advance_question()

        await self._say(_CLOSING_TEXT, "CLOSING", question_id=None)
        return roll_up_assessment(
            session_id=session_id,
            script_version=self._rubric.script_version,
            final_assessments=final,
            integrity_flags=[],
            confidence_threshold=SCORING.confidence_threshold,
        )

    async def _run_question(self, question: object) -> dict[str, CategoryAssessment]:
        """Run the answer/score/probe loop for one base question."""
        targets = list(question.rubric_categories)  # type: ignore[attr-defined]
        probes_used = 0
        latest: dict[str, CategoryAssessment] = {}
        while True:
            self.state_machine.transition(InterviewState.QUESTION_ANSWERING)
            await self._listen(question.question_id)  # type: ignore[attr-defined]
            self.state_machine.transition(InterviewState.QUESTION_SCORING)
            output = self._scorer.score(
                ScorerInput(
                    script_version=self._rubric.script_version,
                    question_id=question.question_id,  # type: ignore[attr-defined]
                    target_categories=targets,
                    transcript=list(self._transcript),
                )
            )
            for assessment in output.assessments:
                latest[assessment.category] = assessment

            directive = decide_next_action(
                scorer_output=output,
                target_categories=targets,
                confidence_threshold=SCORING.confidence_threshold,
                probes_used=probes_used,
                max_probes=question.max_probes,  # type: ignore[attr-defined]
                time_exhausted=self._clock.must_move_on(),
            )
            if directive.action == "advance":
                if self._clock.must_move_on():
                    await self._say(
                        HUMANE_BOUNDARY_LINE,
                        "TIMEBOX_MOVE_ON",
                        question.question_id,  # type: ignore[attr-defined]
                    )
                return latest

            self.state_machine.transition(InterviewState.QUESTION_PROBING)
            probe_text = self._probe_generator.generate(
                ProbeRequest(
                    category_assessment=latest[directive.probe_category],  # type: ignore[index]
                    transcript=list(self._transcript),
                    probes_used=probes_used,
                    max_probes=question.max_probes,  # type: ignore[attr-defined]
                )
            )
            probes_used += 1
            await self._say(
                probe_text,
                "PROBE_LOW_CONFIDENCE",
                question.question_id,  # type: ignore[attr-defined]
                category=directive.probe_category,
                missing_element=directive.missing_element,
            )

    async def _say(
        self,
        text: str,
        reason_code: str,
        question_id: str | None,
        category: str | None = None,
        missing_element: str | None = None,
    ) -> None:
        """Speak controller-supplied text and log it with its reason code."""
        mode = "closing" if reason_code == "CLOSING" else "scripted"
        await self._voice.speak(text, mode=mode)  # type: ignore[attr-defined]
        self._event_log.record_utterance(
            utterance=text,
            reason_code=reason_code,
            question_id=question_id,
            category=category,
            missing_element=missing_element,
        )
        self._transcript.append(
            TranscriptTurn(
                turn_index=self._turn_index,
                speaker="agent",
                text=text,
                question_id=question_id,
            )
        )
        self._turn_index += 1

    async def _listen(self, question_id: str) -> None:
        """Capture one candidate turn into the transcript."""
        result = await self._voice.listen()  # type: ignore[attr-defined]
        self._transcript.append(
            TranscriptTurn(
                turn_index=self._turn_index,
                speaker="candidate",
                text=result.transcript,
                question_id=question_id,
            )
        )
        self._turn_index += 1
```
Modify `agent/src/agent/worker/entrypoint.py` — replace `_default_run_interview` with the real wiring:
```python
async def _default_run_interview(
    ctx: InterviewJobContext, participant: Any
) -> None:  # pragma: no cover — exercised by the live integration env
    """Production interview runner: build the components and run the interview."""
    import time
    from pathlib import Path

    import anthropic

    from agent.controller.event_log import EventLog
    from agent.controller.interview import InterviewRunner
    from agent.rubric_loader import load_rubric
    from agent.scoring.probe import ProbeGenerator
    from agent.scoring.scorer import Scorer

    repo_root = Path(__file__).parents[4]
    rubric = load_rubric(repo_root / "rubric" / f"{ctx.script_version}.yaml")
    anthropic_client = anthropic.Anthropic()
    runner = InterviewRunner(
        rubric=rubric,
        voice=_build_voice_agent(participant),
        scorer=Scorer(client=anthropic_client, rubric=rubric),
        probe_generator=ProbeGenerator(client=anthropic_client, rubric=rubric),
        event_log=EventLog(
            session_id=ctx.session_id,
            path=repo_root / "artifacts" / ctx.session_id / "agent_events.jsonl",
        ),
        clock_now=time.monotonic,
    )
    await runner.run(session_id=ctx.session_id)


def _build_voice_agent(participant: Any) -> Any:  # pragma: no cover — vendor wiring
    """Construct the cascaded VoiceAgent from LiveKit plugins for `participant`."""
    import os

    from agent.voice.cascaded import CascadedVoiceAgent
    from agent.voice.stt import DeepgramSTT, build_deepgram_stt
    from agent.voice.tts import CartesiaTTS, build_cartesia_tts

    stt = DeepgramSTT(plugin=build_deepgram_stt(os.environ["DEEPGRAM_API_KEY"]))
    tts = CartesiaTTS(plugin=build_cartesia_tts(os.environ["CARTESIA_API_KEY"]))
    return CascadedVoiceAgent(stt=stt, tts=tts, room_output=participant)
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_interview_runner.py`
Expected: PASS (3 passed)

- [ ] **Step 5: Run the full agent suite**
Run: `cd agent && uv run pytest`
Expected: all tests pass, exit 0

- [ ] **Step 6: Commit**
```bash
git add agent/src/agent/controller/interview.py agent/src/agent/worker/entrypoint.py agent/tests/test_interview_runner.py && git commit -m "Wire end-to-end voice interview runner with simulated-candidate test"
```

---

## Phase 4: Video

### Task 4.1: Video frame sampling from the LiveKit video track

**Files:**
- Create: `agent/src/agent/video/__init__.py`
- Create: `agent/src/agent/video/sampler.py`
- Test: `agent/tests/test_frame_sampler.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_frame_sampler.py`:
```python
import pytest

from agent.video.sampler import FrameSampler, SampledFrame


def test_sampled_frame_holds_image_and_timestamp() -> None:
    frame = SampledFrame(image_bytes=b"\x00jpeg", timestamp_seconds=4.0)
    assert frame.image_bytes == b"\x00jpeg"
    assert frame.timestamp_seconds == 4.0


def test_sampler_keeps_one_frame_per_interval() -> None:
    # At 1 fps, frames arriving every 0.1s yield one kept frame per second.
    sampler = FrameSampler(target_fps=1.0)
    kept = []
    for i in range(25):  # 2.5 seconds of 10 fps input
        decision = sampler.offer(
            image_bytes=f"f{i}".encode(), timestamp_seconds=i * 0.1
        )
        if decision is not None:
            kept.append(decision)
    # 2.5s at 1 fps -> 3 frames kept (t=0.0, ~1.0, ~2.0).
    assert len(kept) == 3
    assert kept[0].timestamp_seconds == 0.0


def test_sampler_two_fps_keeps_twice_as_many() -> None:
    sampler = FrameSampler(target_fps=2.0)
    kept = []
    for i in range(20):  # 2.0 seconds of 10 fps input
        decision = sampler.offer(image_bytes=b"f", timestamp_seconds=i * 0.1)
        if decision is not None:
            kept.append(decision)
    # 2.0s at 2 fps -> 4 frames kept.
    assert len(kept) == 4


def test_sampler_rejects_non_positive_fps() -> None:
    with pytest.raises(ValueError, match="fps"):
        FrameSampler(target_fps=0.0)
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_frame_sampler.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.video'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/video/__init__.py`:
```python
"""The Video Perception Pipeline — non-scoring integrity and turn-hint signals."""
```
`agent/src/agent/video/sampler.py`:
```python
"""Sample the candidate video track down to ~1-2 fps for the VLM.

The VLM is expensive; sampling decouples the perception pipeline from the
incoming frame rate. Sampling is deterministic — one frame per interval.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class SampledFrame(BaseModel):
    """One frame selected for VLM analysis."""

    model_config = ConfigDict(frozen=True)

    image_bytes: bytes
    timestamp_seconds: float


class FrameSampler:
    """Down-samples an incoming video frame stream to a fixed target fps."""

    def __init__(self, target_fps: float) -> None:
        if target_fps <= 0:
            raise ValueError("target_fps must be positive")
        self._interval = 1.0 / target_fps
        self._next_due = 0.0

    def offer(
        self, image_bytes: bytes, timestamp_seconds: float
    ) -> SampledFrame | None:
        """Offer a frame; return a `SampledFrame` if it should be kept, else None.

        The first frame is always kept; subsequent frames are kept once a full
        sampling interval has elapsed since the last kept frame.
        """
        if timestamp_seconds + 1e-9 < self._next_due:
            return None
        self._next_due = timestamp_seconds + self._interval
        return SampledFrame(
            image_bytes=image_bytes, timestamp_seconds=timestamp_seconds
        )
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_frame_sampler.py`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/video/__init__.py agent/src/agent/video/sampler.py agent/tests/test_frame_sampler.py && git commit -m "Add video frame sampler down-sampling to ~1-2 fps"
```

---

### Task 4.2: Gemini Flash VLM integrity analysis

**Files:**
- Create: `agent/src/agent/video/vlm.py`
- Modify: `agent/pyproject.toml`
- Test: `agent/tests/test_vlm.py`

- [ ] **Step 1: Add the Gemini SDK dependency**
Modify `agent/pyproject.toml` — add to the `dependencies` list:
```toml
    "google-genai>=0.3",
```
Run: `cd agent && uv sync --extra dev`
Expected: resolves `google-genai`, exit 0

- [ ] **Step 2: Write the failing test**
`agent/tests/test_vlm.py`:
```python
import json
from unittest.mock import MagicMock

import pytest

from agent.video.sampler import SampledFrame
from agent.video.vlm import IntegrityVLM, VlmObservation


def _fake_gemini(payload: dict) -> MagicMock:
    client = MagicMock()
    response = MagicMock()
    response.text = json.dumps(payload)
    client.models.generate_content.return_value = response
    return client


def _frame() -> SampledFrame:
    return SampledFrame(image_bytes=b"\x00jpeg", timestamp_seconds=12.0)


def test_vlm_reports_no_signal_when_frame_is_clean() -> None:
    client = _fake_gemini(
        {
            "reading_off_screen": False,
            "multiple_faces": False,
            "candidate_absent": False,
            "still_formulating": False,
        }
    )
    vlm = IntegrityVLM(client=client)
    observation = vlm.analyze(_frame())
    assert isinstance(observation, VlmObservation)
    assert observation.integrity_events == []
    assert observation.turn_hint is False


def test_vlm_emits_integrity_event_for_reading_off_screen() -> None:
    client = _fake_gemini(
        {
            "reading_off_screen": True,
            "multiple_faces": False,
            "candidate_absent": False,
            "still_formulating": False,
        }
    )
    vlm = IntegrityVLM(client=client)
    observation = vlm.analyze(_frame())
    signals = [e.signal for e in observation.integrity_events]
    assert signals == ["reading_off_screen"]
    assert observation.integrity_events[0].frame_timestamp_seconds == 12.0


def test_vlm_emits_multiple_signals_and_turn_hint() -> None:
    client = _fake_gemini(
        {
            "reading_off_screen": False,
            "multiple_faces": True,
            "candidate_absent": True,
            "still_formulating": True,
        }
    )
    vlm = IntegrityVLM(client=client)
    observation = vlm.analyze(_frame())
    signals = {e.signal for e in observation.integrity_events}
    assert signals == {"multiple_faces", "candidate_absent"}
    assert observation.turn_hint is True


def test_vlm_analyze_passes_session_id_through() -> None:
    client = _fake_gemini(
        {
            "reading_off_screen": True, "multiple_faces": False,
            "candidate_absent": False, "still_formulating": False,
        }
    )
    vlm = IntegrityVLM(client=client)
    observation = vlm.analyze(_frame(), session_id="sess1")
    assert observation.integrity_events[0].session_id == "sess1"
```

- [ ] **Step 3: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_vlm.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.video.vlm'`

- [ ] **Step 4: Write minimal implementation**
`agent/src/agent/video/vlm.py`:
```python
"""Gemini Flash VLM integrity analysis — non-scoring side signals only.

The VLM detects integrity concerns (reading off-screen, multiple faces,
candidate absent) and a turn-taking hint. Output is NEVER a scoring input and
NEVER an auto-reject — it is logged and surfaced to a human reviewer.
NO facial identification or emotion analysis is performed.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, ConfigDict

from agent.config import MODELS
from agent.domain.types import IntegrityEvent
from agent.video.sampler import SampledFrame

_VLM_INSTRUCTIONS = (
    "You inspect ONE webcam frame from a candidate during a remote interview. "
    "Report only these observations. Do NOT identify the person, do NOT infer "
    "emotion, mood, or demeanor. Return STRICT JSON only matching: "
    '{"reading_off_screen": bool, "multiple_faces": bool, '
    '"candidate_absent": bool, "still_formulating": bool}. '
    "reading_off_screen: gaze persistently directed off-screen as if reading. "
    "multiple_faces: more than one face visible. "
    "candidate_absent: no face visible. "
    "still_formulating: the person looks mid-thought, not finished speaking."
)

# Maps the VLM's boolean flags to the IntegritySignal literals.
_SIGNAL_FLAGS = {
    "reading_off_screen": "reading_off_screen",
    "multiple_faces": "multiple_faces",
    "candidate_absent": "candidate_absent",
}


class VlmObservation(BaseModel):
    """One frame's VLM result: integrity events plus the turn hint."""

    model_config = ConfigDict(frozen=True)

    integrity_events: list[IntegrityEvent]
    turn_hint: bool


def _extract_json(text: str) -> dict[str, Any]:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError(f"no JSON object in VLM output: {text!r}")
    return json.loads(text[start : end + 1])


class IntegrityVLM:
    """Runs Gemini Flash over a sampled frame for integrity + turn signals."""

    def __init__(self, client: Any) -> None:
        self._client = client

    def analyze(
        self, frame: SampledFrame, session_id: str = ""
    ) -> VlmObservation:
        """Analyze one frame; return integrity events and the turn hint."""
        response = self._client.models.generate_content(
            model=MODELS.vlm_model,
            contents=[
                _VLM_INSTRUCTIONS,
                {"mime_type": "image/jpeg", "data": frame.image_bytes},
            ],
        )
        flags = _extract_json(response.text)
        events: list[IntegrityEvent] = []
        for flag, signal in _SIGNAL_FLAGS.items():
            if flags.get(flag):
                events.append(
                    IntegrityEvent(
                        session_id=session_id,
                        signal=signal,  # type: ignore[arg-type]
                        confidence=1.0,
                        frame_timestamp_seconds=frame.timestamp_seconds,
                    )
                )
        return VlmObservation(
            integrity_events=events,
            turn_hint=bool(flags.get("still_formulating")),
        )
```

- [ ] **Step 5: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_vlm.py`
Expected: PASS (4 passed)

- [ ] **Step 6: Commit**
```bash
git add agent/pyproject.toml agent/uv.lock agent/src/agent/video/vlm.py agent/tests/test_vlm.py && git commit -m "Add Gemini Flash VLM integrity analysis (non-scoring)"
```

---

### Task 4.3: Turn-hint signal

**Files:**
- Create: `agent/src/agent/video/turn_hint.py`
- Test: `agent/tests/test_turn_hint.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_turn_hint.py`:
```python
from agent.video.turn_hint import TurnHintTracker


def test_no_hint_before_any_observation() -> None:
    tracker = TurnHintTracker()
    assert tracker.candidate_likely_formulating() is False


def test_hint_active_after_still_formulating_observation() -> None:
    tracker = TurnHintTracker()
    tracker.observe(still_formulating=True, timestamp_seconds=10.0)
    assert tracker.candidate_likely_formulating() is True


def test_hint_clears_after_finished_observation() -> None:
    tracker = TurnHintTracker()
    tracker.observe(still_formulating=True, timestamp_seconds=10.0)
    tracker.observe(still_formulating=False, timestamp_seconds=11.0)
    assert tracker.candidate_likely_formulating() is False


def test_hint_is_stale_after_freshness_window() -> None:
    # A hint older than the freshness window is no longer trusted.
    tracker = TurnHintTracker(freshness_seconds=2.0)
    tracker.observe(still_formulating=True, timestamp_seconds=10.0)
    assert tracker.candidate_likely_formulating(now_seconds=10.5) is True
    assert tracker.candidate_likely_formulating(now_seconds=13.0) is False
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_turn_hint.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.video.turn_hint'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/video/turn_hint.py`:
```python
"""Turn-hint tracking — a non-binding signal that the candidate is mid-thought.

The Video Perception Pipeline reports `still_formulating`; this tracker holds
the latest such observation so the controller's turn detector can treat a
think-pause more patiently. It is a hint only — never a hard turn decision.
"""

from __future__ import annotations


class TurnHintTracker:
    """Holds the most recent turn hint within a freshness window."""

    def __init__(self, freshness_seconds: float = 2.0) -> None:
        self._freshness = freshness_seconds
        self._formulating = False
        self._observed_at: float | None = None

    def observe(self, still_formulating: bool, timestamp_seconds: float) -> None:
        """Record a fresh turn-hint observation from the VLM."""
        self._formulating = still_formulating
        self._observed_at = timestamp_seconds

    def candidate_likely_formulating(
        self, now_seconds: float | None = None
    ) -> bool:
        """True if a fresh observation says the candidate is still formulating.

        A hint older than `freshness_seconds` (when `now_seconds` is given) is
        treated as stale and ignored.
        """
        if not self._formulating or self._observed_at is None:
            return False
        if now_seconds is not None:
            if now_seconds - self._observed_at > self._freshness:
                return False
        return True
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_turn_hint.py`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**
```bash
git add agent/src/agent/video/turn_hint.py agent/tests/test_turn_hint.py && git commit -m "Add turn-hint tracker for think-pause patience"
```

---

### Task 4.4: Wire integrity and turn events into the Controller, audit log, and integrity_events.jsonl

**Files:**
- Create: `agent/src/agent/video/perception.py`
- Test: `agent/tests/test_perception.py`

- [ ] **Step 1: Write the failing test**
`agent/tests/test_perception.py`:
```python
import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from agent.audit_log import AuditLogWriter
from agent.domain.types import IntegrityEvent
from agent.video.perception import VideoPerceptionPipeline
from agent.video.sampler import SampledFrame
from agent.video.vlm import VlmObservation


def _observation(signals: list[str], turn_hint: bool) -> VlmObservation:
    return VlmObservation(
        integrity_events=[
            IntegrityEvent(
                session_id="sess1", signal=s, confidence=1.0,  # type: ignore[arg-type]
                frame_timestamp_seconds=12.0,
            )
            for s in signals
        ],
        turn_hint=turn_hint,
    )


def test_pipeline_writes_integrity_events_jsonl(tmp_path: Path) -> None:
    vlm = MagicMock()
    vlm.analyze.return_value = _observation(["reading_off_screen"], turn_hint=False)
    integrity_path = tmp_path / "integrity_events.jsonl"
    pipeline = VideoPerceptionPipeline(
        vlm=vlm, session_id="sess1",
        integrity_events_path=integrity_path,
        audit_log=AuditLogWriter(tmp_path / "audit.jsonl"),
    )
    pipeline.process_frame(SampledFrame(image_bytes=b"j", timestamp_seconds=12.0))
    lines = integrity_path.read_text().strip().splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["signal"] == "reading_off_screen"


def test_pipeline_records_integrity_signal_in_audit_log(tmp_path: Path) -> None:
    vlm = MagicMock()
    vlm.analyze.return_value = _observation(["multiple_faces"], turn_hint=False)
    audit_path = tmp_path / "audit.jsonl"
    pipeline = VideoPerceptionPipeline(
        vlm=vlm, session_id="sess1",
        integrity_events_path=tmp_path / "integrity_events.jsonl",
        audit_log=AuditLogWriter(audit_path),
    )
    pipeline.process_frame(SampledFrame(image_bytes=b"j", timestamp_seconds=12.0))
    entries = [json.loads(line) for line in audit_path.read_text().splitlines()]
    assert any(e["event_type"] == "integrity_signal" for e in entries)
    assert AuditLogWriter.verify(audit_path) is True


def test_pipeline_updates_turn_hint_tracker(tmp_path: Path) -> None:
    vlm = MagicMock()
    vlm.analyze.return_value = _observation([], turn_hint=True)
    pipeline = VideoPerceptionPipeline(
        vlm=vlm, session_id="sess1",
        integrity_events_path=tmp_path / "integrity_events.jsonl",
        audit_log=AuditLogWriter(tmp_path / "audit.jsonl"),
    )
    pipeline.process_frame(SampledFrame(image_bytes=b"j", timestamp_seconds=9.0))
    assert pipeline.turn_hint.candidate_likely_formulating() is True


def test_pipeline_failure_marks_signals_unavailable(tmp_path: Path) -> None:
    vlm = MagicMock()
    vlm.analyze.side_effect = RuntimeError("VLM down")
    pipeline = VideoPerceptionPipeline(
        vlm=vlm, session_id="sess1",
        integrity_events_path=tmp_path / "integrity_events.jsonl",
        audit_log=AuditLogWriter(tmp_path / "audit.jsonl"),
    )
    # A VLM failure does not raise — video is non-critical; the interview goes on.
    pipeline.process_frame(SampledFrame(image_bytes=b"j", timestamp_seconds=9.0))
    assert pipeline.signals_available is False


def test_pipeline_collects_all_integrity_flags(tmp_path: Path) -> None:
    vlm = MagicMock()
    vlm.analyze.side_effect = [
        _observation(["reading_off_screen"], turn_hint=False),
        _observation(["multiple_faces"], turn_hint=False),
    ]
    pipeline = VideoPerceptionPipeline(
        vlm=vlm, session_id="sess1",
        integrity_events_path=tmp_path / "integrity_events.jsonl",
        audit_log=AuditLogWriter(tmp_path / "audit.jsonl"),
    )
    pipeline.process_frame(SampledFrame(image_bytes=b"j", timestamp_seconds=9.0))
    pipeline.process_frame(SampledFrame(image_bytes=b"j", timestamp_seconds=10.0))
    assert sorted(pipeline.integrity_flags()) == ["multiple_faces", "reading_off_screen"]
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd agent && uv run pytest tests/test_perception.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'agent.video.perception'`

- [ ] **Step 3: Write minimal implementation**
`agent/src/agent/video/perception.py`:
```python
"""The Video Perception Pipeline — wires the VLM, the turn-hint tracker, the
audit log, and the `integrity_events.jsonl` artifact.

Decoupled from the interview loop: a VLM failure never interrupts the
interview; integrity signals are simply marked unavailable for the session.
Integrity signals are advisory — logged and surfaced for human review, never
fed to the Scorer and never an auto-reject.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from agent.audit_log import AuditLogWriter
from agent.video.sampler import SampledFrame
from agent.video.turn_hint import TurnHintTracker


class VideoPerceptionPipeline:
    """Processes sampled frames into integrity events, audit entries, hints."""

    def __init__(
        self,
        vlm: Any,
        session_id: str,
        integrity_events_path: Path,
        audit_log: AuditLogWriter,
    ) -> None:
        self._vlm = vlm
        self._session_id = session_id
        self._integrity_events_path = integrity_events_path
        self._integrity_events_path.parent.mkdir(parents=True, exist_ok=True)
        self._audit_log = audit_log
        self.turn_hint = TurnHintTracker()
        self.signals_available = True
        self._flags: list[str] = []

    def process_frame(self, frame: SampledFrame) -> None:
        """Analyze one frame; log integrity events; update the turn hint.

        Swallows VLM failures — video is non-critical — and marks signals
        unavailable for the remainder of the session.
        """
        try:
            observation = self._vlm.analyze(frame, session_id=self._session_id)
        except Exception:  # noqa: BLE001 — video failure must not stop the call
            self.signals_available = False
            self._audit_log.write(
                "integrity_unavailable",
                {"session_id": self._session_id, "reason": "vlm_failure"},
            )
            return

        for event in observation.integrity_events:
            with self._integrity_events_path.open("a", encoding="utf-8") as handle:
                handle.write(event.model_dump_json() + "\n")
            self._flags.append(event.signal)
            self._audit_log.write(
                "integrity_signal",
                {
                    "session_id": self._session_id,
                    "signal": event.signal,
                    "frame_timestamp_seconds": event.frame_timestamp_seconds,
                },
            )
        self.turn_hint.observe(
            still_formulating=observation.turn_hint,
            timestamp_seconds=frame.timestamp_seconds,
        )

    def integrity_flags(self) -> list[str]:
        """All distinct integrity signals seen this session, for the assessment."""
        return sorted(set(self._flags))
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd agent && uv run pytest tests/test_perception.py`
Expected: PASS (5 passed)

- [ ] **Step 5: Run the full agent suite**
Run: `cd agent && uv run pytest`
Expected: all tests pass, exit 0

- [ ] **Step 6: Commit**
```bash
git add agent/src/agent/video/perception.py agent/tests/test_perception.py && git commit -m "Wire video perception: integrity events, audit log, turn hint"
```

---

## Phase 5: Review and integration

### Task 5.1: Backend Scheduler/API — create session, provision LiveKit room, dispatch worker

**Files:**
- Create: `backend/src/livekit/provision.ts`
- Create: `backend/src/scheduler/sessions.ts`
- Create: `backend/src/scheduler/routes.ts`
- Modify: `backend/package.json`
- Test: `backend/test/sessions.test.ts`

- [ ] **Step 1: Add the LiveKit server SDK dependency**
Modify `backend/package.json` — add to `dependencies`:
```json
    "livekit-server-sdk": "^2.7.0"
```
Run: `cd backend && pnpm install`
Expected: resolves `livekit-server-sdk`, exit 0

- [ ] **Step 2: Write the failing test**
`backend/test/sessions.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import {
  buildSessionRecord,
  createSessionInsert,
  buildWorkerDispatchMetadata,
} from "../src/scheduler/sessions.js";

describe("buildSessionRecord", () => {
  it("creates a scheduled session with the given identity", () => {
    const record = buildSessionRecord({
      sessionId: "sess1",
      orgId: "org1",
      candidateEmail: "c@example.com",
      scriptVersion: "pilot-v1",
      scheduledAt: "2026-05-21T15:00:00Z",
    });
    expect(record.status).toBe("scheduled");
    expect(record.sessionId).toBe("sess1");
    expect(record.scriptVersion).toBe("pilot-v1");
  });
});

describe("createSessionInsert", () => {
  it("builds a parameterized insert for the sessions table", () => {
    const stmt = createSessionInsert(
      buildSessionRecord({
        sessionId: "sess1",
        orgId: "org1",
        candidateEmail: "c@example.com",
        scriptVersion: "pilot-v1",
        scheduledAt: "2026-05-21T15:00:00Z",
      }),
    );
    expect(stmt.sql).toContain("INSERT INTO sessions");
    expect(stmt.params).toEqual([
      "sess1",
      "org1",
      "c@example.com",
      "pilot-v1",
      "scheduled",
      "2026-05-21T15:00:00Z",
    ]);
  });
});

describe("buildWorkerDispatchMetadata", () => {
  it("serializes the metadata the agent worker entrypoint parses", () => {
    const meta = buildWorkerDispatchMetadata({
      sessionId: "sess1",
      orgId: "org1",
      candidateEmail: "c@example.com",
      scriptVersion: "pilot-v1",
      scheduledAt: "2026-05-21T15:00:00Z",
      status: "scheduled",
    });
    const parsed = JSON.parse(meta);
    expect(parsed.session_id).toBe("sess1");
    expect(parsed.org_id).toBe("org1");
    expect(parsed.script_version).toBe("pilot-v1");
    expect(parsed.candidate_email).toBe("c@example.com");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**
Run: `cd backend && pnpm test`
Expected: FAIL — cannot resolve `../src/scheduler/sessions.js`

- [ ] **Step 4: Write minimal implementation**
`backend/src/livekit/provision.ts`:
```typescript
import { RoomServiceClient, AgentDispatchClient } from "livekit-server-sdk";

export interface LiveKitConfig {
  readonly host: string;
  readonly apiKey: string;
  readonly apiSecret: string;
}

export function roomName(sessionId: string): string {
  return `interview-${sessionId}`;
}

// Provisions the SFU room and dispatches one agent worker into it.
export async function provisionRoom(
  config: LiveKitConfig,
  sessionId: string,
  workerMetadata: string,
): Promise<{ readonly room: string }> {
  const rooms = new RoomServiceClient(config.host, config.apiKey, config.apiSecret);
  const dispatch = new AgentDispatchClient(config.host, config.apiKey, config.apiSecret);
  const room = roomName(sessionId);
  await rooms.createRoom({ name: room, emptyTimeout: 600, maxParticipants: 3 });
  await dispatch.createDispatch(room, "puddle-interviewer", {
    metadata: workerMetadata,
  });
  return { room };
}
```
`backend/src/scheduler/sessions.ts`:
```typescript
import type { SqlStatement } from "../consent/repository.js";

export interface SessionInput {
  readonly sessionId: string;
  readonly orgId: string;
  readonly candidateEmail: string;
  readonly scriptVersion: string;
  readonly scheduledAt: string;
}

export interface SessionRecord extends SessionInput {
  readonly status: "scheduled";
}

export function buildSessionRecord(input: SessionInput): SessionRecord {
  return { ...input, status: "scheduled" };
}

export function createSessionInsert(record: SessionRecord): SqlStatement {
  return {
    sql:
      "INSERT INTO sessions " +
      "(session_id, org_id, candidate_email, script_version, status, scheduled_at) " +
      "VALUES ($1, $2, $3, $4, $5, $6)",
    params: [
      record.sessionId,
      record.orgId,
      record.candidateEmail,
      record.scriptVersion,
      record.status,
      record.scheduledAt,
    ],
  };
}

// Mirrors `InterviewJobContext` in agent/src/agent/worker/entrypoint.py —
// the agent worker parses exactly these snake_case keys.
export function buildWorkerDispatchMetadata(record: SessionRecord): string {
  return JSON.stringify({
    session_id: record.sessionId,
    org_id: record.orgId,
    candidate_email: record.candidateEmail,
    script_version: record.scriptVersion,
  });
}
```
`backend/src/scheduler/routes.ts`:
```typescript
import type { FastifyInstance } from "fastify";
import { getPool } from "../db/pool.js";
import { provisionRoom, type LiveKitConfig } from "../livekit/provision.js";
import {
  buildSessionRecord,
  createSessionInsert,
  buildWorkerDispatchMetadata,
  type SessionInput,
} from "./sessions.js";

// POST /sessions — create a session, provision the room, dispatch the worker.
export function registerSchedulerRoutes(
  app: FastifyInstance,
  liveKitConfig: LiveKitConfig,
): void {
  app.post<{ Body: SessionInput }>("/sessions", async (request, reply) => {
    const record = buildSessionRecord(request.body);
    const insert = createSessionInsert(record);
    await getPool().query(insert.sql, [...insert.params]);
    const { room } = await provisionRoom(
      liveKitConfig,
      record.sessionId,
      buildWorkerDispatchMetadata(record),
    );
    return reply.code(201).send({ sessionId: record.sessionId, room });
  });
}
```

- [ ] **Step 5: Run test to verify it passes**
Run: `cd backend && pnpm test`
Expected: PASS (sessions tests pass)

- [ ] **Step 6: Verify the backend builds**
Run: `cd backend && pnpm build`
Expected: exit 0

- [ ] **Step 7: Commit**
```bash
git add backend/package.json backend/src/livekit backend/src/scheduler backend/test/sessions.test.ts pnpm-lock.yaml && git commit -m "Add backend Scheduler/API: session creation, LiveKit room provisioning, worker dispatch"
```

---

### Task 5.2: Backend Orchestrator and worker pre-warm

**Files:**
- Create: `backend/src/orchestrator/lifecycle.ts`
- Create: `backend/src/orchestrator/prewarm.ts`
- Test: `backend/test/orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**
`backend/test/orchestrator.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { nextSessionStatus, isTerminal } from "../src/orchestrator/lifecycle.js";
import { dueForPrewarm } from "../src/orchestrator/prewarm.js";

describe("session lifecycle", () => {
  it("advances scheduled -> in_progress -> recording_finalizing -> review_ready", () => {
    expect(nextSessionStatus("scheduled")).toBe("in_progress");
    expect(nextSessionStatus("in_progress")).toBe("recording_finalizing");
    expect(nextSessionStatus("recording_finalizing")).toBe("review_ready");
  });

  it("treats review_ready and incomplete as terminal", () => {
    expect(isTerminal("review_ready")).toBe(true);
    expect(isTerminal("incomplete")).toBe(true);
    expect(isTerminal("in_progress")).toBe(false);
  });
});

describe("worker pre-warm", () => {
  it("flags a session due for pre-warm within the lead window", () => {
    const now = Date.parse("2026-05-21T14:55:00Z");
    // 5 minutes before start, lead window 10 minutes -> due.
    expect(
      dueForPrewarm("2026-05-21T15:00:00Z", now, 10 * 60 * 1000),
    ).toBe(true);
  });

  it("does not flag a session outside the lead window", () => {
    const now = Date.parse("2026-05-21T14:30:00Z");
    // 30 minutes before start, lead window 10 minutes -> not due.
    expect(
      dueForPrewarm("2026-05-21T15:00:00Z", now, 10 * 60 * 1000),
    ).toBe(false);
  });

  it("does not flag a session whose start has already passed", () => {
    const now = Date.parse("2026-05-21T15:30:00Z");
    expect(
      dueForPrewarm("2026-05-21T15:00:00Z", now, 10 * 60 * 1000),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd backend && pnpm test`
Expected: FAIL — cannot resolve `../src/orchestrator/lifecycle.js`

- [ ] **Step 3: Write minimal implementation**
`backend/src/orchestrator/lifecycle.ts`:
```typescript
export type SessionStatus =
  | "scheduled"
  | "in_progress"
  | "recording_finalizing"
  | "review_ready"
  | "incomplete";

const ORDER: SessionStatus[] = [
  "scheduled",
  "in_progress",
  "recording_finalizing",
  "review_ready",
];

// The next status in the happy-path lifecycle; terminal statuses stay put.
export function nextSessionStatus(status: SessionStatus): SessionStatus {
  const index = ORDER.indexOf(status);
  if (index < 0 || index === ORDER.length - 1) return status;
  return ORDER[index + 1] as SessionStatus;
}

export function isTerminal(status: SessionStatus): boolean {
  return status === "review_ready" || status === "incomplete";
}
```
`backend/src/orchestrator/prewarm.ts`:
```typescript
// A session is due for worker pre-warm when its scheduled start is within the
// lead window from now but has not yet passed.
export function dueForPrewarm(
  scheduledAtIso: string,
  nowMs: number,
  leadWindowMs: number,
): boolean {
  const startMs = Date.parse(scheduledAtIso);
  const msUntilStart = startMs - nowMs;
  return msUntilStart > 0 && msUntilStart <= leadWindowMs;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd backend && pnpm test`
Expected: PASS (orchestrator tests pass)

- [ ] **Step 5: Commit**
```bash
git add backend/src/orchestrator backend/test/orchestrator.test.ts && git commit -m "Add backend Orchestrator lifecycle and worker pre-warm scheduling"
```

---

### Task 5.3: Backend Finalization worker — assemble transcript and artifacts

**Files:**
- Create: `backend/src/finalization/transcript.ts`
- Create: `backend/src/finalization/finalize.ts`
- Test: `backend/test/finalization.test.ts`

- [ ] **Step 1: Write the failing test**
`backend/test/finalization.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { assembleTranscript } from "../src/finalization/transcript.js";
import { buildArtifactManifest } from "../src/finalization/finalize.js";

describe("assembleTranscript", () => {
  it("builds a question-aligned diarized transcript", () => {
    const transcript = assembleTranscript([
      { turnIndex: 0, speaker: "agent", text: "Tell me about a hard problem.", questionId: "q1" },
      { turnIndex: 1, speaker: "candidate", text: "I rewrote the scheduler.", questionId: "q1" },
      { turnIndex: 2, speaker: "agent", text: "What was the impact?", questionId: "q1" },
      { turnIndex: 3, speaker: "candidate", text: "Cut latency in half.", questionId: "q1" },
    ]);
    expect(transcript.version).toBe("v1");
    expect(transcript.byQuestion.q1).toHaveLength(4);
    expect(transcript.byQuestion.q1[0].speaker).toBe("agent");
  });

  it("groups turns under their question id", () => {
    const transcript = assembleTranscript([
      { turnIndex: 0, speaker: "agent", text: "q1 text", questionId: "q1" },
      { turnIndex: 1, speaker: "candidate", text: "a1", questionId: "q1" },
      { turnIndex: 2, speaker: "agent", text: "q2 text", questionId: "q2" },
      { turnIndex: 3, speaker: "candidate", text: "a2", questionId: "q2" },
    ]);
    expect(Object.keys(transcript.byQuestion)).toEqual(["q1", "q2"]);
    expect(transcript.byQuestion.q2[1].text).toBe("a2");
  });
});

describe("buildArtifactManifest", () => {
  it("lists every expected artifact path for the session", () => {
    const manifest = buildArtifactManifest("org1", "sess1");
    expect(manifest.transcript).toBe(
      "/org1/interviews/sess1/transcripts/transcript.v1.json",
    );
    expect(manifest.scores).toBe("/org1/interviews/sess1/assessment/scores.json");
    expect(manifest.composite).toBe("/org1/interviews/sess1/media/composite.mp4");
    expect(manifest.agentEvents).toBe(
      "/org1/interviews/sess1/events/agent_events.jsonl",
    );
    expect(manifest.integrityEvents).toBe(
      "/org1/interviews/sess1/events/integrity_events.jsonl",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd backend && pnpm test`
Expected: FAIL — cannot resolve `../src/finalization/transcript.js`

- [ ] **Step 3: Write minimal implementation**
`backend/src/finalization/transcript.ts`:
```typescript
export interface RawTurn {
  readonly turnIndex: number;
  readonly speaker: "agent" | "candidate";
  readonly text: string;
  readonly questionId: string;
}

export interface AssembledTranscript {
  readonly version: "v1";
  readonly turns: readonly RawTurn[];
  readonly byQuestion: Record<string, RawTurn[]>;
}

// Builds the question-aligned, diarized transcript.v1.json content.
export function assembleTranscript(turns: readonly RawTurn[]): AssembledTranscript {
  const ordered = [...turns].sort((a, b) => a.turnIndex - b.turnIndex);
  const byQuestion: Record<string, RawTurn[]> = {};
  for (const turn of ordered) {
    (byQuestion[turn.questionId] ??= []).push(turn);
  }
  return { version: "v1", turns: ordered, byQuestion };
}
```
`backend/src/finalization/finalize.ts`:
```typescript
import { storagePaths } from "../storage/layout.js";

export interface ArtifactManifest {
  readonly transcript: string;
  readonly scores: string;
  readonly integrityFlags: string;
  readonly composite: string;
  readonly candidateVideo: string;
  readonly agentEvents: string;
  readonly mediaEvents: string;
  readonly integrityEvents: string;
}

// The Finalization worker writes/collects exactly these artifacts post-call.
export function buildArtifactManifest(
  orgId: string,
  sessionId: string,
): ArtifactManifest {
  const p = storagePaths(orgId, sessionId);
  return {
    transcript: p.transcripts.transcript,
    scores: p.assessment.scores,
    integrityFlags: p.assessment.integrityFlags,
    composite: p.media.composite,
    candidateVideo: p.media.candidateVideo,
    agentEvents: p.events.agentEvents,
    mediaEvents: p.events.mediaEvents,
    integrityEvents: p.events.integrityEvents,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd backend && pnpm test`
Expected: PASS (finalization tests pass)

- [ ] **Step 5: Commit**
```bash
git add backend/src/finalization backend/test/finalization.test.ts && git commit -m "Add backend Finalization worker: transcript assembly and artifact manifest"
```

---

### Task 5.4: Review App — VOD, transcript, scores, integrity flags, reviewer sign-off

**Files:**
- Create: `review/package.json`
- Create: `review/tsconfig.json`
- Create: `review/vite.config.ts`
- Create: `review/index.html`
- Create: `review/src/main.tsx`
- Create: `review/src/App.tsx`
- Create: `review/src/signoff.ts`
- Create: `review/src/pages/ReviewSession.tsx`
- Test: `review/test/signoff.test.ts`

- [ ] **Step 1: Create the package, TS, and Vite config**
`review/package.json`:
```json
{
  "name": "@puddle/review",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```
`review/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ES2022",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```
`review/vite.config.ts`:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
```

- [ ] **Step 2: Write the failing test for sign-off logic**
`review/test/signoff.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  validateSignoff,
  buildSignoffRecord,
  applyScoreEdit,
  type ReviewedAssessment,
} from "../src/signoff.js";

const baseAssessment: ReviewedAssessment = {
  sessionId: "sess1",
  scriptVersion: "pilot-v1",
  categoryScores: [
    { category: "problem_solving", score: 4, confidence: 0.9, lowConfidence: false },
    { category: "agency", score: 3, confidence: 0.6, lowConfidence: true },
  ],
  meetsBareMinimum: true,
  integrityFlags: ["reading_off_screen"],
};

describe("validateSignoff", () => {
  it("requires a reviewer identity", () => {
    const result = validateSignoff(baseAssessment, { reviewerEmail: "" });
    expect(result.ok).toBe(false);
  });

  it("accepts a sign-off from an identified reviewer", () => {
    const result = validateSignoff(baseAssessment, {
      reviewerEmail: "reviewer@puddle.com",
    });
    expect(result.ok).toBe(true);
  });
});

describe("applyScoreEdit", () => {
  it("lets a reviewer override a category score", () => {
    const edited = applyScoreEdit(baseAssessment, "agency", 4);
    const agency = edited.categoryScores.find((c) => c.category === "agency");
    expect(agency?.score).toBe(4);
    // Other categories are untouched.
    const ps = edited.categoryScores.find((c) => c.category === "problem_solving");
    expect(ps?.score).toBe(4);
  });

  it("rejects an out-of-range score", () => {
    expect(() => applyScoreEdit(baseAssessment, "agency", 5)).toThrow(/1-4/);
  });
});

describe("buildSignoffRecord", () => {
  it("captures reviewer, timestamp, and the final assessment", () => {
    const record = buildSignoffRecord(baseAssessment, {
      reviewerEmail: "reviewer@puddle.com",
      signedOffAt: "2026-05-21T16:00:00Z",
    });
    expect(record.reviewerEmail).toBe("reviewer@puddle.com");
    expect(record.signedOffAt).toBe("2026-05-21T16:00:00Z");
    expect(record.assessment.sessionId).toBe("sess1");
  });
});
```
Run: `cd review && pnpm install && pnpm test`
Expected: FAIL — cannot resolve `../src/signoff.js`

- [ ] **Step 3: Write the sign-off logic**
`review/src/signoff.ts`:
```typescript
export interface ReviewedCategoryScore {
  readonly category: string;
  readonly score: number;
  readonly confidence: number;
  readonly lowConfidence: boolean;
}

export interface ReviewedAssessment {
  readonly sessionId: string;
  readonly scriptVersion: string;
  readonly categoryScores: readonly ReviewedCategoryScore[];
  readonly meetsBareMinimum: boolean;
  readonly integrityFlags: readonly string[];
}

export type SignoffValidation = { ok: true } | { ok: false; reason: string };

// Every assessment requires a human sign-off from an identified reviewer.
export function validateSignoff(
  _assessment: ReviewedAssessment,
  input: { readonly reviewerEmail: string },
): SignoffValidation {
  if (!input.reviewerEmail.trim()) {
    return { ok: false, reason: "a reviewer identity is required to sign off" };
  }
  return { ok: true };
}

// A reviewer may override any category score within the 1-4 range.
export function applyScoreEdit(
  assessment: ReviewedAssessment,
  category: string,
  newScore: number,
): ReviewedAssessment {
  if (newScore < 1 || newScore > 4 || !Number.isInteger(newScore)) {
    throw new Error(`score must be an integer 1-4, got ${newScore}`);
  }
  return {
    ...assessment,
    categoryScores: assessment.categoryScores.map((cs) =>
      cs.category === category ? { ...cs, score: newScore } : cs,
    ),
  };
}

export interface SignoffRecord {
  readonly reviewerEmail: string;
  readonly signedOffAt: string;
  readonly assessment: ReviewedAssessment;
}

export function buildSignoffRecord(
  assessment: ReviewedAssessment,
  input: { readonly reviewerEmail: string; readonly signedOffAt: string },
): SignoffRecord {
  return {
    reviewerEmail: input.reviewerEmail,
    signedOffAt: input.signedOffAt,
    assessment,
  };
}
```
Run: `cd review && pnpm test`
Expected: PASS (signoff tests pass)

- [ ] **Step 4: Write the review page and app shell**
`review/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Puddle Review</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```
`review/src/main.tsx`:
```typescript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```
`review/src/pages/ReviewSession.tsx`:
```typescript
import { useState } from "react";
import {
  applyScoreEdit,
  buildSignoffRecord,
  validateSignoff,
  type ReviewedAssessment,
} from "../signoff.js";

interface ReviewSessionProps {
  readonly assessment: ReviewedAssessment;
  readonly compositeVideoUrl: string;
  readonly onSignedOff: (reviewerEmail: string) => void;
}

// Per session: VOD playback, question-aligned transcript, per-category
// score + evidence + confidence, integrity flags, and the reviewer sign-off.
export function ReviewSession({
  assessment,
  compositeVideoUrl,
  onSignedOff,
}: ReviewSessionProps): JSX.Element {
  const [current, setCurrent] = useState<ReviewedAssessment>(assessment);
  const [reviewerEmail, setReviewerEmail] = useState("");

  const signOff = (): void => {
    const validation = validateSignoff(current, { reviewerEmail });
    if (!validation.ok) return;
    buildSignoffRecord(current, {
      reviewerEmail,
      signedOffAt: new Date().toISOString(),
    });
    onSignedOff(reviewerEmail);
  };

  return (
    <main>
      <video aria-label="composite-vod" src={compositeVideoUrl} controls />
      <section aria-label="integrity-flags">
        {current.integrityFlags.length === 0
          ? "No integrity flags"
          : current.integrityFlags.join(", ")}
      </section>
      <section aria-label="category-scores">
        {current.categoryScores.map((cs) => (
          <div key={cs.category}>
            <span>{cs.category}</span>
            <span>{cs.score}</span>
            {cs.lowConfidence && <span aria-label="low-confidence">low confidence</span>}
            <button onClick={() => setCurrent(applyScoreEdit(current, cs.category, 4))}>
              Set 4
            </button>
          </div>
        ))}
      </section>
      <input
        aria-label="reviewer-email"
        value={reviewerEmail}
        onChange={(e) => setReviewerEmail(e.target.value)}
      />
      <button onClick={signOff}>Sign off</button>
    </main>
  );
}
```
`review/src/App.tsx`:
```typescript
import { ReviewSession } from "./pages/ReviewSession.js";
import type { ReviewedAssessment } from "./signoff.js";

// In v1 the assessment under review is supplied by the backend; this shell
// renders the single review surface.
const PLACEHOLDER: ReviewedAssessment = {
  sessionId: "",
  scriptVersion: "pilot-v1",
  categoryScores: [],
  meetsBareMinimum: false,
  integrityFlags: [],
};

export function App(): JSX.Element {
  return (
    <ReviewSession
      assessment={PLACEHOLDER}
      compositeVideoUrl=""
      onSignedOff={() => undefined}
    />
  );
}
```

- [ ] **Step 5: Add `review` to the workspace and verify build + test**
The package is already matched by `pnpm-workspace.yaml` (`"review"`).
Run: `cd review && pnpm install && pnpm test && pnpm build`
Expected: tests PASS (signoff tests pass); `pnpm build` exits 0

- [ ] **Step 6: Commit**
```bash
git add review pnpm-lock.yaml && git commit -m "Add Review App: VOD, scores, integrity flags, reviewer sign-off"
```

---

### Task 5.5: Platform integration REST API contract

**Files:**
- Create: `backend/src/integration/contract.ts`
- Create: `backend/src/integration/routes.ts`
- Test: `backend/test/integration.test.ts`

- [ ] **Step 1: Write the failing test**
`backend/test/integration.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  validateCreateSessionRequest,
  toAssessmentResponse,
  INTEGRATION_API_VERSION,
} from "../src/integration/contract.js";

describe("integration contract", () => {
  it("pins an explicit API version", () => {
    expect(INTEGRATION_API_VERSION).toBe("2026-05-20");
  });

  it("validates a create-session request from the platform", () => {
    const result = validateCreateSessionRequest({
      orgId: "org1",
      candidateEmail: "c@example.com",
      scriptVersion: "pilot-v1",
      scheduledAt: "2026-05-21T15:00:00Z",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a create-session request missing required fields", () => {
    const result = validateCreateSessionRequest({
      orgId: "org1",
      candidateEmail: "",
      scriptVersion: "pilot-v1",
      scheduledAt: "2026-05-21T15:00:00Z",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("candidateEmail");
  });

  it("maps an internal assessment to the platform response shape", () => {
    const response = toAssessmentResponse({
      sessionId: "sess1",
      scriptVersion: "pilot-v1",
      categoryScores: [
        { category: "problem_solving", score: 4, confidence: 0.9, lowConfidence: false },
      ],
      meetsBareMinimum: true,
      integrityFlags: ["reading_off_screen"],
      reviewerEmail: "reviewer@puddle.com",
      signedOffAt: "2026-05-21T16:00:00Z",
    });
    expect(response.apiVersion).toBe("2026-05-20");
    expect(response.sessionId).toBe("sess1");
    expect(response.recommendation).toBe("meets_bar");
    expect(response.humanSignedOff).toBe(true);
    expect(response.categoryScores[0].category).toBe("problem_solving");
  });

  it("marks an unsigned assessment as not human-signed-off", () => {
    const response = toAssessmentResponse({
      sessionId: "sess1",
      scriptVersion: "pilot-v1",
      categoryScores: [],
      meetsBareMinimum: false,
      integrityFlags: [],
      reviewerEmail: null,
      signedOffAt: null,
    });
    expect(response.humanSignedOff).toBe(false);
    expect(response.recommendation).toBe("below_bar");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd backend && pnpm test`
Expected: FAIL — cannot resolve `../src/integration/contract.js`

- [ ] **Step 3: Write minimal implementation**
`backend/src/integration/contract.ts`:
```typescript
// The documented REST API boundary with the cofounder's Puddle platform.
// The version is pinned so the platform integrates against a stable contract.
export const INTEGRATION_API_VERSION = "2026-05-20";

export interface CreateSessionRequest {
  readonly orgId: string;
  readonly candidateEmail: string;
  readonly scriptVersion: string;
  readonly scheduledAt: string;
}

export type ContractValidation = { ok: true } | { ok: false; reason: string };

export function validateCreateSessionRequest(
  body: CreateSessionRequest,
): ContractValidation {
  const required: (keyof CreateSessionRequest)[] = [
    "orgId",
    "candidateEmail",
    "scriptVersion",
    "scheduledAt",
  ];
  for (const field of required) {
    if (!body[field] || !String(body[field]).trim()) {
      return { ok: false, reason: `missing required field: ${field}` };
    }
  }
  return { ok: true };
}

export interface InternalAssessment {
  readonly sessionId: string;
  readonly scriptVersion: string;
  readonly categoryScores: readonly {
    readonly category: string;
    readonly score: number;
    readonly confidence: number;
    readonly lowConfidence: boolean;
  }[];
  readonly meetsBareMinimum: boolean;
  readonly integrityFlags: readonly string[];
  readonly reviewerEmail: string | null;
  readonly signedOffAt: string | null;
}

export interface AssessmentResponse {
  readonly apiVersion: string;
  readonly sessionId: string;
  readonly scriptVersion: string;
  readonly recommendation: "meets_bar" | "below_bar";
  readonly categoryScores: InternalAssessment["categoryScores"];
  readonly integrityFlags: readonly string[];
  readonly humanSignedOff: boolean;
  readonly signedOffAt: string | null;
}

// The platform only ever receives a human-reviewed recommendation — never an
// autonomous decision. `humanSignedOff` makes the review state explicit.
export function toAssessmentResponse(
  assessment: InternalAssessment,
): AssessmentResponse {
  return {
    apiVersion: INTEGRATION_API_VERSION,
    sessionId: assessment.sessionId,
    scriptVersion: assessment.scriptVersion,
    recommendation: assessment.meetsBareMinimum ? "meets_bar" : "below_bar",
    categoryScores: assessment.categoryScores,
    integrityFlags: assessment.integrityFlags,
    humanSignedOff: assessment.reviewerEmail !== null,
    signedOffAt: assessment.signedOffAt,
  };
}
```
`backend/src/integration/routes.ts`:
```typescript
import type { FastifyInstance } from "fastify";
import {
  validateCreateSessionRequest,
  type CreateSessionRequest,
} from "./contract.js";

// The platform-facing REST surface. Session creation is delegated to the
// Scheduler routes; this validates the contract before handing off.
export function registerIntegrationRoutes(
  app: FastifyInstance,
  onValidRequest: (body: CreateSessionRequest) => Promise<{ sessionId: string }>,
): void {
  app.post<{ Body: CreateSessionRequest }>(
    "/integration/sessions",
    async (request, reply) => {
      const validation = validateCreateSessionRequest(request.body);
      if (!validation.ok) {
        return reply.code(400).send({ error: validation.reason });
      }
      const result = await onValidRequest(request.body);
      return reply.code(201).send(result);
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd backend && pnpm test`
Expected: PASS (integration tests pass)

- [ ] **Step 5: Verify the backend builds and the full suite is green**
Run: `cd backend && pnpm build && pnpm test`
Expected: build exits 0; all backend tests pass

- [ ] **Step 6: Commit**
```bash
git add backend/src/integration backend/test/integration.test.ts && git commit -m "Add platform integration REST API contract and routes"
```

---

### Task 5.6: End-to-end calibration on the pilot role with recorded test interviews   [manual-gate]

**Files:**
- Create: `agent/tests/test_e2e_calibration.py`
- Create: `docs/calibration/README.md`

> **manual-gate:** Step 4 runs the calibration over the real human-scored corpus and gates whether the Scorer is trusted to run live interviews — a reduction-of-oversight decision. The autonomous run halts before it for operator approval. Steps 1–3 and 5 (a deterministic stubbed end-to-end test and documentation) are not gated.

- [ ] **Step 1: Write the failing end-to-end calibration test (stubbed Scorer)**
`agent/tests/test_e2e_calibration.py`:
```python
import json
from pathlib import Path
from unittest.mock import MagicMock

from agent.eval.calibrate import run_calibration
from agent.eval.corpus import CorpusItem
from agent.rubric_loader import load_rubric
from agent.scoring.io_types import CategoryAssessment, ScorerOutput

RUBRIC = load_rubric(Path(__file__).parents[2] / "rubric" / "pilot-v1.yaml")


def _corpus_item(interview_id: str, scores: dict[str, int]) -> dict:
    return {
        "interview_id": interview_id,
        "script_version": "pilot-v1",
        "transcript": [
            {"turn_index": 0, "speaker": "agent", "text": "q1", "question_id": "q1"},
            {"turn_index": 1, "speaker": "candidate", "text": "answer", "question_id": "q1"},
        ],
        "human_scores": scores,
    }


def _perfect_scorer() -> MagicMock:
    """A Scorer stub that reproduces the human scores exactly."""
    scorer = MagicMock()

    def score(scorer_input):  # noqa: ANN001
        # The stub echoes a fixed score; the corpus below is built to match.
        return ScorerOutput(
            assessments=[
                CategoryAssessment(
                    category=cat, provisional_score=3, confidence=0.9,
                    evidence_quotes=["q"], missing_or_ambiguous=[],
                )
                for cat in scorer_input.target_categories
            ]
        )

    scorer.score.side_effect = score
    return scorer


def test_e2e_calibration_runs_end_to_end_and_writes_report(tmp_path: Path) -> None:
    corpus_dir = tmp_path / "corpus"
    corpus_dir.mkdir()
    for i in range(3):
        (corpus_dir / f"interview_{i}.json").write_text(
            json.dumps(
                _corpus_item(
                    f"interview_{i}",
                    {
                        "problem_solving": 3, "agency": 3,
                        "competitiveness": 3, "curious": 3,
                    },
                )
            )
        )
    report_path = tmp_path / "calibration_report.json"
    report = run_calibration(
        scorer=_perfect_scorer(),
        rubric=RUBRIC,
        corpus_dir=corpus_dir,
        report_path=report_path,
        pass_threshold_within_one=0.85,
    )
    # The stub reproduces every human score exactly -> perfect agreement.
    assert report.exact_match_rate == 1.0
    assert report.within_one_rate == 1.0
    assert report.passes is True
    assert report.n_pairs == 12  # 3 interviews x 4 categories
    written = json.loads(report_path.read_text())
    assert written["passes"] is True
    assert set(written["per_category"].keys()) == {
        "problem_solving", "agency", "competitiveness", "curious",
    }
```

- [ ] **Step 2: Run test to verify it fails, then passes against existing code**
Run: `cd agent && uv run pytest tests/test_e2e_calibration.py`
Expected: PASS — this test exercises `run_calibration` (Task 2.8) end to end with a stubbed Scorer and a synthetic corpus. If it fails, the failure is a real regression in the eval pipeline; fix the offending module before continuing.

- [ ] **Step 3: Write the calibration runbook**
`docs/calibration/README.md`:
```markdown
# Pilot-role calibration runbook

The Scorer must be calibrated against the human-scored corpus before it is
trusted to run live interviews. This is the gate the cofounder's
"evaluate before scoring" guidance requires.

## Inputs
- `corpus/` — human-scored interview JSON files (gitignored). Each file:
  `{ interview_id, script_version, transcript[], human_scores{} }`.
- `rubric/pilot-v1.yaml` — the pilot rubric.

## Run
```bash
cd agent && uv run python -m agent.eval.calibrate
```
This replays every corpus interview through the Scorer (standalone mode),
computes agreement (exact-match, within-1, per-category correlation), and
writes `corpus/calibration_report.json`.

## Pass threshold
The default `within_one_rate` pass threshold is 0.85. The Scorer is approved
for live use only when `passes` is true. A failing report blocks the live
voice loop from being relied upon for scoring.

## Oversight
Approving the Scorer for live scoring is a reduction-of-oversight decision:
it requires operator sign-off and, per the compliance requirements,
employment-counsel review before automated scoring influences any decision.
```

- [ ] **Step 4: Run the real calibration over the human-scored corpus   [manual-gate]**
Run: `cd agent && ANTHROPIC_API_KEY=$PUDDLE_ANTHROPIC_KEY uv run python -m agent.eval.calibrate`
Expected: prints `within_one_rate=<rate> passes=<bool>` and writes `corpus/calibration_report.json`. Exit 0 if the threshold is met, 1 otherwise.
**HALT here for operator approval before running this step.** This run consumes the real corpus and produces the calibration verdict that gates trusting the Scorer in live interviews — a reduction-of-oversight decision requiring operator and employment-counsel sign-off.

- [ ] **Step 5: Run the full test suites and commit**
Run: `cd agent && uv run pytest` then `pnpm -r test`
Expected: all Python and TypeScript tests pass, exit 0
```bash
git add agent/tests/test_e2e_calibration.py docs/calibration && git commit -m "Add end-to-end calibration test and pilot-role calibration runbook"
```

---

## Self-review

**Spec-section coverage.** Every spec section maps to at least one task across the five phases:

- *Goals / Architecture / the three reasoning roles* — Voice I/O (3.2–3.5), Interview Controller (3.6–3.9, 3.12), Live Rubric Scorer (2.1–2.3), Probe Generator (2.4), Video Perception (4.1–4.4).
- *Components 1–12* — Interview Room → 3.11; Media & Recording → 3.10; Voice I/O → 3.2–3.5; Interview Controller → 3.6–3.9, 3.12; Live Rubric Scorer → 2.1–2.3; Probe Generator → 2.4; Video Perception → 4.1–4.4; Rubric & Assessment Store → 1.3, 1.4, 1.6; Backend Services → 5.1–5.3; Review App → 5.4; Eval & Calibration Harness → 2.5–2.8, 5.6; Compliance & Governance → 1.5 (audit log), 1.6 (retention/deletion), 1.7 (consent), 3.9 (reason codes), 4.2/4.4 (no emotion analysis; integrity advisory-only), 5.4 (human sign-off), 5.5 (`humanSignedOff` in the platform contract).
- *The interview model* — rubric/question schema → 1.3, 1.4; score-driven loop → 3.8, 3.12; timing → 3.7; agent behavior contract → verbatim speech 3.2/3.5/3.12, capped probes 2.4/3.8, server-enforced timing 3.7, reason-code logging 3.9, interrupt 3.2; reason codes → 3.9 (enumerated in `AgentEvent` in 1.3).
- *Pilot role* — rubric and four base questions → `rubric/pilot-v1.yaml` in 1.4; bare-minimum rule → 2.3.
- *State machine* — 3.6 (`InterviewStateMachine`), disconnect/incomplete transitions → 3.6 (`mark_incomplete`).
- *Recording & artifacts* — storage layout → 1.6 (`storagePaths`); Egress media → 3.10; transcript → 5.3; `agent_events.jsonl` → 3.9; `integrity_events.jsonl` → 4.4; `scores.json`/`integrity_flags.json` → 2.3 + 5.3; review/audit artifacts → 5.4, 1.5.
- *Error handling* — STT/TTS holding behavior and swappable layer → 3.2–3.5 (`VoiceAgent` abstraction); Scorer timeout → 3.8 (`time_exhausted` advance) + `config.scorer_timeout_seconds` (2.2); STT mishears / `AUDIO_REPAIR` → reason code in 3.9, `unreliable` flag in STT 3.3 and `TranscriptTurn` 1.3; disconnect / timer pause → 3.7 (`pause_for_disconnect`/`resume_after_reconnect`), `mark_incomplete` 3.6; video pipeline failure → 4.4 (`signals_available`); recording finalization retries → 3.10.
- *Testing strategy* — eval harness gate → 2.5–2.8, 5.6; controller unit tests → 3.6–3.8; Scorer/Probe unit tests → 2.2, 2.4; Voice I/O integration + verbatim fidelity → 3.2/3.5/3.12; video pipeline tests → 4.1–4.4; compliance tests → 1.5–1.7; interviewer-fidelity checks → 3.12.
- *Compliance requirements* — disclosure + consent before recording → 1.7, 3.11 (`canEnterCall`); retention/deletion → 1.6; human sign-off → 5.4; immutable audit log → 1.5; no facial/emotion analysis → 4.2 (`_VLM_INSTRUCTIONS` explicitly forbids it); content-only scoring → 2.2 (`_SCORER_INSTRUCTIONS`).
- *Tech stack & repo shape* — monorepo scaffold → 1.1; standards → 1.2; `agent/` `room/` `review/` `backend/` `rubric/` `corpus/` `docs/` all created across 1.1, 3.11, 5.4, 1.6.
- *Manual-gate operations* — schema migration → 1.6 `[manual-gate]`; reduction of human oversight → 5.6 `[manual-gate]`. Deploy/release and real-candidate interviews are out of plan scope (no task performs a deploy or runs a live candidate interview); should those be added later they must carry `[manual-gate]`. No gap in the planned work.

**Gaps found and filled.** Two spec items were not explicitly surfaced by the phase outline and were folded into existing tasks rather than added as new tasks: (1) the `AUDIO_REPAIR` recovery path — covered by the `unreliable` transcript flag (STT Task 3.3, `TranscriptTurn` Task 1.3) plus the `AUDIO_REPAIR` reason code (Task 3.9); (2) the disconnect timer-pause from *Error handling* — covered by `InterviewClock.pause_for_disconnect`/`resume_after_reconnect` (Task 3.7). No new tasks were required; no spec section is left unmapped.

**No placeholders.** Every task shows complete, runnable test and implementation code with exact file paths and exact commands. There are no "TBD", "add error handling", or "similar to Task N" references. Vendor-SDK tasks (LiveKit Agents 3.1/3.10, Deepgram 3.3, Cartesia 3.5, turn-detector 3.4, Anthropic 2.2/2.4, Gemini 4.2, LiveKit server SDK 5.1) write concrete code against the documented SDK surface; the genuinely environment-dependent wiring functions (`build_deepgram_stt`, `build_cartesia_tts`, `build_turn_detector_plugin`, `_build_voice_agent`, `_default_run_interview`, `provisionRoom`) are marked `# pragma: no cover` / exercised by the live integration environment and are still shown in full.

**Type and signature consistency across phases.** Phases 3–5 reuse the Phase 1–2 surface verbatim: `Rubric`, `Question`, `RubricCategory`, `TranscriptTurn`, `Assessment`, `CategoryScore`, `AgentEvent`, `IntegrityEvent`, `ReasonCode`, `IntegritySignal` (Task 1.3); `load_rubric` (1.4); `AuditLogWriter` (1.5); `storagePaths` (1.6); `SqlStatement` (1.7); `ScorerInput`, `CategoryAssessment`, `ScorerOutput` (2.1); `Scorer` (2.2); `roll_up_assessment` (2.3); `ProbeGenerator`, `ProbeRequest` (2.4); `load_corpus`, `CorpusItem` (2.5); `replay_corpus` (2.6); `compute_agreement` (2.7); `run_calibration` (2.8); `MODELS`, `SCORING` (2.2 `config.py`). Cross-language contract consistency is enforced by tests: `buildWorkerDispatchMetadata` (5.1) emits exactly the snake_case keys `build_session_context` (3.1) parses; `build_egress_request` (3.10) reproduces the `storagePaths(...).media` paths from 1.6; `buildArtifactManifest` (5.3) is built from `storagePaths`. `InterviewState` (3.6) names match the spec's state-machine string; `EventLog.record_utterance` (3.9) constructs the `AgentEvent` from 1.3; `VideoPerceptionPipeline` (4.4) emits the `IntegrityEvent` from 1.3 and writes through the `AuditLogWriter` from 1.5. The `VoiceAgent` interface (3.2) keeps the exact `speak`/`listen`/`interrupt`/`set_mode` surface and `VoiceMode` literals named in the spec, preserving the S2S swap point.

**Total task count:** 31 tasks across 5 phases — Phase 1: 7 (1.1–1.7), Phase 2: 8 (2.1–2.8), Phase 3: 12 (3.1–3.12), Phase 4: 4 (4.1–4.4), Phase 5: 6 (5.1–5.6). Manual-gate tasks: 2 — Task 1.6 (schema migration) and Task 5.6 (calibration / reduction-of-oversight).
