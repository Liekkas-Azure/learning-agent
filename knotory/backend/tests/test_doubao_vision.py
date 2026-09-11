"""豆包多模态识图：无 Key 行为与 HTTP 成功路径（mock）。"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from unittest.mock import patch

import pytest

PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class _FakeSettings:
    resolved_ark_api_key: str | None = None
    resolved_ark_vision_model = "doubao-test"
    resolved_ark_chat_completions_url = "https://ark.example.com/api/v3/chat/completions"


@pytest.fixture
def tiny_png(tmp_path: Path) -> Path:
    p = tmp_path / "probe.png"
    p.write_bytes(PNG_1X1)
    return p


def test_transcribe_no_api_key_returns_empty(tiny_png: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import app.doubao as doubao

    fake = _FakeSettings()
    fake.resolved_ark_api_key = None
    monkeypatch.setattr(doubao, "settings", fake)

    assert doubao.transcribe_image(tiny_png) == ""


def test_transcribe_success_parses_choice_message(tiny_png: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import app.doubao as doubao

    fake = _FakeSettings()
    fake.resolved_ark_api_key = "fake-key-for-test"
    monkeypatch.setattr(doubao, "settings", fake)

    body = {
        "choices": [{"message": {"content": "  测试转写结果  \n"}}],
        "usage": {"total_tokens": 10},
    }

    class _Resp:
        def __enter__(self) -> _Resp:
            return self

        def __exit__(self, *a: object) -> None:
            return None

        def read(self) -> bytes:
            return json.dumps(body).encode("utf-8")

    def _fake_urlopen(req: object, timeout: int = 0) -> _Resp:  # noqa: ARG001
        assert hasattr(req, "full_url")
        return _Resp()

    with patch("app.doubao.urllib.request.urlopen", _fake_urlopen):
        out = doubao.transcribe_image(tiny_png)

    assert out == "测试转写结果"


def test_vision_transcribe_image_delegates_to_doubao(tiny_png: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import app.doubao as doubao
    from app.llm import vision_transcribe_image

    fake = _FakeSettings()
    fake.resolved_ark_api_key = "k"
    monkeypatch.setattr(doubao, "settings", fake)

    body = {"choices": [{"message": {"content": "delegated"}}]}

    class _Resp:
        def __enter__(self) -> _Resp:
            return self

        def __exit__(self, *a: object) -> None:
            return None

        def read(self) -> bytes:
            return json.dumps(body).encode("utf-8")

    with patch("app.doubao.urllib.request.urlopen", lambda *a, **k: _Resp()):
        assert vision_transcribe_image(tiny_png) == "delegated"


def test_parser_image_branch_requires_ark_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app import parser

    class _NoArk:
        ocr_enabled = True

        @property
        def resolved_ark_api_key(self) -> None:
            return None

        @property
        def resolved_cloud_api_key(self) -> None:
            return None

    monkeypatch.setattr("app.config.settings", _NoArk())

    p = tmp_path / "x.source"
    p.write_bytes(PNG_1X1)

    msg = parser.extract_text(p, original_filename="a.png")
    assert "ARK_API_KEY" in msg or "DOUBAO_API_KEY" in msg
