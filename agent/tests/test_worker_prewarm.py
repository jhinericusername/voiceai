from types import SimpleNamespace

from agent.worker.entrypoint import prewarm


def test_prewarm_loads_vad_into_userdata(monkeypatch) -> None:  # noqa: ANN001
    sentinel = object()

    import livekit.plugins.silero as silero

    monkeypatch.setattr(silero.VAD, "load", staticmethod(lambda *a, **k: sentinel))

    proc = SimpleNamespace(userdata={})
    prewarm(proc)

    assert proc.userdata["vad"] is sentinel
