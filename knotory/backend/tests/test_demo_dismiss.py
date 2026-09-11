"""用户上传语料后不再展示系统示例闪卡。"""

import uuid

from app.demo_flashcards import ensure_demo_flashcards
from app.flashcard_feed import get_active_flashcards
from app.storage import init_db, save_record
from app.tenant import SYSTEM_USER_ID, clear_tenant, set_tenant
from app.tenant_queries import include_demo_flashcards, user_has_corpus


def test_demo_hidden_after_corpus():
    init_db()
    ensure_demo_flashcards()
    uid = f"demo-dismiss-{uuid.uuid4().hex[:8]}"
    set_tenant(user_id=uid, email="d@test.local")
    try:
        assert user_has_corpus() is False
        assert include_demo_flashcards() is True
        with_demo = get_active_flashcards()
        assert any(c.user_id == SYSTEM_USER_ID for c in with_demo)

        save_record("note.md", "/tmp/note.md", "摘要", ["tag"], status="processing")
        assert user_has_corpus() is True
        assert include_demo_flashcards() is False

        without_demo = get_active_flashcards()
        assert all(c.user_id != SYSTEM_USER_ID for c in without_demo)
    finally:
        clear_tenant()
