import pytest

from agent.config import RealtimeConfig


def test_realtime_config_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test RealtimeConfig with no environment variables set."""
    monkeypatch.delenv("PUDDLE_USE_REALTIME", raising=False)
    monkeypatch.delenv("PUDDLE_REALTIME_MODEL", raising=False)
    monkeypatch.delenv("PUDDLE_GUARDRAIL_MODEL", raising=False)
    monkeypatch.delenv("PUDDLE_REALTIME_MAX_SESSION_SECONDS", raising=False)

    cfg = RealtimeConfig()
    assert cfg.enabled is False
    assert cfg.model == "gpt-realtime"
    assert cfg.guardrail_model == "claude-haiku-4-5"
    assert cfg.max_session_seconds == 1800.0


def test_realtime_config_enabled_via_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test RealtimeConfig enabled when PUDDLE_USE_REALTIME is set."""
    monkeypatch.setenv("PUDDLE_USE_REALTIME", "true")
    monkeypatch.delenv("PUDDLE_REALTIME_MODEL", raising=False)
    monkeypatch.delenv("PUDDLE_GUARDRAIL_MODEL", raising=False)
    monkeypatch.delenv("PUDDLE_REALTIME_MAX_SESSION_SECONDS", raising=False)

    cfg = RealtimeConfig()
    assert cfg.enabled is True
    assert cfg.model == "gpt-realtime"
    assert cfg.guardrail_model == "claude-haiku-4-5"
    assert cfg.max_session_seconds == 1800.0


def test_realtime_config_custom_models(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test RealtimeConfig with custom model overrides."""
    monkeypatch.delenv("PUDDLE_USE_REALTIME", raising=False)
    monkeypatch.setenv("PUDDLE_REALTIME_MODEL", "gpt-4-turbo")
    monkeypatch.setenv("PUDDLE_GUARDRAIL_MODEL", "claude-opus-4-1")
    monkeypatch.setenv("PUDDLE_REALTIME_MAX_SESSION_SECONDS", "3600")

    cfg = RealtimeConfig()
    assert cfg.enabled is False
    assert cfg.model == "gpt-4-turbo"
    assert cfg.guardrail_model == "claude-opus-4-1"
    assert cfg.max_session_seconds == 3600.0


def test_bool_env_various_truthy_values(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that _bool_env handles various truthy values."""
    test_values = ["1", "true", "True", "TRUE", "yes", "Yes", "y", "Y", "on", "On"]
    for val in test_values:
        monkeypatch.setenv("PUDDLE_USE_REALTIME", val)
        cfg = RealtimeConfig()
        assert cfg.enabled is True, f"Failed for value: {val}"

    # Test falsy values
    falsy_values = ["0", "false", "no", "off", "", "anything_else"]
    for val in falsy_values:
        monkeypatch.setenv("PUDDLE_USE_REALTIME", val)
        cfg = RealtimeConfig()
        assert cfg.enabled is False, f"Failed for value: {val}"
