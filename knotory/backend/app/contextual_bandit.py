"""Contextual Bandit：按教学 Action 臂累积奖励，供 Planner / Feed 动态选型。"""

from __future__ import annotations

import random
import re
from datetime import datetime, timezone

from sqlmodel import Session, select

from app.models import BanditArmStat
from app.storage import engine
from app.tenant import current_user_id

# 教学 Action 臂
DEFAULT_ARMS = (
    "feed_review",
    "srs_due",
    "feynman",
    "deep_read",
    "exam",
    "rag_clarify",
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _stat_key(arm_key: str, context_key: str = "") -> str:
    arm = (arm_key or "").strip() or "feed_review"
    context = re.sub(r"\s+", " ", (context_key or "").strip().lower())
    return (f"{arm}::{context}" if context else arm)[:128]


def record_reward(arm_key: str, reward: float, *, context_key: str = "") -> None:
    owner = current_user_id()
    key = _stat_key(arm_key, context_key)
    r = max(0.0, min(1.0, float(reward)))
    with Session(engine) as session:
        row = session.exec(
            select(BanditArmStat).where(BanditArmStat.user_id == owner, BanditArmStat.arm_key == key)
        ).first()
        if row is None:
            row = BanditArmStat(user_id=owner, arm_key=key)
        row.pulls = int(row.pulls) + 1
        row.reward_sum = float(row.reward_sum) + r
        row.updated_at = _utcnow()
        session.add(row)
        session.commit()


def arm_stats(*, context_key: str = "") -> list[dict]:
    owner = current_user_id()
    with Session(engine) as session:
        rows = list(session.exec(select(BanditArmStat).where(BanditArmStat.user_id == owner)))
    by_key = {r.arm_key: r for r in rows}
    out = []
    for key in DEFAULT_ARMS:
        contextual = by_key.get(_stat_key(key, context_key)) if context_key else None
        global_row = by_key.get(key)
        # 上下文样本不足时，以全局统计作为先验。
        pulls = int(contextual.pulls) if contextual else 0
        reward_sum = float(contextual.reward_sum) if contextual else 0.0
        if global_row:
            pulls += int(global_row.pulls)
            reward_sum += float(global_row.reward_sum)
        mean = (reward_sum / pulls) if pulls else 0.5
        out.append(
            {
                "arm": key,
                "context": context_key,
                "pulls": pulls,
                "mean_reward": round(mean, 4),
            }
        )
    return out


def select_arm(
    *,
    candidates: list[str] | None = None,
    context_key: str = "",
) -> str:
    """Thompson Sampling：按知识点/学习状态上下文选择教学 Action。"""
    arms = candidates or list(DEFAULT_ARMS)
    stats = {s["arm"]: s for s in arm_stats(context_key=context_key)}
    sampled: dict[str, float] = {}
    for arm in arms:
        stat = stats.get(arm, {})
        pulls = int(stat.get("pulls", 0))
        mean = float(stat.get("mean_reward", 0.5))
        successes = mean * pulls
        failures = max(0.0, pulls - successes)
        sampled[arm] = random.betavariate(1.0 + successes, 1.0 + failures)
    return max(arms, key=lambda arm: sampled[arm])
