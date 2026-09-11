"""GET /api/v1/wiki/{name}/reading-companions"""

from fastapi.testclient import TestClient

from app.main import app


def test_reading_companions_bundle(monkeypatch):
    import app.main as main_mod

    monkeypatch.setattr(
        main_mod,
        "build_companion_bundle_payload",
        lambda _n: {
            "wiki_file_name": "x.md",
            "items": [
                {
                    "section_id": "wiki-sec-a",
                    "section_title": "A",
                    "status": "ok",
                    "companion_markdown": "## 伴读",
                    "provider": "ark",
                    "error_message": None,
                    "updated_at": "2026-01-01T00:00:00",
                },
            ],
            "any_pending": False,
        },
    )
    monkeypatch.setattr(main_mod, "maybe_kick_background_refresh", lambda *_a, **_kw: None)
    client = TestClient(app)
    res = client.get("/api/v1/wiki/x.md/reading-companions")
    assert res.status_code == 200
    data = res.json()
    assert data["wiki_file_name"] == "x.md"
    assert data["items"][0]["status"] == "ok"
    assert "伴读" in (data["items"][0]["companion_markdown"] or "")
