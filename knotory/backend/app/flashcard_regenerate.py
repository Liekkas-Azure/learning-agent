"""按用户方向重写单张闪卡（易懂表述，非原文摘抄）。"""

from __future__ import annotations

import json
import logging
from datetime import datetime

from sqlmodel import Session

from app.flashcard_llm import regenerate_card_with_llm
from app.flashcard_quality import audit_payload_quality
from app.flashcard_visual import visual_bundle_for_card
from app.llm import ExtractionNotConfiguredError
from app.markdown_sections import find_section_by_id
from app.models import FlashcardUserNote, KnowledgeFlashcard
from app.storage import engine, read_body_text_for_reading_companion

logger = logging.getLogger("knotory.flashcard_regenerate")

_MAX_DIRECTION = 800


def _topics_from_card(card: KnowledgeFlashcard) -> list[str]:
    parts = [t.strip() for t in (card.topics_csv or "").split(",") if t.strip()]
    return parts or ([card.topic] if (card.topic or "").strip() else ["未分类"])


def _section_context(card: KnowledgeFlashcard) -> tuple[str, str]:
    wiki = (card.wiki_file_name or "").strip()
    sec_id = (card.section_id or "").strip()
    if wiki:
        body = (read_body_text_for_reading_companion(wiki) or "").strip()
        if body and sec_id:
            found = find_section_by_id(body, sec_id)
            if found:
                return found.title, found.markdown
        if body:
            title = (card.source_title or wiki).strip()
            return title, body[:4500]
    title = (card.source_title or card.topic or "知识点").strip()
    fallback = (card.back_text or "").strip()
    return title, fallback[:2000] if fallback else title


def regenerate_flashcard(
    card_id: int,
    *,
    direction: str = "",
    use_note: bool = True,
) -> KnowledgeFlashcard:
    direction = (direction or "").strip()[:_MAX_DIRECTION]
    if not direction:
        direction = "用更简单、好理解、好记忆的方式讲解，避免照搬原文。"

    with Session(engine) as session:
        card = session.get(KnowledgeFlashcard, card_id)
        if card is None or not card.active:
            raise ValueError("闪卡不存在")

        note_hint = ""
        if use_note:
            note_row = session.get(FlashcardUserNote, card_id)
            if note_row and (note_row.text or "").strip():
                note_hint = note_row.text.strip()[:1200]

        section_title, section_text = _section_context(card)
        if len((section_text or "").strip()) < 24:
            raise ValueError("找不到足够出处正文，无法重写这张卡")

        topics = _topics_from_card(card)
        try:
            pair, provider = regenerate_card_with_llm(
                doc_title=card.wiki_file_name or card.source_title or card.topic,
                section_title=section_title,
                section_text=section_text,
                topics=topics,
                old_front=card.front_text or "",
                old_back=card.back_text or "",
                direction=direction,
                note_hint=note_hint,
            )
        except ExtractionNotConfiguredError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("flashcard regenerate failed id=%s: %s", card_id, exc)
            raise ValueError("闪卡重写失败，请稍后重试") from exc

        card.front_text = pair["question"]
        card.back_text = pair["answer"]
        img_p = str(pair.get("image_prompt", "")).strip()
        card.image_prompt = img_p[:200] if img_p else ""
        card.visual_mermaid = str(pair.get("visual_mermaid", "")).strip()
        card.visual_caption = str(pair.get("visual_caption", "")).strip()[:120]
        card.visual_image_path = ""
        card.quality_flags = ""
        bundle = visual_bundle_for_card(
            topic=card.topic,
            topics=topics,
            section_title=section_title,
            visual_mermaid=pair.get("visual_mermaid"),
            visual_caption=pair.get("visual_caption"),
        )
        card.visual_palette = bundle.get("visual_palette", card.visual_palette)
        card.visual_emoji = bundle.get("visual_emoji", card.visual_emoji)

        meta = {
            "card_kind": card.card_kind,
            "regenerated_at": datetime.utcnow().isoformat(),
            "provider": provider,
            "direction": direction[:240],
        }
        card.generation_meta = json.dumps(meta, ensure_ascii=False)
        audit_payload = {
            "front_text": card.front_text,
            "back_text": card.back_text,
            "card_kind": card.card_kind,
            "quality_score": min(1.0, float(card.quality_score or 0.6) + 0.12),
            "quality_flags": "",
        }
        audit_payload_quality(audit_payload)
        card.quality_score = float(audit_payload["quality_score"])
        card.quality_flags = str(audit_payload.get("quality_flags") or "")
        session.add(card)
        session.commit()
        session.refresh(card)
        return card
