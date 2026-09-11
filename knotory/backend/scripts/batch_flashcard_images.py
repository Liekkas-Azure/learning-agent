#!/usr/bin/env python3
"""为所有活跃知识闪卡批量生成 AI 配图并写回数据库。"""

from __future__ import annotations

import logging
import sys
import time

from sqlmodel import Session, select

from app.ark_image import (
    ark_image_config_status,
    build_flashcard_image_prompt,
    generate_and_cache_flashcard_image,
)
from app.models import KnowledgeFlashcard
from app.storage import engine, init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("knotory.batch_images")


def main() -> int:
    init_db()
    status = ark_image_config_status(probe=True)
    if not status.get("ready"):
        logger.error("文生图未就绪: %s", status.get("hint"))
        return 1

    with Session(engine) as session:
        cards = list(
            session.exec(
                select(KnowledgeFlashcard)
                .where(KnowledgeFlashcard.active == True)  # noqa: E712
                .order_by(KnowledgeFlashcard.id)
            )
        )

    total = len(cards)
    logger.info("开始批量配图：共 %s 张活跃闪卡", total)
    ok = 0
    skipped = 0
    failed = 0
    t0 = time.time()

    for i, card in enumerate(cards, start=1):
        rel_existing = (card.visual_image_path or "").strip()
        content_key = (card.content_key or "").strip()
        if not content_key:
            skipped += 1
            logger.warning("[%s/%s] id=%s 跳过：无 content_key", i, total, card.id)
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
        if rel:
            with Session(engine) as session:
                row = session.get(KnowledgeFlashcard, card.id)
                if row is not None:
                    row.visual_image_path = rel
                    session.add(row)
                    session.commit()
            ok += 1
            logger.info("[%s/%s] id=%s ok -> %s", i, total, card.id, rel)
        elif rel_existing:
            skipped += 1
            logger.info("[%s/%s] id=%s 已有配图", i, total, card.id)
        else:
            failed += 1
            logger.warning("[%s/%s] id=%s 生成失败", i, total, card.id)

    elapsed = time.time() - t0
    logger.info(
        "BATCH_COMPLETE ok=%s failed=%s skipped=%s total=%s elapsed_sec=%.0f",
        ok,
        failed,
        skipped,
        total,
        elapsed,
    )
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
