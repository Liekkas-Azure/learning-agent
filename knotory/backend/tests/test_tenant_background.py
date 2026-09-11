"""后台任务应继承上传时的租户上下文。"""

from app.flashcard_sync_job import start_sync_async
from app.tenant import clear_tenant, current_user_id, set_tenant


def test_start_sync_async_runs_under_captured_tenant(monkeypatch):
    seen: list[str] = []

    def _fake_sync(**_kwargs):
        seen.append(current_user_id())
        return {"created": 0, "updated": 0, "deactivated": 0, "active": 0}

    monkeypatch.setattr("app.flashcard_sync_job.sync_flashcards_from_corpus", _fake_sync)
    monkeypatch.setattr(
        "app.flashcard_sync_job.threading.Thread",
        lambda target, daemon=True: type("T", (), {"start": lambda self: target()})(),
    )

    set_tenant(user_id="user-abc", email="abc@test.local")
    try:
        out = start_sync_async(fast_only=True)
    finally:
        clear_tenant()

    assert out["ok"] is True
    assert seen == ["user-abc"]
