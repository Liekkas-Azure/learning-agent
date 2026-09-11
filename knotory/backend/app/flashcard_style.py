"""从用户历史反馈与重写记录推断闪卡自动生成时的讲法偏好。"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import defaultdict

from sqlmodel import Session, select

from app.flashcard_llm import UNDERSTANDING_MODE_LABELS, direction_for_understanding_mode
from app.models import FlashcardFeedback, KnowledgeFlashcard
from app.storage import engine
from app.tenant import current_user_id

logger = logging.getLogger("knotory.flashcard_style")

_POSITIVE_SIGNALS: dict[str, float] = {"like": 1.0, "save": 1.4}
_NEGATIVE_SIGNALS: dict[str, float] = {"bad_card": 2.0, "dislike": 1.2}

_DIRECTION_PATTERNS: list[tuple[str, str, float]] = [
    (r"类比|就像", "analogy", 1.0),
    (r"分步|步骤|1→2|1→2→3", "steps", 1.0),
    (r"零基础|从未听说|术语", "eli5", 1.0),
    (r"对比|混淆|区别|边界", "compare", 1.0),
    (r"举例|例子|场景", "_examples", 0.9),
    (r"更短|短句|精简", "_concise", 0.8),
]


def _parse_meta(raw: str) -> dict:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _score_direction_text(direction: str, mode_scores: dict[str, float], *, weight: float) -> None:
    text = (direction or "").strip()
    if not text:
        return
    for pat, key, wt in _DIRECTION_PATTERNS:
        if re.search(pat, text, re.I):
            mode_scores[key] += weight * wt


def build_generation_style_hint(*, user_id: str | None = None, max_chars: int = 480) -> str:
    """汇总用户偏好的讲法，供 LLM 自动生成时参考；无足够信号时返回空字符串。"""
    uid = user_id or current_user_id()
    mode_scores: dict[str, float] = defaultdict(float)
    avoid_notes: list[str] = []

    with Session(engine) as session:
        cards = list(
            session.exec(
                select(KnowledgeFlashcard)
                .where(KnowledgeFlashcard.user_id == uid)
                .where(KnowledgeFlashcard.active == True)  # noqa: E712
            ).all()
        )
        card_by_id = {c.id: c for c in cards if c.id is not None}
        fb_rows = list(
            session.exec(
                select(FlashcardFeedback)
                .where(FlashcardFeedback.user_id == uid)
                .order_by(FlashcardFeedback.id.desc())
                .limit(400)
            ).all()
        )

    for card in cards:
        meta = _parse_meta(card.generation_meta or "")
        mode = str(meta.get("understanding_mode") or "").strip().lower()
        if mode in UNDERSTANDING_MODE_LABELS:
            mode_scores[mode] += 1.5
        if meta.get("regenerated_at"):
            _score_direction_text(str(meta.get("direction") or ""), mode_scores, weight=1.2)

    for fb in fb_rows:
        card = card_by_id.get(fb.flashcard_id)
        if card is None:
            continue
        meta = _parse_meta(card.generation_meta or "")
        mode = str(meta.get("understanding_mode") or "").strip().lower()
        direction = str(meta.get("direction") or "")

        if fb.action in _POSITIVE_SIGNALS:
            w = _POSITIVE_SIGNALS[fb.action]
            if mode in UNDERSTANDING_MODE_LABELS:
                mode_scores[mode] += w
            _score_direction_text(direction, mode_scores, weight=w * 0.5)
        elif fb.action in _NEGATIVE_SIGNALS:
            flags = {p for p in (card.quality_flags or "").split(",") if p}
            if "template" in flags:
                avoid_notes.append("避免模板化摘抄、空泛问「这一块在讲什么」")
            back_len = len((card.back_text or "").strip())
            if back_len > 900:
                avoid_notes.append("避免过长堆砌、重复原文")
            elif back_len < 100:
                avoid_notes.append("避免只有一句定义、缺少例子")
            if _NEGATIVE_SIGNALS[fb.action] >= 2 and not meta.get("regenerated_at"):
                avoid_notes.append("避免教科书腔、缺少直觉化解释")

    teach_modes = {k: v for k, v in mode_scores.items() if k in UNDERSTANDING_MODE_LABELS and v > 0}
    extra_examples = mode_scores.get("_examples", 0.0)
    extra_concise = mode_scores.get("_concise", 0.0)

    if not teach_modes and extra_examples < 0.8 and extra_concise < 0.8 and not avoid_notes:
        return ""

    lines: list[str] = []
    if teach_modes:
        ranked = sorted(teach_modes.items(), key=lambda x: -x[1])
        top_score = ranked[0][1]
        top_modes = [m for m, s in ranked if s >= top_score * 0.55][:2]
        dirs: list[str] = []
        for m in top_modes:
            if m == "explain":
                dirs.append("拆解要点、分层说明")
            else:
                dirs.append(direction_for_understanding_mode(m))
        if dirs:
            lines.append("该用户历史偏好讲法：" + "；".join(dirs))

    if extra_examples >= 0.8:
        lines.append("多给 1～2 个具体例子或生活场景，帮助建立直觉。")
    if extra_concise >= 0.8:
        lines.append("句子偏短，去掉次要细节，保留核心。")

    seen: set[str] = set()
    for note in avoid_notes:
        if note not in seen:
            seen.add(note)
            lines.append(f"请{note}。")

    hint = "\n".join(lines).strip()
    if len(hint) > max_chars:
        hint = hint[: max_chars - 1].rstrip() + "…"
    return hint


def summarize_style_preference(*, user_id: str | None = None) -> dict:
    """可读的用户讲法偏好摘要，供 profile / 前端展示。"""
    uid = user_id or current_user_id()
    hint = build_generation_style_hint(user_id=uid)
    with Session(engine) as session:
        feedback_n = len(
            list(
                session.exec(
                    select(FlashcardFeedback)
                    .where(FlashcardFeedback.user_id == uid)
                    .limit(500)
                ).all()
            )
        )

    labels: list[str] = []
    if hint:
        if "类比" in hint or "就像" in hint:
            labels.append("生活类比")
        if "分步" in hint or "步骤" in hint:
            labels.append("分步骤")
        if "零基础" in hint:
            labels.append("零基础")
        if "对比" in hint or "辨析" in hint:
            labels.append("对比辨析")
        if "举例" in hint or "场景" in hint:
            labels.append("多举例")
        if "更短" in hint or "短句" in hint:
            labels.append("短句精练")

    learned = bool(labels) or feedback_n >= 8
    summary = ""
    if labels:
        summary = f"系统已记住你偏好：{'、'.join(labels[:3])}。后续新卡与重写会尽量贴合。"
    elif feedback_n >= 8:
        summary = "系统正在根据你的刷读反馈调整推荐与讲法。"
    elif feedback_n > 0:
        summary = f"已记录 {feedback_n} 次互动；多保存/重写几张卡后，讲法偏好会更准。"

    return {
        "learned": learned,
        "labels": labels[:4],
        "feedback_count": feedback_n,
        "summary": summary,
    }


def style_fingerprint(style_hint: str) -> str:
    h = (style_hint or "").strip()
    if not h:
        return ""
    return hashlib.sha256(h.encode("utf-8")).hexdigest()[:10]
