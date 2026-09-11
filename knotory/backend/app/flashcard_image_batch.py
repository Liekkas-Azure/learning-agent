"""闪卡配图批量重生成（后台任务）。"""

from __future__ import annotations

import logging
import threading

from sqlmodel import Session, select

from app.ark_image import (
    ark_image_config_status,
    build_flashcard_image_prompt,
    generate_and_cache_flashcard_image,
)
from app.models import KnowledgeFlashcard
from app.storage import engine

logger = logging.getLogger("knotory.flashcard_image_batch")

_lock = threading.Lock()
_state: dict = {
    "running": False,
    "total": 0,
    "done": 0,
    "ok": 0,
    "failed": 0,
    "error": None,
}


def image_regenerate_status() -> dict:
    with _lock:
        return dict(_state)


def start_image_regenerate_async(*, limit: int = 200) -> dict:
    status = ark_image_config_status(probe=False)
    if not status.get("ready"):
        return {"ok": False, "hint": status.get("hint") or "文生图未就绪"}

    with _lock:
        if _state["running"]:
            return {"ok": False, "hint": "批量配图正在进行中", **image_regenerate_status()}
        _state.update(running=True, total=0, done=0, ok=0, failed=0, error=None)

    def _run() -> None:
        try:
            with Session(engine) as session:
                cards = list(
                    session.exec(
                        select(KnowledgeFlashcard)
                        .where(KnowledgeFlashcard.active == True)  # noqa: E712
                        .order_by(KnowledgeFlashcard.id)
                        .limit(max(1, min(limit, 500)))
                    )
                )
            with _lock:
                _state["total"] = len(cards)

            for card in cards:
                if card.id is None:
                    continue
                content_key = (card.content_key or "").strip()
                if not content_key:
                    with _lock:
                        _state["done"] += 1
                        _state["failed"] += 1
                    continue
                prompt = build_flashcard_image_prompt(
                    topic=card.topic or "知识",
                    section_title=card.source_title or card.wiki_file_name or card.topic,
                    visual_caption=card.visual_caption or "",
                    front_text=card.front_text or "",
                    back_text=card.back_text or "",
                    card_kind=card.card_kind or "",
                    image_prompt=card.image_prompt or "",
                )
                rel = generate_and_cache_flashcard_image(content_key=content_key, prompt=prompt)
                with Session(engine) as session:
                    row = session.get(KnowledgeFlashcard, card.id)
                    if row is not None and rel:
                        row.visual_image_path = rel
                        session.add(row)
                        session.commit()
                with _lock:
                    _state["done"] += 1
                    if rel:
                        _state["ok"] += 1
                    else:
                        _state["failed"] += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception("image regenerate batch failed")
            with _lock:
                _state["error"] = str(exc)[:500]
        finally:
            with _lock:
                _state["running"] = False

    threading.Thread(target=_run, daemon=True).start()
    return {"ok": True, "started": True, **image_regenerate_status()}
