"""闪卡质量分、差评、矛盾专题卡。"""

from __future__ import annotations

import json
import logging

from sqlmodel import Session, select

from app.contradiction import detect_contradictions
from app.models import KnowledgeFlashcard
from app.storage import engine, list_records

logger = logging.getLogger("knotory.flashcard_quality")


def apply_feedback_quality(flashcard_id: int, action: str) -> None:
    with Session(engine) as session:
        card = session.get(KnowledgeFlashcard, flashcard_id)
        if card is None:
            return
        if action == "bad_card":
            card.quality_score = max(0.1, float(card.quality_score) - 0.45)
            flags = {p for p in (card.quality_flags or "").split(",") if p}
            flags.add("bad_card")
            card.quality_flags = ",".join(sorted(flags))
        elif action == "dislike":
            card.quality_score = max(0.15, float(card.quality_score) - 0.25)
        elif action in ("like", "save"):
            card.quality_score = min(1.0, float(card.quality_score) + 0.08)
        session.add(card)
        session.commit()


def sync_contradiction_cards() -> int:
    """为近期入库记录中的矛盾对生成对比闪卡。"""
    recent = list_records(limit=30)
    if len(recent) < 2:
        return 0
    created = 0
    with Session(engine) as session:
        all_cards = list(session.exec(select(KnowledgeFlashcard)).all())
        existing_keys = {c.content_key for c in all_cards}
        for rec in recent:
            if rec.id is None:
                continue
            tags = [t.strip() for t in (rec.tags_csv or "").split(",") if t.strip()]
            hits = detect_contradictions(tags, rec.summary, recent, self_id=rec.id)
            for hit in hits[:2]:
                other = next((r for r in recent if r.id == hit["other_record_id"]), None)
                if other is None:
                    continue
                key = f"contradiction:{rec.id}:{other.id}"
                if key in existing_keys:
                    continue
                front = f"关于「{', '.join(hit.get('overlap_tags', [])[:3])}」，两文观点有何冲突？"
                back = (
                    f"《{rec.file_name}》：{rec.summary[:200]}…\n\n"
                    f"《{other.file_name}》：{other.summary[:200]}…\n\n"
                    f"提示：{hit.get('note', '')}"
                )
                session.add(
                    KnowledgeFlashcard(
                        content_key=key,
                        card_kind="contradiction",
                        topic=tags[0] if tags else "矛盾对比",
                        topics_csv=",".join(tags[:6]),
                        front_text=front,
                        back_text=back,
                        source_title=f"{rec.file_name} ↔ {other.file_name}",
                        visual_caption="观点对照",
                        generation_meta=json.dumps({"type": "contradiction"}, ensure_ascii=False),
                    )
                )
                existing_keys.add(key)
                created += 1
        session.commit()
    return created


def audit_payload_quality(payload: dict) -> None:
    """同步前写入质量标记（模板卡、过短背面等）。"""
    flags: set[str] = {p for p in (payload.get("quality_flags") or "").split(",") if p}
    kind = str(payload.get("card_kind") or "")
    back = str(payload.get("back_text") or "")
    front = str(payload.get("front_text") or "")
    if kind == "section" and ("核心要点" in front or "这一块" in front):
        flags.add("template")
    if len(back) < 40:
        flags.add("short_back")
    if len(back) > 900:
        flags.add("truncated")
    score = float(payload.get("quality_score") or 1.0)
    if "template" in flags:
        score = min(score, 0.72)
    if "short_back" in flags:
        score = min(score, 0.55)
    payload["quality_flags"] = ",".join(sorted(flags))
    payload["quality_score"] = score
