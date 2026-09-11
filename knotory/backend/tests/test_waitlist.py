import uuid

from fastapi.testclient import TestClient

from app.main import app


def test_waitlist_join_and_duplicate():
    email = f"waitlist-{uuid.uuid4().hex[:8]}@example.com"
    with TestClient(app) as client:
        res = client.post("/api/v1/waitlist", json={"email": email, "source": "pytest"})
        assert res.status_code == 200
        body = res.json()
        assert body["ok"] is True
        assert body["duplicate"] is False

        res2 = client.post("/api/v1/waitlist", json={"email": email})
        assert res2.status_code == 200
        assert res2.json()["duplicate"] is True
