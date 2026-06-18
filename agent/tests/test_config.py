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
    monkeypatch.setenv("PUDDLE_GUARDRAIL_MODEL", "claude-haiku-4-5")
    monkeypatch.setenv("PUDDLE_REALTIME_MAX_SESSION_SECONDS", "3600")

    cfg = RealtimeConfig()
    assert cfg.enabled is False
    assert cfg.model == "gpt-4-turbo"
    assert cfg.guardrail_model == "claude-haiku-4-5"
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


def test_realtime_config_clamps_nonpositive_max_session_seconds(monkeypatch: pytest.MonkeyPatch) -> None:
    """Non-positive max_session_seconds clamps to default 1800.0 — no exception."""
    monkeypatch.delenv("PUDDLE_USE_REALTIME", raising=False)
    monkeypatch.delenv("PUDDLE_REALTIME_MODEL", raising=False)
    monkeypatch.delenv("PUDDLE_GUARDRAIL_MODEL", raising=False)

    for bad in ("0", "-5", "-1.5"):
        monkeypatch.setenv("PUDDLE_REALTIME_MAX_SESSION_SECONDS", bad)
        cfg = RealtimeConfig()
        assert cfg.max_session_seconds == 1800.0, f"Expected clamp for value {bad!r}"


def test_realtime_config_clamps_nonfloat_max_session_seconds(monkeypatch: pytest.MonkeyPatch) -> None:
    """Non-float max_session_seconds clamps to default 1800.0 — no exception."""
    monkeypatch.delenv("PUDDLE_USE_REALTIME", raising=False)
    monkeypatch.delenv("PUDDLE_REALTIME_MODEL", raising=False)
    monkeypatch.delenv("PUDDLE_GUARDRAIL_MODEL", raising=False)
    monkeypatch.setenv("PUDDLE_REALTIME_MAX_SESSION_SECONDS", "not-a-number")

    cfg = RealtimeConfig()
    assert cfg.max_session_seconds == 1800.0


def test_realtime_config_valid_max_session_seconds_override(monkeypatch: pytest.MonkeyPatch) -> None:
    """A valid positive float env var is parsed and used directly."""
    monkeypatch.delenv("PUDDLE_USE_REALTIME", raising=False)
    monkeypatch.delenv("PUDDLE_REALTIME_MODEL", raising=False)
    monkeypatch.delenv("PUDDLE_GUARDRAIL_MODEL", raising=False)
    monkeypatch.setenv("PUDDLE_REALTIME_MAX_SESSION_SECONDS", "600")

    cfg = RealtimeConfig()
    assert cfg.max_session_seconds == 600.0
