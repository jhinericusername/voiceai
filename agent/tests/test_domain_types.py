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
