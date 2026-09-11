"""闪卡推荐流：多信号排序 + 可解释性 + 会话内负反馈抑制。"""

from __future__ import annotations

import random
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlmodel import Session, select

from app.config import settings
from app.flashcard_style import summarize_style_preference
from app.flashcard_srs import list_due_flashcards
from app.models import FlashcardFeedback, FlashcardUserNote, KnowledgeFlashcard
from app.storage import engine
from app.tenant import current_user_id
from app.tenant_queries import feedback_scope, flashcard_scope, flashcard_visible

_FEED_CACHE_TTL_SEC = 45.0
_feed_candidates_cache: tuple[float, int, list[KnowledgeFlashcard], int] | None = None

_ACTION_WEIGHTS: dict[str, float] = {
    "like": 2.2,
    "save": 1.6,
    "open_source": 0.8,
    "flip": 0.35,
    "skip": -0.35,
    "dislike": -3.0,
    "bad_card": -4.0,
}

_DWELL_BONUS_MS = 8000
_DWELL_BONUS = 0.45
_FRESH_DAYS = 7

# 当日浏览热度：计入「看过/划过/互动」类反馈
_DAILY_HEAT_ACTIONS: dict[str, float] = {
    "skip": 1.0,
    "flip": 1.25,
    "like": 2.0,
    "save": 2.5,
    "open_source": 1.5,
    "dislike": 0.6,
    "bad_card": 0.6,
}
_DAILY_HEAT_DWELL_MS = 6000
_DAILY_HEAT_DWELL_BONUS = 0.35


@dataclass
class TopicProfile:
    topic_weights: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    recent_card_ids: list[int] = field(default_factory=list)
    disliked_card_ids: set[int] = field(default_factory=set)
    positive_card_ids: set[int] = field(default_factory=set)
    saved_topics: set[str] = field(default_factory=set)
    total_feedback: int = 0


@dataclass
class FeedItem:
    card: KnowledgeFlashcard
    explain: str = ""
    review_due: bool = False
    feed_reason: str = "default"


def build_topic_profile(session_id: str, *, recent_limit: int = 40) -> TopicProfile:
    profile = TopicProfile()
    with Session(engine) as session:
        st = (
            select(FlashcardFeedback)
            .where(FlashcardFeedback.session_id == session_id)
            .where(feedback_scope())
            .order_by(FlashcardFeedback.id.desc())
            .limit(500)
        )
        rows = list(session.exec(st))
    profile.total_feedback = len(rows)
    card_ids: list[int] = []
    card_topic: dict[int, str] = {}
    if rows:
        ids = list({r.flashcard_id for r in rows})
        with Session(engine) as session:
            cards = [session.get(KnowledgeFlashcard, i) for i in ids]
        card_topic = {c.id: c.topic for c in cards if c is not None and c.id is not None}

    for fb in rows:
        topic = card_topic.get(fb.flashcard_id, "未分类")
        w = _ACTION_WEIGHTS.get(fb.action, 0.0)
        if fb.dwell_ms >= _DWELL_BONUS_MS and fb.action not in ("dislike", "bad_card"):
            w += _DWELL_BONUS
        profile.topic_weights[topic] += w
        if fb.action in ("dislike", "bad_card"):
            profile.disliked_card_ids.add(fb.flashcard_id)
        if fb.action in ("like", "save"):
            profile.positive_card_ids.add(fb.flashcard_id)
        if fb.action == "save":
            profile.saved_topics.add(topic)
        if fb.flashcard_id not in card_ids:
            card_ids.append(fb.flashcard_id)

    profile.recent_card_ids = card_ids[:recent_limit]
    return profile


def _shanghai_day_start_utc() -> datetime:
    try:
        from zoneinfo import ZoneInfo

        tz = ZoneInfo("Asia/Shanghai")
    except ImportError:  # pragma: no cover
        tz = timezone(timedelta(hours=8))
    now_local = datetime.now(tz)
    day_start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    return day_start_local.astimezone(timezone.utc).replace(tzinfo=None)


def daily_topic_heat(session_id: str, *, limit: int = 4) -> list[dict]:
    """当日（Asia/Shanghai）会话内各主题浏览热度，用于首页主题条。"""
    day_start = _shanghai_day_start_utc()
    with Session(engine) as session:
        st = (
            select(FlashcardFeedback)
            .where(FlashcardFeedback.session_id == session_id)
            .where(feedback_scope())
            .where(FlashcardFeedback.created_at >= day_start)
            .order_by(FlashcardFeedback.id.desc())
        )
        rows = list(session.exec(st))

    if not rows:
        return []

    ids = list({r.flashcard_id for r in rows})
    with Session(engine) as session:
        cards = [session.get(KnowledgeFlashcard, i) for i in ids]
    card_topic = {c.id: c.topic for c in cards if c is not None and c.id is not None}

    heat: dict[str, float] = defaultdict(float)
    for fb in rows:
        topic = card_topic.get(fb.flashcard_id, "未分类")
        w = _DAILY_HEAT_ACTIONS.get(fb.action, 0.0)
        if w <= 0:
            continue
        if fb.dwell_ms >= _DAILY_HEAT_DWELL_MS and fb.action not in ("dislike", "bad_card"):
            w += _DAILY_HEAT_DWELL_BONUS
        heat[topic] += w

    if not heat:
        return []

    ranked = sorted(heat.items(), key=lambda x: (-x[1], x[0]))[: max(1, limit)]
    max_heat = ranked[0][1] or 1.0
    out: list[dict] = []
    for topic, score in ranked:
        pct = round(100 * score / max_heat)
        out.append({"topic": topic, "heat": round(score, 2), "heat_pct": pct})
    return out


def _freshness_boost(card: KnowledgeFlashcard) -> float:
    created = card.created_at
    if not created:
        return 0.0
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    age = now - created
    if age <= timedelta(days=_FRESH_DAYS):
        return 0.5 * (1 - age.total_seconds() / (_FRESH_DAYS * 86400))
    return 0.0


def _mastery_by_topic_map() -> dict[str, dict]:
    from app.flashcard_srs import mastery_by_topic  # noqa: PLC0415

    merged = {m["topic"]: dict(m) for m in mastery_by_topic()}
    try:
        from app.student_state import list_concept_mastery  # noqa: PLC0415

        for c in list_concept_mastery(limit=40):
            label = c.get("concept_label") or c.get("concept_key") or ""
            if not label:
                continue
            row = merged.setdefault(
                label,
                {"topic": label, "total": max(1, int(c.get("observations") or 1)), "due": 0, "mature": 0},
            )
            # BKT 与 SRS 取更保守（更低）的掌握度，驱动弱项优先
            bkt_pct = int(c.get("mastery_pct") or 0)
            srs_pct = int(row.get("mastery_pct") or 100)
            row["mastery_pct"] = min(srs_pct, bkt_pct) if "mastery_pct" in row else bkt_pct
            row["bkt_p_know"] = c.get("p_know")
    except Exception:  # noqa: BLE001
        pass
    return merged

def _weak_topic_boost(topic: str, mastery_map: dict[str, dict]) -> float:
    m = mastery_map.get(topic)
    if not m:
        return 0.0
    pct = int(m.get("mastery_pct", 0))
    total = max(1, int(m.get("total", 1)))
    due_ratio = float(m.get("due", 0)) / total
    if pct < 35:
        return 1.1 + due_ratio * 0.6
    if pct < 60:
        return 0.45 + due_ratio * 0.25
    if pct >= 85:
        return -0.15
    return 0.0


def _card_kind_boost(card: KnowledgeFlashcard) -> float:
    return {
        "qa": 0.55,
        "contradiction": 0.35,
        "summary": 0.28,
        "section": 0.12,
        "companion": 0.15,
    }.get(card.card_kind or "", 0.0)


def _explain_card(
    card: KnowledgeFlashcard,
    profile: TopicProfile,
    *,
    review_due: bool,
    mastery_map: dict[str, dict],
) -> tuple[str, str]:
    """返回 (展示文案, feed_reason)。"""
    if review_due:
        return "今日待复习 · 优先巩固", "review_due"
    if card.card_kind == "contradiction":
        return "矛盾对照 · 辨析不同材料观点", "qa_quality"
    m = mastery_map.get(card.topic)
    if m and int(m.get("mastery_pct", 100)) < 45:
        due_n = int(m.get("due", 0))
        if due_n > 0:
            return f"「{card.topic}」掌握度偏低 · {due_n} 张待巩固", "weak_topic"
        return f"「{card.topic}」掌握度偏低 · 建议加强", "weak_topic"
    if card.card_kind == "qa" and float(card.quality_score or 1) >= 0.92:
        return f"「{card.topic}」高质量问答 · 值得精读", "qa_quality"
    if card.topic in profile.saved_topics:
        return f"你已保存「{card.topic}」· 相关内容", "saved"
    w = profile.topic_weights.get(card.topic, 0.0)
    if w >= 2.0:
        return f"你常互动「{card.topic}」· 继续加深", "interest"
    if w >= 1.0:
        return f"「{card.topic}」匹配你的兴趣", "interest"
    if w <= -1.0:
        return "探索新主题 · 拓展知识边界", "explore"
    if profile.total_feedback < 8:
        if _freshness_boost(card) > 0.12:
            return "新入库优先 · 帮你快速扫一遍", "cold_start"
        return "多样主题推荐 · 建立你的兴趣画像", "cold_start"
    if _freshness_boost(card) > 0.22:
        return "刚生成的闪卡 · 趁热巩固", "fresh"
    if card.card_kind == "summary":
        return f"「{card.topic}」全文摘要 · 快速回顾", "default"
    return "为你挑选的下一知识点", "default"


def _score_card(
    card: KnowledgeFlashcard,
    profile: TopicProfile,
    seen_in_batch: set[int],
    *,
    has_note: bool,
    mastery_map: dict[str, dict],
    topics_in_batch: dict[str, int],
    wikis_in_batch: dict[str, int],
) -> float:
    if card.id in profile.disliked_card_ids:
        return -1e8
    score = 1.0 + profile.topic_weights.get(card.topic, 0.0) * 1.85
    score += float(card.quality_score or 1.0) * 0.55
    score += _freshness_boost(card)
    score += _card_kind_boost(card)
    score += _weak_topic_boost(card.topic, mastery_map)
    if has_note:
        score += 0.45
    if card.id in profile.recent_card_ids and card.id not in profile.positive_card_ids:
        score -= 4.8
    if card.id in seen_in_batch:
        score -= 8.0
    if profile.total_feedback >= 6 and profile.topic_weights.get(card.topic, 0.0) <= 0:
        score += 0.7
    wiki = (card.wiki_file_name or "").strip()
    if wiki and wikis_in_batch.get(wiki, 0) >= 2:
        score -= 1.15
    elif wiki and wikis_in_batch.get(wiki, 0) == 0 and profile.total_feedback < 12:
        score += 0.25
    if topics_in_batch.get(card.topic, 0) >= 2:
        score -= 1.35
    elif profile.total_feedback < 10 and topics_in_batch.get(card.topic, 0) == 0:
        score += 0.55
    if profile.total_feedback < 8:
        score += 0.3
    score += random.uniform(0, 0.75)
    return score


def _pick_best(
    pool: list[KnowledgeFlashcard],
    *,
    profile: TopicProfile,
    seen: set[int],
    note_card_ids: set[int],
    due_ids: set[int],
    mastery_map: dict[str, dict],
    topics_in_batch: dict[str, int],
    wikis_in_batch: dict[str, int],
    due_only: bool = False,
) -> FeedItem | None:
    best: KnowledgeFlashcard | None = None
    best_score = -1e9
    best_explain = ""
    best_reason = "default"
    best_due = False
    sample = pool[:36]
    if due_only:
        sample = [c for c in sample if c.id in due_ids]
    for card in sample:
        if card.id is None:
            continue
        due = card.id in due_ids
        if due_only and not due:
            continue
        s = _score_card(
            card,
            profile,
            seen,
            has_note=card.id in note_card_ids,
            mastery_map=mastery_map,
            topics_in_batch=topics_in_batch,
            wikis_in_batch=wikis_in_batch,
        )
        if due:
            s += 3.2
        if s > best_score:
            best_score = s
            best = card
            best_due = due
            best_explain, best_reason = _explain_card(
                card, profile, review_due=due, mastery_map=mastery_map
            )
    if best is None or best.id is None:
        return None
    return FeedItem(
        card=best,
        explain=best_explain,
        review_due=best_due,
        feed_reason=best_reason,
    )


def rank_flashcards_for_feed(
    cards: list[KnowledgeFlashcard],
    profile: TopicProfile,
    *,
    limit: int,
    note_card_ids: set[int],
    due_ids: set[int],
) -> list[FeedItem]:
    if not cards:
        return []
    mastery_map = _mastery_by_topic_map()
    pool = list(cards)
    random.shuffle(pool)
    chosen: list[FeedItem] = []
    seen: set[int] = set()
    topics_in_batch: dict[str, int] = defaultdict(int)
    wikis_in_batch: dict[str, int] = defaultdict(int)

    if due_ids:
        due_pick = _pick_best(
            pool,
            profile=profile,
            seen=seen,
            note_card_ids=note_card_ids,
            due_ids=due_ids,
            mastery_map=mastery_map,
            topics_in_batch=topics_in_batch,
            wikis_in_batch=wikis_in_batch,
            due_only=True,
        )
        if due_pick is not None and due_pick.card.id is not None:
            chosen.append(due_pick)
            seen.add(due_pick.card.id)
            topics_in_batch[due_pick.card.topic] += 1
            wiki = (due_pick.card.wiki_file_name or "").strip()
            if wiki:
                wikis_in_batch[wiki] += 1
            pool = [c for c in pool if c.id != due_pick.card.id]

    while pool and len(chosen) < limit:
        item = _pick_best(
            pool,
            profile=profile,
            seen=seen,
            note_card_ids=note_card_ids,
            due_ids=due_ids,
            mastery_map=mastery_map,
            topics_in_batch=topics_in_batch,
            wikis_in_batch=wikis_in_batch,
        )
        if item is None or item.card.id is None:
            break
        chosen.append(item)
        seen.add(item.card.id)
        topics_in_batch[item.card.topic] += 1
        wiki = (item.card.wiki_file_name or "").strip()
        if wiki:
            wikis_in_batch[wiki] += 1
        pool = [c for c in pool if c.id != item.card.id]
    return chosen


def get_active_flashcards() -> list[KnowledgeFlashcard]:
    with Session(engine) as session:
        st = select(KnowledgeFlashcard).where(KnowledgeFlashcard.active == True).where(flashcard_scope())  # noqa: E712
        return list(session.exec(st))


def invalidate_feed_candidates_cache() -> None:
    global _feed_candidates_cache
    _feed_candidates_cache = None


def count_active_flashcards(*, exclude_ids: set[int] | None = None) -> int:
    with Session(engine) as session:
        st = select(func.count()).select_from(KnowledgeFlashcard).where(KnowledgeFlashcard.active == True)  # noqa: E712
        if exclude_ids:
            st = st.where(KnowledgeFlashcard.id.not_in(list(exclude_ids)))
        return int(session.exec(st).one())


def fetch_feed_candidates(
    *,
    pool_size: int | None = None,
    exclude_ids: set[int] | None = None,
    extra_ids: set[int] | None = None,
) -> tuple[list[KnowledgeFlashcard], int]:
    """随机抽样活跃闪卡作为排序候选池，避免每次 feed 全表扫描。"""
    global _feed_candidates_cache
    if pool_size is not None:
        pool = max(1, int(pool_size))
    else:
        pool = max(48, int(settings.flashcard_feed_candidate_pool))
    exclude = exclude_ids or set()
    now = time.monotonic()

    if not exclude and _feed_candidates_cache is not None:
        ts, cached_pool, cached_cards, total = _feed_candidates_cache
        if cached_pool == pool and now - ts < _FEED_CACHE_TTL_SEC:
            return list(cached_cards), total

    with Session(engine) as session:
        count_stmt = select(func.count()).select_from(KnowledgeFlashcard).where(
            KnowledgeFlashcard.active == True  # noqa: E712
        ).where(flashcard_scope())
        if exclude:
            count_stmt = count_stmt.where(KnowledgeFlashcard.id.not_in(list(exclude)))
        total = int(session.exec(count_stmt).one())

        sample_n = min(pool, max(0, total))
        pool_cards: list[KnowledgeFlashcard] = []
        if sample_n > 0:
            sample_stmt = (
                select(KnowledgeFlashcard)
                .where(KnowledgeFlashcard.active == True)  # noqa: E712
                .where(flashcard_scope())
                .order_by(func.random())
                .limit(sample_n)
            )
            if exclude:
                sample_stmt = sample_stmt.where(KnowledgeFlashcard.id.not_in(list(exclude)))
            pool_cards = list(session.exec(sample_stmt))

        extra_set = {i for i in (extra_ids or set()) if i is not None}
        if exclude:
            extra_set -= exclude
        if extra_set:
            seen = {c.id for c in pool_cards if c.id is not None}
            for cid in extra_set:
                if cid in seen:
                    continue
                card = session.get(KnowledgeFlashcard, cid)
                if card is not None and card.active:
                    pool_cards.insert(0, card)
                    seen.add(cid)

    if not exclude:
        _feed_candidates_cache = (now, pool, list(pool_cards), total)
    return pool_cards, total


def _boost_pool_with_profile_topics(
    pool_cards: list[KnowledgeFlashcard],
    profile: TopicProfile,
    *,
    exclude: set[int],
    session: Session,
    per_topic: int = 16,
    max_topics: int = 4,
) -> list[KnowledgeFlashcard]:
    boosted_topics = [
        topic
        for topic, weight in sorted(profile.topic_weights.items(), key=lambda x: -x[1])
        if weight >= 0.8
    ][:max_topics]
    if not boosted_topics:
        return pool_cards
    seen = {c.id for c in pool_cards if c.id is not None}
    out = list(pool_cards)
    for topic in boosted_topics:
        stmt = (
            select(KnowledgeFlashcard)
            .where(KnowledgeFlashcard.active == True)  # noqa: E712
            .where(KnowledgeFlashcard.topic == topic)
            .limit(per_topic)
        )
        if exclude:
            stmt = stmt.where(KnowledgeFlashcard.id.not_in(list(exclude)))
        for card in session.exec(stmt):
            if card.id is None or card.id in seen:
                continue
            out.insert(0, card)
            seen.add(card.id)
    return out


def build_feed(
    session_id: str,
    *,
    limit: int = 8,
    exclude_ids: set[int] | None = None,
) -> tuple[list[FeedItem], bool]:
    profile = build_topic_profile(session_id)
    due = list_due_flashcards(limit=50)
    due_ids = {c.id for c in due if c.id is not None}
    extra_ids = due_ids | {i for i in profile.recent_card_ids if i is not None}
    cards, total_active = fetch_feed_candidates(
        exclude_ids=exclude_ids,
        extra_ids=extra_ids,
    )
    exclude = exclude_ids or set()
    with Session(engine) as session:
        cards = _boost_pool_with_profile_topics(
            cards,
            profile,
            exclude=exclude,
            session=session,
        )
    candidate_ids = {c.id for c in cards if c.id is not None}
    with Session(engine) as session:
        if candidate_ids:
            note_stmt = select(FlashcardUserNote).where(
                FlashcardUserNote.flashcard_id.in_(list(candidate_ids))
            )
            note_ids = {n.flashcard_id for n in session.exec(note_stmt).all()}
        else:
            note_ids = set()
    lim = min(max(1, limit), 20)
    ranked = rank_flashcards_for_feed(
        cards,
        profile,
        limit=lim,
        note_card_ids=note_ids,
        due_ids=due_ids,
    )
    excluded = len(exclude_ids or set())
    has_more = total_active > len(ranked) + excluded
    return ranked, has_more


def record_feedback(
    *,
    flashcard_id: int,
    action: str,
    dwell_ms: int,
    session_id: str,
) -> None:
    if action not in _ACTION_WEIGHTS:
        raise ValueError(f"unsupported action: {action}")
    from app.flashcard_quality import apply_feedback_quality  # noqa: PLC0415

    with Session(engine) as session:
        card = session.get(KnowledgeFlashcard, flashcard_id)
        if not flashcard_visible(card):
            raise LookupError("flashcard not found")
        session.add(
            FlashcardFeedback(
                flashcard_id=flashcard_id,
                user_id=current_user_id(),
                action=action,
                dwell_ms=max(0, int(dwell_ms)),
                session_id=session_id or "default",
            )
        )
        session.commit()
    apply_feedback_quality(flashcard_id, action)
    try:
        from app.contextual_bandit import record_reward  # noqa: PLC0415
        from app.student_state import observe_behavior  # noqa: PLC0415

        observe_behavior(card, action=action, dwell_ms=dwell_ms)
        reward = {
            "save": 1.0,
            "like": 0.85,
            "open_source": 0.7,
            "flip": 0.55,
            "skip": 0.2,
            "dislike": 0.0,
            "bad_card": 0.0,
        }.get(action, 0.4)
        record_reward("feed_review", reward, context_key=card.topic or "未分类")
    except Exception:  # noqa: BLE001
        # 状态估计失败不得阻断主反馈链路。
        pass


def feedback_stats(session_id: str) -> dict:
    profile = build_topic_profile(session_id)
    top_topics = sorted(profile.topic_weights.items(), key=lambda x: -x[1])[:6]
    from app.flashcard_srs import mastery_by_topic  # noqa: PLC0415

    return {
        "session_id": session_id,
        "total_feedback": profile.total_feedback,
        "top_topics": [{"topic": t, "score": round(s, 2)} for t, s in top_topics],
        "daily_topic_heat": daily_topic_heat(session_id, limit=4),
        "mastery": mastery_by_topic()[:12],
        "style_preference": summarize_style_preference(),
    }
