"""租户范围 SQL 过滤。"""

from __future__ import annotations

from sqlalchemy import or_

from app.models import (
    ContentCache,
    FlashcardFeedback,
    FlashcardReviewState,
    FlashcardUserNote,
    IngestRecord,
    KnowledgeClip,
    KnowledgeFlashcard,
    ReadingCompanionCache,
)
from app.tenant import SYSTEM_USER_ID, current_user_id


def uid() -> str:
    return current_user_id()


def user_has_corpus() -> bool:
    """当前租户是否已有入库材料（含 processing）。"""
    from app.storage import list_records, list_wiki_docs  # noqa: PLC0415

    if list_wiki_docs():
        return True
    return bool(list_records(limit=1))


def include_demo_flashcards() -> bool:
    """零语料时展示系统示例卡；用户上传文库后不再混入。"""
    return not user_has_corpus()


def ingest_owned(record: IngestRecord | None) -> bool:
    if record is None:
        return False
    # 兼容迁移前记录与测试替身；真实模型均带 user_id。
    return (getattr(record, "user_id", uid()) or "") == uid()


def flashcard_visible(card: KnowledgeFlashcard | None) -> bool:
    if card is None:
        return False
    owner = card.user_id or ""
    if owner == uid():
        return True
    if owner == SYSTEM_USER_ID and include_demo_flashcards():
        return True
    return False


def flashcard_scope():
    """当前用户可见闪卡；有自有语料时不含系统示例。"""
    if include_demo_flashcards():
        return or_(KnowledgeFlashcard.user_id == uid(), KnowledgeFlashcard.user_id == SYSTEM_USER_ID)
    return KnowledgeFlashcard.user_id == uid()


def ingest_scope():
    return IngestRecord.user_id == uid()


def clip_scope():
    return KnowledgeClip.user_id == uid()


def feedback_scope():
    return FlashcardFeedback.user_id == uid()


def cache_scope():
    return ContentCache.user_id == uid()


def companion_scope():
    return ReadingCompanionCache.user_id == uid()


def review_scope():
    return FlashcardReviewState.user_id == uid()


def note_scope():
    return FlashcardUserNote.user_id == uid()
