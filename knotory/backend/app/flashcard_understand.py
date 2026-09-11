"""闪卡易懂化：多种理解模式 + 磁盘缓存（不覆盖原卡）。"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlmodel import Session

from app.config import settings
from app.corpus_store import notify_path_written
from app.flashcard_llm import UNDERSTANDING_MODE_LABELS, generate_understanding_with_llm
from app.flashcard_quality import audit_payload_quality
from app.flashcard_regenerate import _section_context, _topics_from_card
from app.flashcard_visual import visual_bundle_for_card
from app.llm import ExtractionNotConfiguredError
from app.models import FlashcardUserNote, KnowledgeFlashcard
from app.storage import engine

logger = logging.getLogger("knotory.flashcard_understand")

_CACHE_DIR = "flashcard_understand"
_CACHE_VERSION = "v1"


def _cache_key(card: KnowledgeFlashcard, mode: str) -> str:
    payload = f"{_CACHE_VERSION}|{mode}|{card.front_text}|{card.back_text}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _cache_path(card_id: int, mode: str) -> Path:
    root = settings.resolved_data_dir / "outputs" / _CACHE_DIR
    root.mkdir(parents=True, exist_ok=True)
    safe_mode = mode.replace("/", "_")[:24]
    return root / f"card{card_id}.{safe_mode}.json"


def _read_understand_cache(path: Path, expected_hash: str) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(data, dict) or data.get("source_sha256") != expected_hash:
        return None
    payload = data.get("payload")
    return payload if isinstance(payload, dict) else None


def _write_understand_cache(path: Path, *, source_hash: str, provider: str, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"source_sha256": source_hash, "provider": provider, "payload": payload},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    notify_path_written(path)


def fetch_flashcard_understanding(
    card_id: int,
    *,
    mode: str,
    use_note: bool = True,
) -> dict[str, Any]:
    mode = (mode or "explain").strip().lower()
    if mode not in UNDERSTANDING_MODE_LABELS:
        raise ValueError(f"不支持的理解模式: {mode}")

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
            raise ValueError("找不到足够出处正文，无法生成理解辅助")

        src_hash = _cache_key(card, mode)
        cache = _cache_path(card_id, mode)
        cached = _read_understand_cache(cache, src_hash)
        if cached is not None:
            out = dict(cached)
            out["cached"] = True
            return out

        topics = _topics_from_card(card)
        try:
            payload, provider = generate_understanding_with_llm(
                mode=mode,
                doc_title=card.wiki_file_name or card.source_title or card.topic,
                section_title=section_title,
                section_text=section_text,
                topics=topics,
                old_front=card.front_text or "",
                old_back=card.back_text or "",
                note_hint=note_hint,
            )
        except ExtractionNotConfiguredError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("flashcard understand failed id=%s mode=%s: %s", card_id, mode, exc)
            raise ValueError("生成理解辅助失败，请稍后重试") from exc

        _write_understand_cache(cache, source_hash=src_hash, provider=provider, payload=payload)
        out = dict(payload)
        out["cached"] = False
        return out


def _back_text_from_explain(payload: dict[str, Any]) -> str:
    parts: list[str] = []
    summary = str(payload.get("summary", "")).strip()
    if summary:
        parts.append(summary)
    analogy = str(payload.get("analogy", "")).strip()
    if analogy:
        parts.append(f"\n\n类比：{analogy}")
    raw_pts = payload.get("key_points")
    if isinstance(raw_pts, list):
        pts = [str(p).strip() for p in raw_pts if str(p).strip()]
        if pts:
            parts.append("\n\n要点：\n" + "\n".join(f"· {p}" for p in pts))
    tip = str(payload.get("remember_tip", "")).strip()
    if tip:
        parts.append(f"\n\n记忆技巧：{tip}")
    body = "".join(parts).strip()
    if len(body) < 48:
        raise ValueError("拆解要点内容过短，无法替换闪卡")
    return body


def _apply_payload_to_card(
    card: KnowledgeFlashcard,
    payload: dict[str, Any],
    *,
    mode: str,
    topics: list[str],
    section_title: str,
) -> None:
    mode = mode.strip().lower()
    if mode == "explain":
        card.back_text = _back_text_from_explain(payload)
    else:
        question = str(payload.get("question", "")).strip()
        answer = str(payload.get("answer", "")).strip()
        if len(question) < 8 or len(answer) < 48:
            raise ValueError("预览内容不完整，请重新生成后再替换")
        card.front_text = question
        card.back_text = answer
        card.visual_mermaid = str(payload.get("visual_mermaid", "")).strip()
        card.visual_image_path = ""

    card.quality_flags = ""
    bundle = visual_bundle_for_card(
        topic=card.topic,
        topics=topics,
        section_title=section_title,
        visual_mermaid=payload.get("visual_mermaid"),
        visual_caption=payload.get("visual_caption"),
    )
    card.visual_palette = bundle.get("visual_palette", card.visual_palette)
    card.visual_emoji = bundle.get("visual_emoji", card.visual_emoji)

    meta = {
        "card_kind": card.card_kind,
        "applied_at": datetime.utcnow().isoformat(),
        "understanding_mode": mode,
        "mode_label": payload.get("mode_label") or UNDERSTANDING_MODE_LABELS.get(mode, mode),
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


def apply_flashcard_understanding(
    card_id: int,
    *,
    mode: str,
    preview: dict[str, Any] | None = None,
) -> KnowledgeFlashcard:
    """将已预览的理解辅助（缓存或客户端传入）写入主闪卡，不再二次调用 LLM。"""
    mode = (mode or "").strip().lower()
    if mode not in UNDERSTANDING_MODE_LABELS:
        raise ValueError(f"不支持的理解模式: {mode}")

    with Session(engine) as session:
        card = session.get(KnowledgeFlashcard, card_id)
        if card is None or not card.active:
            raise ValueError("闪卡不存在")

        payload = preview
        if payload is None:
            src_hash = _cache_key(card, mode)
            cached = _read_understand_cache(_cache_path(card_id, mode), src_hash)
            if cached is None:
                raise ValueError("请先生成理解辅助，再替换闪卡")
            payload = cached

        section_title, _ = _section_context(card)
        topics = _topics_from_card(card)
        _apply_payload_to_card(
            card,
            payload,
            mode=mode,
            topics=topics,
            section_title=section_title,
        )
        session.add(card)
        session.commit()
        session.refresh(card)
        return card
