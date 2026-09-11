"""Tests for LLM-only extraction helpers (parsing, normalization, orchestration)."""

from unittest.mock import MagicMock, patch

import pytest

from app.llm import (
    ExtractionNotConfiguredError,
    _coerce_llm_payload,
    _openai_client_and_model,
    _parse_llm_json_object,
    extract_with_llm,
    normalize_llm_tags,
)


def test_normalize_llm_tags_dedupes_case():
    assert normalize_llm_tags(["API", "api", "Rest"]) == ["api", "rest"]


def test_parse_llm_json_with_markdown_fence():
    raw = '```json\n{"summary":"Hi","tags":["a","b"],"insights":[]}\n```'
    parsed = _parse_llm_json_object(raw)
    assert parsed["tags"] == ["a", "b"]


def test_coerce_llm_payload_types():
    out = _coerce_llm_payload(
        {"summary": 123, "tags": "singleton", "insights": "one"}
    )
    assert isinstance(out["summary"], str)
    assert out["tags"] == ["singleton"]
    assert out["insights"] == ["one"]


def test_coerce_llm_payload_splits_comma_tags():
    out = _coerce_llm_payload(
        {"summary": "x", "tags": "foo, Bar, 中文", "insights": []}
    )
    assert out["tags"] == ["foo", "bar", "中文"]
    assert out["insights"] == []


def test_openai_client_raises_without_any_key(monkeypatch):
    import app.config as config

    monkeypatch.setattr(config.settings, "ark_api_key", None)
    monkeypatch.setattr(config.settings, "cloud_api_key", None)
    with pytest.raises(ExtractionNotConfiguredError):
        _openai_client_and_model()


def test_extract_with_llm_calls_chat_and_returns_provider():
    fake_json = '{"summary":"S","tags":["x","y"],"insights":[]}'
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = MagicMock(
        choices=[MagicMock(message=MagicMock(content=fake_json))]
    )
    with patch(
        "app.llm._openai_client_and_model",
        return_value=(mock_client, "doubao-model", "ark"),
    ):
        body, prov = extract_with_llm("Some document text about Kubernetes.")
    assert prov == "ark"
    assert body["summary"] == "S"
    assert body["tags"] == ["x", "y"]
    mock_client.chat.completions.create.assert_called_once()


def test_extract_empty_body_skips_chat():
    mock_client = MagicMock()
    with patch(
        "app.llm._openai_client_and_model",
        return_value=(mock_client, "m", "cloud"),
    ):
        body, prov = extract_with_llm("  \n  ")
    assert prov == "cloud"
    assert body["tags"] == []
    mock_client.chat.completions.create.assert_not_called()
