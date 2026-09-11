import uuid

from sqlmodel import Session, select

from app.flashcard_feed import (
    TopicProfile,
    _explain_card,
    _pick_best,
    fetch_feed_candidates,
    invalidate_feed_candidates_cache,
    rank_flashcards_for_feed,
)
from app.models import KnowledgeFlashcard
from app.storage import engine, init_db


def test_explain_weak_topic_reason():
    init_db()
    card = KnowledgeFlashcard(
        content_key=f"test:explain:{uuid.uuid4().hex[:6]}",
        topic="因果推断",
        front_text="Q?",
        back_text="A" * 24,
        card_kind="qa",
    )
    profile = TopicProfile()
    mastery = {"因果推断": {"topic": "因果推断", "mastery_pct": 20, "due": 3, "total": 5}}
    text, reason = _explain_card(card, profile, review_due=False, mastery_map=mastery)
    assert reason == "weak_topic"
    assert "掌握度" in text


def test_rank_prefers_due_card_first():
    init_db()
    suffix = uuid.uuid4().hex[:8]
    with Session(engine) as session:
        due_card = KnowledgeFlashcard(
            content_key=f"test:due:{suffix}",
            topic="主题A",
            front_text="Due Q?",
            back_text="A" * 20,
            card_kind="qa",
        )
        other = KnowledgeFlashcard(
            content_key=f"test:other:{suffix}",
            topic="主题B",
            front_text="Other Q?",
            back_text="B" * 20,
            card_kind="qa",
            quality_score=1.0,
        )
        session.add(due_card)
        session.add(other)
        session.commit()
        session.refresh(due_card)
        session.refresh(other)
        assert due_card.id and other.id

    from app.flashcard_srs import ensure_review_states, apply_review

    ensure_review_states([due_card, other])
    apply_review(due_card.id, 0)

    profile = TopicProfile()
    ranked = rank_flashcards_for_feed(
        [due_card, other],
        profile,
        limit=2,
        note_card_ids=set(),
        due_ids={due_card.id},
    )
    assert len(ranked) >= 1
    assert ranked[0].card.id == due_card.id
    assert ranked[0].review_due is True
    assert ranked[0].feed_reason == "review_due"


def test_pick_best_topic_diversity():
    init_db()
    cards = []
    with Session(engine) as session:
        for i in range(4):
            c = KnowledgeFlashcard(
                content_key=f"test:div:{uuid.uuid4().hex[:6]}",
                topic=f"主题{i}",
                front_text=f"Q{i}?",
                back_text="A" * 20,
                card_kind="section",
            )
            session.add(c)
            cards.append(c)
        session.commit()
        for c in cards:
            session.refresh(c)

    profile = TopicProfile()
    item = _pick_best(
        cards,
        profile=profile,
        seen=set(),
        note_card_ids=set(),
        due_ids=set(),
        mastery_map={},
        topics_in_batch={"主题0": 2},
        wikis_in_batch={},
    )
    assert item is not None
    assert item.card.topic != "主题0"


def test_fetch_feed_candidates_random_pool():
    init_db()
    invalidate_feed_candidates_cache()
    suffix = uuid.uuid4().hex[:8]
    with Session(engine) as session:
        for i in range(12):
            session.add(
                KnowledgeFlashcard(
                    content_key=f"test:pool:{suffix}:{i}",
                    topic=f"池主题{i % 3}",
                    front_text=f"Q{i}?",
                    back_text="A" * 20,
                    card_kind="qa",
                )
            )
        session.commit()

    cards, total = fetch_feed_candidates(pool_size=6)
    assert total >= 12
    assert 1 <= len(cards) <= 6
    assert all(c.active for c in cards)


def test_fetch_feed_candidates_cache_invalidation():
    init_db()
    invalidate_feed_candidates_cache()
    cards1, _ = fetch_feed_candidates(pool_size=8)
    cards2, _ = fetch_feed_candidates(pool_size=8)
    assert {c.id for c in cards1} == {c.id for c in cards2}
    invalidate_feed_candidates_cache()
    cards3, _ = fetch_feed_candidates(pool_size=8)
    assert isinstance(cards3, list)
