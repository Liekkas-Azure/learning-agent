"""每日学习进度与连续打卡（基于 FlashcardFeedback 聚合）。"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from app.storage import engine
from app.tenant import current_user_id
from app.tenant_queries import feedback_scope
from app.flashcard_feed import _shanghai_day_start_utc
from app.models import FlashcardFeedback

# 计入「今日进度 / 有效学习日」的行为
_PROGRESS_ACTIONS = frozenset({"flip", "like", "save", "skip"})
_MIN_ENGAGEMENTS_FOR_STREAK_DAY = 3
DEFAULT_DAILY_GOAL = 5


def _shanghai_date(dt: datetime) -> str:
    try:
        from zoneinfo import ZoneInfo

        tz = ZoneInfo("Asia/Shanghai")
    except ImportError:  # pragma: no cover
        tz = timezone(timedelta(hours=8))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz).strftime("%Y-%m-%d")


def _engagement_days(*, lookback_days: int = 120) -> dict[str, int]:
    """date -> engagement count (global, all sessions)."""
    cutoff = datetime.utcnow() - timedelta(days=lookback_days)
    with Session(engine) as session:
        rows = list(
            session.exec(
                select(FlashcardFeedback)
                .where(FlashcardFeedback.created_at >= cutoff)
                .where(FlashcardFeedback.action.in_(_PROGRESS_ACTIONS))  # type: ignore[attr-defined]
                .where(FlashcardFeedback.user_id == current_user_id())
            )
        )
    by_day: dict[str, int] = defaultdict(int)
    for row in rows:
        by_day[_shanghai_date(row.created_at)] += 1
    return dict(by_day)


def compute_streak(*, lookback_days: int = 120) -> int:
    by_day = _engagement_days(lookback_days=lookback_days)
    try:
        from zoneinfo import ZoneInfo

        tz = ZoneInfo("Asia/Shanghai")
    except ImportError:  # pragma: no cover
        tz = timezone(timedelta(hours=8))
    today = datetime.now(tz).date()
    streak = 0
    d = today
    while True:
        key = d.strftime("%Y-%m-%d")
        if by_day.get(key, 0) >= _MIN_ENGAGEMENTS_FOR_STREAK_DAY:
            streak += 1
            d -= timedelta(days=1)
        else:
            break
    return streak


def today_progress(*, session_id: str | None = None, goal: int | None = None) -> dict:
    day_start = _shanghai_day_start_utc()
    with Session(engine) as session:
        q = (
            select(FlashcardFeedback)
            .where(FlashcardFeedback.created_at >= day_start)
            .where(FlashcardFeedback.action.in_(_PROGRESS_ACTIONS))  # type: ignore[attr-defined]
        )
        if session_id:
            q = q.where(FlashcardFeedback.session_id == session_id)
        q = q.where(FlashcardFeedback.user_id == current_user_id())
        rows = list(session.exec(q))

    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        counts[row.action] += 1

    # 每张卡 flip 可能多次，进度以「有效互动次数」计
    today_count = len(rows)
    resolved_goal = goal if goal is not None and 1 <= goal <= 50 else DEFAULT_DAILY_GOAL
    return {
        "date": _shanghai_date(datetime.utcnow()),
        "today_count": today_count,
        "goal": resolved_goal,
        "goal_met": today_count >= resolved_goal,
        "progress_pct": min(100, round(today_count / max(resolved_goal, 1) * 100)),
        "streak_days": compute_streak(),
        "breakdown": dict(counts),
    }
