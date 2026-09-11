"""每日学习摘要。"""

from __future__ import annotations

from sqlmodel import Session, select

from app.daily_stats import today_progress
from app.flashcard_feed import daily_topic_heat, feedback_stats
from app.flashcard_srs import list_due_flashcards, mastery_by_topic
from app.models import FlashcardFeedback, KnowledgeFlashcard
from app.storage import engine, list_saved_flashcards


def build_daily_digest(*, session_id: str = "default") -> dict:
    progress = today_progress(session_id=session_id)
    profile = feedback_stats(session_id)
    due_cards = list_due_flashcards(limit=500)
    mastery = mastery_by_topic()
    weak = [m for m in mastery if m.get("mastery_pct", 0) < 45][:5]
    saved = list_saved_flashcards(limit=5)

    highlight = _pick_highlight(session_id)
    heat = daily_topic_heat(session_id, limit=3)

    return {
        "date": progress["date"],
        "one_liner": highlight.get("text", ""),
        "highlight_card": highlight.get("card"),
        "progress": progress,
        "due_count": len(due_cards),
        "saved_recent": saved[:3],
        "topic_heat": heat,
        "weak_topics": [w.get("topic", "") for w in weak if w.get("topic")],
        "mastery_snapshot": mastery[:6],
        "top_topics": profile.get("top_topics", [])[:4],
    }


def _pick_highlight(session_id: str) -> dict:
    """今日一句：优先今日 save 的卡，否则随机一张高质量 demo/活跃卡。"""
    from app.flashcard_feed import _shanghai_day_start_utc

    day_start = _shanghai_day_start_utc()
    with Session(engine) as session:
        saves = list(
            session.exec(
                select(FlashcardFeedback)
                .where(FlashcardFeedback.session_id == session_id)
                .where(FlashcardFeedback.action == "save")
                .where(FlashcardFeedback.created_at >= day_start)
                .order_by(FlashcardFeedback.id.desc())
                .limit(1)
            )
        )
        if saves:
            card = session.get(KnowledgeFlashcard, saves[0].flashcard_id)
            if card and card.active:
                front = (card.front_text or "").strip()
                return {
                    "text": front[:120] if front else "今天你已经保存了一个真正搞懂的知识点。",
                    "card": {"id": card.id, "topic": card.topic, "front_text": card.front_text},
                }

        fallback = session.exec(
            select(KnowledgeFlashcard)
            .where(KnowledgeFlashcard.active == True)  # noqa: E712
            .order_by(KnowledgeFlashcard.quality_score.desc(), KnowledgeFlashcard.id.desc())
            .limit(1)
        ).first()
        if fallback:
            front = (fallback.front_text or "").strip()
            return {
                "text": front[:120] if front else "打开推荐流，今天先刷懂一张卡。",
                "card": {"id": fallback.id, "topic": fallback.topic, "front_text": fallback.front_text},
            }

    return {"text": "上传文库，或先刷示例卡，开始今天的学习。", "card": None}
