import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.storage import init_db


def test_srs_calendar_api():
    init_db()
    with TestClient(app) as client:
        res = client.get("/api/v1/flashcards/srs/calendar?days=7")
        assert res.status_code == 200
        body = res.json()
        assert body["days"] == 7
        assert len(body["items"]) == 8


def test_srs_trend_api():
    init_db()
    with TestClient(app) as client:
        res = client.get("/api/v1/flashcards/srs/trend?top_n=5")
        assert res.status_code == 200
        body = res.json()
        assert "mastery" in body
        assert "due_summary" in body


def test_contradictions_api():
    init_db()
    with TestClient(app) as client:
        res = client.get("/api/v1/contradictions?limit=5")
        assert res.status_code == 200
        assert "items" in res.json()


def test_corpus_search_hybrid_mode():
    init_db()
    with TestClient(app) as client:
        res = client.get("/api/v1/corpus/search", params={"q": "测试", "mode": "hybrid", "limit": 5})
        assert res.status_code == 200
        body = res.json()
        assert body["query"] == "测试"
        assert "items" in body


def test_chat_rag_api_no_hits():
    init_db()
    with TestClient(app) as client:
        res = client.post("/api/v1/chat/rag", json={"query": "xyznonexistentquery12345"})
        assert res.status_code == 200
        assert "answer" in res.json()


def test_agent_feedback_updates_policy_state_and_memory(monkeypatch):
    from app import contextual_bandit, student_state, wiki_memory

    recorded: list[tuple[str, float, str]] = []
    observed: list[dict] = []
    monkeypatch.setattr(
        contextual_bandit,
        "record_reward",
        lambda action, reward, context_key="": recorded.append(
            (action, reward, context_key)
        ),
    )
    monkeypatch.setattr(
        student_state,
        "observe_concept",
        lambda concept, **kwargs: observed.append(
            {"concept": concept, **kwargs}
        ),
    )
    monkeypatch.setattr(
        wiki_memory,
        "reflect_and_write",
        lambda **kwargs: {"written": True, "value_score": 0.9},
    )

    with TestClient(app) as client:
        res = client.post(
            "/api/v1/agent/action-feedback",
            json={
                "action": "rag_clarify",
                "reward": 1,
                "context_key": "贝叶斯推断",
            },
        )
    assert res.status_code == 200
    assert res.json()["memory_write"]["written"] is True
    assert recorded == [("rag_clarify", 1.0, "贝叶斯推断")]
    assert observed[0]["concept"] == "贝叶斯推断"
    assert observed[0]["correct"] is True
