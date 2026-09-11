"""多租户注册登录与数据隔离。"""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.storage import init_db, list_records, save_record
from app.tenant import clear_tenant, set_tenant


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("KNOTORY_AUTH_REQUIRED", "true")
    monkeypatch.setenv("KNOTORY_JWT_SECRET", "test-secret-for-pytest-only")
    from app import config as cfg

    cfg.settings.auth_required = True
    cfg.settings.jwt_secret = "test-secret-for-pytest-only"
    init_db()
    return TestClient(app)


def test_register_login_and_scoped_records(client: TestClient):
    run_id = uuid4().hex
    email_a = f"user_a_{run_id}@test.local"
    email_b = f"user_b_{run_id}@test.local"
    reg_a = client.post("/api/v1/auth/register", json={"email": email_a, "password": "password123"})
    assert reg_a.status_code == 200, reg_a.text
    token_a = reg_a.json()["token"]

    reg_b = client.post("/api/v1/auth/register", json={"email": email_b, "password": "password123"})
    assert reg_b.status_code == 200, reg_b.text
    token_b = reg_b.json()["token"]

    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    set_tenant(user_id=reg_a.json()["user"]["id"], email=email_a)
    save_record("a.pdf", "/a", "summary a", ["tag"])
    clear_tenant()

    set_tenant(user_id=reg_b.json()["user"]["id"], email=email_b)
    save_record("b.pdf", "/b", "summary b", ["tag"])
    clear_tenant()

    list_a = client.get("/api/v1/records", headers=headers_a)
    assert list_a.status_code == 200
    names_a = {r["file_name"] for r in list_a.json()}
    assert "a.pdf" in names_a
    assert "b.pdf" not in names_a

    list_b = client.get("/api/v1/records", headers=headers_b)
    assert list_b.status_code == 200
    names_b = {r["file_name"] for r in list_b.json()}
    assert "b.pdf" in names_b
    assert "a.pdf" not in names_b


def test_api_requires_auth_when_enabled(client: TestClient):
    res = client.get("/api/v1/records")
    assert res.status_code == 401
