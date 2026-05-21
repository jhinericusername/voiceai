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
