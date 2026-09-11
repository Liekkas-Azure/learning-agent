"""POST /api/v1/wiki/{name}/reading-companion"""

from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.main import app


def test_reading_companion_ok(monkeypatch):
    import app.main as main_mod

    monkeypatch.setattr(
        main_mod,
        "generate_reading_companion",
        MagicMock(return_value=("## 伴读\n- 要点", "ark")),
    )
    client = TestClient(app)
    res = client.post(
        "/api/v1/wiki/foo.md/reading-companion",
        json={
            "section_title": "概述",
            "section_text": "正文一段",
            "doc_title": "foo.pdf",
            "corpus": [{"file_name": "b.pdf", "summary": "另一篇摘要"}],
            "extracted_raw": "全文抽取示例",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert "伴读" in data["companion_markdown"]
    assert data["provider"] == "ark"
    main_mod.generate_reading_companion.assert_called_once()
    kw = main_mod.generate_reading_companion.call_args.kwargs
    assert "全文" in kw.get("full_raw_excerpt", "")


def test_reading_companion_stream_sse(monkeypatch):
    import app.main as main_mod

    def fake_iter(**_kwargs):
        yield b'data: {"type":"meta","provider":"ark"}\n\n'
        yield b'data: {"type":"delta","text":"## "}\n\n'
        yield b'data: {"type":"done"}\n\n'

    monkeypatch.setattr(main_mod, "iter_reading_companion_sse", fake_iter)
    client = TestClient(app)
    res = client.post(
        "/api/v1/wiki/foo.md/reading-companion/stream",
        json={"section_title": "A", "section_text": "B", "doc_title": "foo", "corpus": []},
    )
    assert res.status_code == 200
    assert "text/event-stream" in res.headers.get("content-type", "")
    body = res.text
    assert "meta" in body and "delta" in body and "done" in body
