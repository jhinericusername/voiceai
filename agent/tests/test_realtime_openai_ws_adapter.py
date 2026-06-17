"""Tests for the raw OpenAI websocket adapter (eval transport).

Only PURE parts are exercised: the event-translation functions and the
`events()` queue drain. The network/socket I/O in `start()`, `respond_to_tool()`,
`inject_message()`, and `aclose()` is `# pragma: no cover` in the adapter.
"""
from __future__ import annotations

import pytest

from agent.voice.realtime.interface import (
    InputTranscript,
    OutputTranscript,
    RealtimeSession,
    ToolCall,
)
from agent.voice.realtime.openai_ws_adapter import (
    _END,
    OpenAIWebsocketRealtimeSession,
    _translate_event,
    EventTranslator,
)


# ---------------------------------------------------------------------------
# Pure translation: conversation.item.input_audio_transcription.completed
# ---------------------------------------------------------------------------


def test_translate_input_audio_transcription_completed() -> None:
    ev = {
        "type": "conversation.item.input_audio_transcription.completed",
        "transcript": "I built a distributed cache.",
    }
    translator = EventTranslator()
    result = _translate_event(translator, ev)
    assert result == InputTranscript(text="I built a distributed cache.")


def test_translate_input_audio_transcription_empty_transcript() -> None:
    ev = {
        "type": "conversation.item.input_audio_transcription.completed",
        "transcript": "",
    }
    translator = EventTranslator()
    result = _translate_event(translator, ev)
    assert result == InputTranscript(text="")


def test_translate_input_audio_transcription_missing_transcript_key() -> None:
    ev = {"type": "conversation.item.input_audio_transcription.completed"}
    translator = EventTranslator()
    result = _translate_event(translator, ev)
    assert result == InputTranscript(text="")


# ---------------------------------------------------------------------------
# Pure translation: response.output_text.delta (accumulation) + done
# ---------------------------------------------------------------------------


def test_translate_output_text_delta_returns_none() -> None:
    """Deltas accumulate but do not emit an event yet."""
    ev = {"type": "response.output_text.delta", "delta": "Hello, "}
    translator = EventTranslator()
    result = _translate_event(translator, ev)
    assert result is None


def test_translate_output_text_multiple_deltas_accumulate() -> None:
    translator = EventTranslator()
    _translate_event(translator, {"type": "response.output_text.delta", "delta": "Hello, "})
    _translate_event(translator, {"type": "response.output_text.delta", "delta": "how are "})
    result = _translate_event(translator, {"type": "response.output_text.delta", "delta": "you?"})
    assert result is None
    # Not done yet — no OutputTranscript emitted
    assert translator._output_text_parts == ["Hello, ", "how are ", "you?"]


def test_translate_output_text_done_yields_full_turn() -> None:
    """response.output_text.done emits OutputTranscript with the accumulated text."""
    translator = EventTranslator()
    _translate_event(translator, {"type": "response.output_text.delta", "delta": "Tell me "})
    _translate_event(translator, {"type": "response.output_text.delta", "delta": "about your work."})
    result = _translate_event(translator, {"type": "response.output_text.done", "text": "Tell me about your work."})
    assert result == OutputTranscript(text="Tell me about your work.")


def test_translate_output_text_done_clears_accumulator() -> None:
    """After done, the accumulator is reset for the next turn."""
    translator = EventTranslator()
    _translate_event(translator, {"type": "response.output_text.delta", "delta": "Turn one."})
    _translate_event(translator, {"type": "response.output_text.done", "text": "Turn one."})
    # Second turn
    _translate_event(translator, {"type": "response.output_text.delta", "delta": "Turn two."})
    assert translator._output_text_parts == ["Turn two."]


def test_translate_output_text_done_uses_joined_deltas_as_fallback() -> None:
    """If `text` key missing on done event, fall back to joined delta parts."""
    translator = EventTranslator()
    _translate_event(translator, {"type": "response.output_text.delta", "delta": "Joined "})
    _translate_event(translator, {"type": "response.output_text.delta", "delta": "fallback."})
    result = _translate_event(translator, {"type": "response.output_text.done"})
    assert result == OutputTranscript(text="Joined fallback.")


def test_translate_output_text_done_strips_whitespace() -> None:
    translator = EventTranslator()
    _translate_event(translator, {"type": "response.output_text.delta", "delta": "  spaced  "})
    result = _translate_event(translator, {"type": "response.output_text.done", "text": "  spaced  "})
    assert result == OutputTranscript(text="spaced")


def test_translate_output_text_done_with_no_deltas_uses_text_field() -> None:
    """Done event with no prior deltas: use the `text` field directly."""
    translator = EventTranslator()
    result = _translate_event(translator, {"type": "response.output_text.done", "text": "Direct text."})
    assert result == OutputTranscript(text="Direct text.")


def test_translate_output_text_done_with_no_deltas_no_text_returns_empty() -> None:
    translator = EventTranslator()
    result = _translate_event(translator, {"type": "response.output_text.done"})
    assert result == OutputTranscript(text="")


# ---------------------------------------------------------------------------
# Pure translation: response.function_call_arguments.done
# ---------------------------------------------------------------------------


def test_translate_function_call_arguments_done() -> None:
    ev = {
        "type": "response.function_call_arguments.done",
        "call_id": "call_xyz",
        "name": "advance_question",
        "arguments": '{"next_question_id": "q3"}',
    }
    translator = EventTranslator()
    result = _translate_event(translator, ev)
    assert result == ToolCall(
        call_id="call_xyz",
        name="advance_question",
        arguments={"next_question_id": "q3"},
    )


def test_translate_function_call_arguments_done_empty_arguments() -> None:
    ev = {
        "type": "response.function_call_arguments.done",
        "call_id": "call_1",
        "name": "finish_interview",
        "arguments": "",
    }
    translator = EventTranslator()
    result = _translate_event(translator, ev)
    assert result == ToolCall(call_id="call_1", name="finish_interview", arguments={})


def test_translate_function_call_arguments_done_malformed_arguments() -> None:
    """Malformed JSON falls back to empty dict, no crash."""
    ev = {
        "type": "response.function_call_arguments.done",
        "call_id": "call_2",
        "name": "do_thing",
        "arguments": "{not valid json",
    }
    translator = EventTranslator()
    result = _translate_event(translator, ev)
    assert result == ToolCall(call_id="call_2", name="do_thing", arguments={})


def test_translate_function_call_arguments_done_null_arguments() -> None:
    """None/missing arguments key falls back to empty dict."""
    ev = {
        "type": "response.function_call_arguments.done",
        "call_id": "call_3",
        "name": "probe",
    }
    translator = EventTranslator()
    result = _translate_event(translator, ev)
    assert result == ToolCall(call_id="call_3", name="probe", arguments={})


# ---------------------------------------------------------------------------
# Unknown / irrelevant event types are ignored
# ---------------------------------------------------------------------------


def test_translate_unknown_event_returns_none() -> None:
    translator = EventTranslator()
    result = _translate_event(translator, {"type": "session.created", "session": {}})
    assert result is None


def test_translate_response_done_returns_none() -> None:
    """response.done is a session-lifecycle signal, not a transcript event."""
    translator = EventTranslator()
    result = _translate_event(translator, {"type": "response.done"})
    assert result is None


def test_translate_event_missing_type_returns_none() -> None:
    translator = EventTranslator()
    result = _translate_event(translator, {})
    assert result is None


def test_translate_event_wrong_type_returns_none() -> None:
    translator = EventTranslator()
    result = _translate_event(translator, {"type": "rate_limits.updated"})
    assert result is None


# ---------------------------------------------------------------------------
# events() queue drain
# ---------------------------------------------------------------------------


async def test_events_drains_queue_in_order_until_end_sentinel() -> None:
    session = OpenAIWebsocketRealtimeSession(model="gpt-realtime-preview-2025-06-03")
    scripted = [
        InputTranscript(text="my answer"),
        OutputTranscript(text="agent reply"),
        ToolCall(call_id="c1", name="advance_question", arguments={"next_question_id": "q1"}),
    ]
    for ev in scripted:
        session._emit(ev)
    session._emit(_END)
    # Any event after the sentinel must NOT be yielded.
    session._emit(OutputTranscript(text="after end"))

    collected = [ev async for ev in session.events()]
    assert collected == scripted


async def test_events_stops_at_end_when_empty() -> None:
    session = OpenAIWebsocketRealtimeSession(model="gpt-realtime-preview-2025-06-03")
    session._emit(_END)
    collected = [ev async for ev in session.events()]
    assert collected == []


# ---------------------------------------------------------------------------
# Protocol conformance
# ---------------------------------------------------------------------------


def test_adapter_satisfies_realtime_session_protocol() -> None:
    session = OpenAIWebsocketRealtimeSession(model="gpt-realtime-preview-2025-06-03")
    assert isinstance(session, RealtimeSession)


# ---------------------------------------------------------------------------
# Constructor stores config (no network I/O in __init__)
# ---------------------------------------------------------------------------


def test_constructor_stores_model_and_defaults() -> None:
    session = OpenAIWebsocketRealtimeSession(model="gpt-realtime-preview-2025-06-03")
    assert session._model == "gpt-realtime-preview-2025-06-03"
    assert session._output_modalities == ["text", "audio"]
    assert session._api_key is None


def test_constructor_accepts_custom_modalities_and_api_key() -> None:
    session = OpenAIWebsocketRealtimeSession(
        model="gpt-realtime-preview-2025-06-03",
        api_key="sk-test",
        output_modalities=["text"],
    )
    assert session._api_key == "sk-test"
    assert session._output_modalities == ["text"]
