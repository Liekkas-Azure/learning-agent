import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.main import app
from app.models import KnowledgeFlashcard
from app.storage import engine, init_db


def test_srs_review_updates_state():
    init_db()
    suffix = uuid.uuid4().hex[:8]
    with Session(engine) as session:
        session.add(
            KnowledgeFlashcard(
                content_key=f"test:srs:{suffix}",
                topic="测试",
                front_text="Q?",
                back_text="A" * 20,
                source_title="t.md",
            )
        )
        session.commit()
        row = session.exec(
            select(KnowledgeFlashcard).where(KnowledgeFlashcard.content_key == f"test:srs:{suffix}")
        ).first()
        assert row is not None and row.id is not None
        card_id = row.id

    with TestClient(app) as client:
        res = client.post(f"/api/v1/flashcards/{card_id}/review", json={"rating": 2})
        assert res.status_code == 200
        body = res.json()
        assert body["ok"] is True
        assert body["flashcard_id"] == card_id
        assert body["interval_days"] >= 1
        assert "next_review_at" in body


def test_exam_returns_cards_for_wiki():
    init_db()
    suffix = uuid.uuid4().hex[:8]
    wiki = f"exam-wiki-{suffix}.md"
    with Session(engine) as session:
        session.add(
            KnowledgeFlashcard(
                content_key=f"test:exam:{suffix}",
                topic="测验",
                front_text="Q?",
                back_text="A" * 20,
                wiki_file_name=wiki,
                source_title=wiki,
            )
        )
        session.commit()

    with TestClient(app) as client:
        res = client.get(f"/api/v1/flashcards/exam?wiki_file_name={wiki}&limit=5")
        assert res.status_code == 200
        body = res.json()
        assert body["count"] >= 1
        assert body["items"][0]["wiki_file_name"] == wiki
