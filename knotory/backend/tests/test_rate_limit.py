from fastapi.testclient import TestClient

from app.main import app


def test_waitlist_rate_limit_returns_429(monkeypatch):
    monkeypatch.setattr("app.config.settings.waitlist_rate_limit_per_minute", 2)
    with TestClient(app) as client:
        for i in range(2):
            res = client.post("/api/v1/waitlist", json={"email": f"rate{i}@example.com"})
            assert res.status_code == 200, res.text
        blocked = client.post("/api/v1/waitlist", json={"email": "rate3@example.com"})
    assert blocked.status_code == 429
