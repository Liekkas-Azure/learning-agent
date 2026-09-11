"""闪卡间隔重复（SM-2 简化）与掌握度统计。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from app.models import FlashcardReviewState, KnowledgeFlashcard
from app.storage import engine
from app.tenant import current_user_id
from app.tenant_queries import flashcard_scope, flashcard_visible, review_scope

# again=0, hard=1, good=2, easy=3
_RATING_NAMES = ("again", "hard", "good", "easy")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def ensure_review_states(cards: list[KnowledgeFlashcard]) -> None:
    owner = current_user_id()
    with Session(engine) as session:
        for card in cards:
            if card.id is None:
                continue
            row = session.get(FlashcardReviewState, card.id)
            if row is None:
                session.add(
                    FlashcardReviewState(flashcard_id=card.id, user_id=owner, next_review_at=_utcnow())
                )
            elif (row.user_id or "") != owner:
                row.user_id = owner
                session.add(row)
        session.commit()


def apply_review(flashcard_id: int, rating: int) -> FlashcardReviewState:
    if rating not in range(4):
        raise ValueError("rating must be 0-3")
    owner = current_user_id()
    with Session(engine) as session:
        card = session.get(KnowledgeFlashcard, flashcard_id)
        if not flashcard_visible(card):
            raise LookupError("flashcard not found")
        row = session.get(FlashcardReviewState, flashcard_id)
        if row is None:
            row = FlashcardReviewState(flashcard_id=flashcard_id, user_id=owner, next_review_at=_utcnow())
        elif (row.user_id or "") != owner:
            row.user_id = owner
        ef = max(1.3, float(row.ease_factor))
        reps = int(row.repetitions)
        interval = int(row.interval_days)

        if rating == 0:
            reps = 0
            interval = 1
        elif rating == 1:
            reps = max(1, reps)
            interval = max(1, int(interval * 1.2) if interval else 1)
            ef = max(1.3, ef - 0.15)
        elif rating == 2:
            reps += 1
            if reps == 1:
                interval = 1
            elif reps == 2:
                interval = 3
            else:
                interval = max(1, int(round(interval * ef)))
            ef = min(2.6, ef + 0.05)
        else:
            reps += 1
            interval = max(4, int(round((interval or 1) * ef * 1.3)))
            ef = min(2.8, ef + 0.1)

        row.ease_factor = ef
        row.repetitions = reps
        row.interval_days = interval
        row.last_reviewed_at = _utcnow()
        row.next_review_at = _utcnow() + timedelta(days=interval)
        session.add(row)
        session.commit()
        session.refresh(row)
        # 复制卡字段后离开 session，供 BKT 写回
        card_snapshot = KnowledgeFlashcard(
            id=card.id,
            topic=card.topic,
            wiki_file_name=card.wiki_file_name,
            front_text=card.front_text,
            back_text=card.back_text,
            active=card.active,
        )
        rating_value = rating
        review_row = row

    try:
        from app.student_state import observe_flashcard_review  # noqa: PLC0415
        from app.contextual_bandit import record_reward  # noqa: PLC0415
        from app.wiki_memory import reflect_and_write  # noqa: PLC0415

        observe_flashcard_review(card_snapshot, rating_value)
        record_reward("srs_due", 1.0 if rating_value >= 2 else 0.2)
        if rating_value == 0:
            reflect_and_write(
                event="srs_again",
                payload={"rating": 0, "concept": card_snapshot.topic, "gaps": ["回忆失败"]},
                concepts=[card_snapshot.topic or "未分类"],
            )
    except Exception:  # noqa: BLE001
        pass
    return review_row


def list_due_flashcards(*, limit: int = 20) -> list[KnowledgeFlashcard]:
    now = _utcnow()
    with Session(engine) as session:
        st = (
            select(KnowledgeFlashcard)
            .join(FlashcardReviewState, FlashcardReviewState.flashcard_id == KnowledgeFlashcard.id)
            .where(KnowledgeFlashcard.active == True)  # noqa: E712
            .where(flashcard_scope())
            .where(review_scope())
            .where(FlashcardReviewState.next_review_at <= now)
            .order_by(FlashcardReviewState.next_review_at)
            .limit(limit)
        )
        return list(session.exec(st))


def mastery_by_topic() -> list[dict]:
    now = _utcnow()
    with Session(engine) as session:
        cards = list(
            session.exec(
                select(KnowledgeFlashcard).where(KnowledgeFlashcard.active == True).where(flashcard_scope())  # noqa: E712
            )
        )
        states = {
            s.flashcard_id: s
            for s in session.exec(select(FlashcardReviewState).where(review_scope())).all()
        }
    buckets: dict[str, dict] = {}
    for card in cards:
        if card.id is None:
            continue
        topic = card.topic or "未分类"
        b = buckets.setdefault(topic, {"topic": topic, "total": 0, "due": 0, "mature": 0})
        b["total"] += 1
        st = states.get(card.id)
        if st is None:
            b["due"] += 1
            continue
        if st.next_review_at <= now:
            b["due"] += 1
        if st.repetitions >= 2 and st.interval_days >= 3:
            b["mature"] += 1
    out = []
    for b in buckets.values():
        total = b["total"] or 1
        b["mastery_pct"] = round(100 * b["mature"] / total)
        out.append(b)
    out.sort(key=lambda x: (-x["mastery_pct"], x["topic"]))
    return out
