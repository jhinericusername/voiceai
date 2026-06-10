from types import SimpleNamespace
from unittest.mock import MagicMock

from agent.voice.session import build_agent_session


def test_build_agent_session_wires_vad_and_turn_detection(monkeypatch) -> None:  # noqa: ANN001
    captured = {}

    def fake_agent_session(**kwargs):  # noqa: ANN003
        captured.update(kwargs)
        return SimpleNamespace(**kwargs)

    # AgentSession is imported inside the function from livekit.agents.
    import livekit.agents as lk_agents

    monkeypatch.setattr(lk_agents, "AgentSession", fake_agent_session)

    stt, tts, vad = MagicMock(), MagicMock(), MagicMock()
    build_agent_session(stt=stt, tts=tts, vad=vad)

    assert captured["vad"] is vad, "VAD must be wired into the production session"
    assert captured["stt"] is stt
    assert captured["tts"] is tts
    assert captured["llm"] is None
    assert captured["turn_detection"] == "vad"
