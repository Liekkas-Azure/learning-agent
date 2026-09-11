from sqlmodel import Session, select

from app.flashcard_feed import build_feed, invalidate_feed_candidates_cache, record_feedback
from app.flashcards import _template_summary_payload, collect_flashcard_payloads, sync_flashcards_from_corpus
from app.models import KnowledgeFlashcard
from app.storage import engine, init_db, save_record


def test_summary_card_payload_shape():
    rec = save_record(
        "paper.pdf",
        "/tmp/paper.pdf",
        "这是一段足够长的摘要内容，用于生成知识闪卡背面文字，涵盖分布式系统、可观测性与知识工程等多个主题要点。",
        ["系统", "可观测性"],
    )
    payload = _template_summary_payload(rec)
    assert payload is not None
    assert payload["topic"] == "系统"
    assert payload["card_kind"] == "summary"


def test_feed_respects_like_on_topic():
    import uuid

    init_db()
    suffix = uuid.uuid4().hex[:8]
    with Session(engine) as session:
        session.add(
            KnowledgeFlashcard(
                content_key=f"test:ai:{suffix}",
                topic="AI",
                front_text="Q1",
                back_text="A1" * 20,
                source_title="a.md",
            )
        )
        session.add(
            KnowledgeFlashcard(
                content_key=f"test:hist:{suffix}",
                topic="历史",
                front_text="Q2",
                back_text="A2" * 20,
                source_title="b.md",
            )
        )
        session.commit()
        hist_row = session.exec(
            select(KnowledgeFlashcard).where(KnowledgeFlashcard.content_key == f"test:hist:{suffix}")
        ).first()
        assert hist_row is not None and hist_row.id is not None
        hist_id = hist_row.id

    session_tag = f"sess-test-{suffix}"
    record_feedback(flashcard_id=hist_id, action="like", dwell_ms=9000, session_id=session_tag)
    invalidate_feed_candidates_cache()
    feed, _has_more = build_feed(session_tag, limit=8)
    assert any(it.card.id == hist_id for it in feed)


def test_daily_topic_heat_ranks_today():
    import uuid

    from app.flashcard_feed import daily_topic_heat, feedback_stats, record_feedback

    init_db()
    suffix = uuid.uuid4().hex[:8]
    with Session(engine) as session:
        session.add(
            KnowledgeFlashcard(
                content_key=f"test:heat-a:{suffix}",
                topic="因果推断",
                front_text="Q heat a",
                back_text="A" * 20,
                source_title="a.md",
            )
        )
        session.add(
            KnowledgeFlashcard(
                content_key=f"test:heat-b:{suffix}",
                topic="增长",
                front_text="Q heat b",
                back_text="B" * 20,
                source_title="b.md",
            )
        )
        session.commit()
        a_row = session.exec(
            select(KnowledgeFlashcard).where(KnowledgeFlashcard.content_key == f"test:heat-a:{suffix}")
        ).first()
        b_row = session.exec(
            select(KnowledgeFlashcard).where(KnowledgeFlashcard.content_key == f"test:heat-b:{suffix}")
        ).first()
        assert a_row is not None and a_row.id is not None
        assert b_row is not None and b_row.id is not None
        a_id, b_id = a_row.id, b_row.id

    session_tag = f"sess-heat-{suffix}"
    record_feedback(flashcard_id=a_id, action="flip", dwell_ms=9000, session_id=session_tag)
    record_feedback(flashcard_id=a_id, action="like", dwell_ms=9000, session_id=session_tag)
    record_feedback(flashcard_id=b_id, action="skip", dwell_ms=1000, session_id=session_tag)

    heat = daily_topic_heat(session_tag, limit=4)
    assert len(heat) >= 2
    assert heat[0]["topic"] == "因果推断"
    assert heat[0]["heat_pct"] == 100
    assert heat[0]["heat"] > heat[1]["heat"]

    stats = feedback_stats(session_tag)
    assert stats["daily_topic_heat"][0]["topic"] == "因果推断"


def test_sync_flashcards_idempotent(monkeypatch):
    monkeypatch.setattr("app.flashcards.list_wiki_docs", lambda: [])
    monkeypatch.setattr("app.flashcards.list_records", lambda limit=200: [])
    monkeypatch.setattr("app.flashcards.sync_contradiction_cards", lambda: 0)
    init_db()
    r1 = sync_flashcards_from_corpus()
    r2 = sync_flashcards_from_corpus()
    assert r2["created"] == 0
    assert r1["active"] == 0
