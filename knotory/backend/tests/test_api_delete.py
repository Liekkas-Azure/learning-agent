from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.main import app


def test_delete_record_success(monkeypatch):
    rec = SimpleNamespace(
        id=3,
        file_name="Note.pdf",
        status="ok",
        summary="s",
        tags_csv="a,b",
        created_at=SimpleNamespace(isoformat=lambda: "2026-01-01T00:00:00"),
    )
    monkeypatch.setattr("app.main.get_record_by_id", lambda rid: rec if rid == 3 else None)
    monkeypatch.setattr("app.main.delete_caches_for_ingest_record", MagicMock(return_value=1))
    monkeypatch.setattr("app.main.delete_raw_artifacts", MagicMock())
    monkeypatch.setattr("app.main.delete_record_by_id", lambda rid: rid == 3)
    monkeypatch.setattr("app.main.delete_document", MagicMock())

    with TestClient(app) as client:
        res = client.delete("/api/v1/records/3")

    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["id"] == 3
    assert body["removed_base"] == "Note"


def test_delete_record_not_found(monkeypatch):
    monkeypatch.setattr("app.main.get_record_by_id", lambda _rid: None)

    with TestClient(app) as client:
        res = client.delete("/api/v1/records/99999")

    assert res.status_code == 404


def test_list_records(monkeypatch):
    r1 = SimpleNamespace(
        id=1,
        file_name="a.md",
        status="ok",
        summary="x",
        tags_csv="t1,t2",
        created_at=SimpleNamespace(isoformat=lambda: "2026-01-01"),
    )
    monkeypatch.setattr("app.main.list_records", lambda limit=40: [r1])

    with TestClient(app) as client:
        res = client.get("/api/v1/records")

    assert res.status_code == 200
    rows = res.json()
    assert len(rows) == 1
    assert rows[0]["id"] == 1
    assert rows[0]["tags"] == ["t1", "t2"]
