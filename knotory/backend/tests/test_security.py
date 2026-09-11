from fastapi.testclient import TestClient

from app.main import app


def test_health_is_public_when_api_key_set(monkeypatch):
    monkeypatch.setattr("app.config.settings.api_key", "secret-key")
    with TestClient(app) as client:
        res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body.get("api_auth_required") is True


def test_api_requires_bearer_when_key_configured(monkeypatch):
    monkeypatch.setattr("app.config.settings.api_key", "secret-key")
    with TestClient(app) as client:
        denied = client.get("/api/v1/wiki")
        assert denied.status_code == 401
        ok = client.get("/api/v1/wiki", headers={"Authorization": "Bearer secret-key"})
    assert ok.status_code == 200


def test_api_open_when_key_not_configured(monkeypatch):
    monkeypatch.setattr("app.config.settings.api_key", None)
    with TestClient(app) as client:
        res = client.get("/api/v1/wiki")
    assert res.status_code == 200
