"""SRS 分析：复习日历、掌握度快照。"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from app.flashcard_srs import mastery_by_topic
from app.models import FlashcardReviewState, KnowledgeFlashcard
from app.storage import engine


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def due_calendar(*, days: int = 14) -> list[dict]:
    """未来 N 天每日到期闪卡数量（按 next_review_at 日期聚合）。"""
    days = max(1, min(int(days), 60))
    now = _utcnow()
    end = now + timedelta(days=days)
    buckets: dict[str, int] = defaultdict(int)
    with Session(engine) as session:
        rows = list(
            session.exec(
                select(FlashcardReviewState)
                .join(KnowledgeFlashcard, KnowledgeFlashcard.id == FlashcardReviewState.flashcard_id)
                .where(KnowledgeFlashcard.active == True)  # noqa: E712
                .where(FlashcardReviewState.next_review_at <= end)
            )
        )
    for row in rows:
        d = row.next_review_at.date().isoformat()
        if row.next_review_at <= now:
            buckets[now.date().isoformat()] += 1
        else:
            buckets[d] += 1
    out: list[dict] = []
    for i in range(days + 1):
        day = (now.date() + timedelta(days=i)).isoformat()
        out.append({"date": day, "due_count": buckets.get(day, 0)})
    return out


def mastery_trend(*, top_n: int = 8) -> dict:
    """掌握度快照 + 到期分布，供前端趋势/柱状图。"""
    mastery = mastery_by_topic()[: max(1, top_n)]
    now = _utcnow()
    overdue = 0
    due_today = 0
    due_week = 0
    with Session(engine) as session:
        states = list(session.exec(select(FlashcardReviewState)))
    for st in states:
        if st.next_review_at <= now:
            overdue += 1
        elif st.next_review_at.date() == now.date():
            due_today += 1
        elif st.next_review_at <= now + timedelta(days=7):
            due_week += 1
    return {
        "mastery": mastery,
        "due_summary": {
            "overdue": overdue,
            "due_today": due_today,
            "due_this_week": due_week,
        },
        "generated_at": now.isoformat(),
    }
