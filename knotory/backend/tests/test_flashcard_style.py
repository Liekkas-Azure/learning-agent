import json

from sqlmodel import Session, select

from app.flashcard_style import build_generation_style_hint, style_fingerprint
from app.models import FlashcardFeedback, KnowledgeFlashcard
from app.storage import engine


def test_style_fingerprint_empty():
    assert style_fingerprint("") == ""


def test_style_fingerprint_stable():
    assert style_fingerprint("偏好类比") == style_fingerprint("偏好类比")
    assert style_fingerprint("偏好类比") != style_fingerprint("偏好分步")


def test_build_style_hint_from_regenerated_card():
    uid = "__test_style_user__"
    with Session(engine) as session:
        card = KnowledgeFlashcard(
            user_id=uid,
            content_key="test:style:1",
            card_kind="qa",
            topic="测试",
            front_text="Q",
            back_text="A" * 80,
            generation_meta=json.dumps(
                {
                    "regenerated_at": "2026-01-01T00:00:00",
                    "direction": "用生活化类比讲解，先给一句「就像…」，再展开。",
                },
                ensure_ascii=False,
            ),
            active=True,
        )
        session.add(card)
        session.commit()
        session.refresh(card)
        card_id = card.id

        session.add(
            FlashcardFeedback(
                flashcard_id=card_id,
                user_id=uid,
                action="save",
                session_id="s1",
            )
        )
        session.commit()

    hint = build_generation_style_hint(user_id=uid)
    assert "类比" in hint or "就像" in hint

    with Session(engine) as session:
        row = session.get(KnowledgeFlashcard, card_id)
        if row:
            session.delete(row)
        for fb in session.exec(select(FlashcardFeedback).where(FlashcardFeedback.user_id == uid)):
            session.delete(fb)
        session.commit()
