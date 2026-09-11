import uuid

from sqlmodel import Session, select

from app.flashcard_srs import ensure_review_states
from app.models import KnowledgeFlashcard
from app.srs_analytics import due_calendar, mastery_trend
from app.storage import engine, init_db


def test_due_calendar_structure():
    init_db()
    days = due_calendar(days=7)
    assert len(days) == 8
    assert all("date" in d and "due_count" in d for d in days)


def test_mastery_trend_with_card():
    init_db()
    suffix = uuid.uuid4().hex[:8]
    with Session(engine) as session:
        card = KnowledgeFlashcard(
            content_key=f"test:trend:{suffix}",
            topic="趋势测试",
            front_text="Q?",
            back_text="A" * 20,
            source_title="t.md",
        )
        session.add(card)
        session.commit()
        session.refresh(card)
        assert card.id is not None
        ensure_review_states([card])

    trend = mastery_trend(top_n=5)
    assert "mastery" in trend
    assert "due_summary" in trend
    assert "overdue" in trend["due_summary"]
    assert isinstance(trend["mastery"], list)
