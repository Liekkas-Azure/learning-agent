"""闪卡同步后台任务与状态（供前端轮询进度）。"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Callable

from app.flashcards import sync_flashcards_from_corpus
from app.tenant import capture_tenant, clear_tenant, set_tenant

logger = logging.getLogger("knotory.flashcard_sync_job")

_lock = threading.Lock()
_auto_enrich_at: float = 0.0
_pending_queue: list[dict] = []
_state: dict = {
    "running": False,
    "queued": False,
    "use_llm": False,
    "skip_images": False,
    "mode": "full",
    "stage": "idle",
    "started_at": None,
    "finished_at": None,
    "result": None,
    "error": None,
    "progress_current": 0,
    "progress_total": 0,
    "current_wiki": "",
    "wikis_done": 0,
    "wikis_total": 0,
}


def get_sync_status() -> dict:
    with _lock:
        return dict(_state)


def _set_progress(**fields: object) -> None:
    with _lock:
        _state.update(fields)


def _make_progress_callback() -> Callable[..., None]:
    def _on_progress(**kwargs: object) -> None:
        _set_progress(**kwargs)

    return _on_progress


def _enqueue_pending(
    *,
    owner_id: str,
    owner_email: str,
    sync_kwargs: dict,
) -> dict:
    """按租户排队；同租户连续入库合并目标，绝不跨租户混合 record_ids。"""
    for item in _pending_queue:
        if item["owner_id"] != owner_id:
            continue
        previous = item["sync_kwargs"]
        merged = dict(sync_kwargs)
        old_ids = previous.get("record_ids")
        new_ids = sync_kwargs.get("record_ids")
        if old_ids is None or new_ids is None:
            merged["record_ids"] = None
        else:
            merged["record_ids"] = sorted(
                {int(x) for x in old_ids} | {int(x) for x in new_ids}
            )
        old_wikis = previous.get("wiki_file_names")
        new_wikis = sync_kwargs.get("wiki_file_names")
        if old_wikis is None or new_wikis is None:
            merged["wiki_file_names"] = None
        else:
            merged["wiki_file_names"] = sorted(
                {str(x) for x in old_wikis} | {str(x) for x in new_wikis}
            )
        item["sync_kwargs"] = merged
        return item
    item = {
        "owner_id": owner_id,
        "owner_email": owner_email,
        "sync_kwargs": dict(sync_kwargs),
    }
    _pending_queue.append(item)
    return item


def start_sync_async(
    *,
    use_llm: bool = True,
    skip_images: bool = False,
    enrich_after_fast: bool = False,
    llm_only: bool = False,
    fast_only: bool = False,
    wiki_file_names: list[str] | None = None,
    record_ids: list[int] | None = None,
) -> dict:
    owner_id, owner_email = capture_tenant()
    sync_kwargs = {
        "use_llm": use_llm,
        "skip_images": skip_images,
        "enrich_after_fast": enrich_after_fast,
        "llm_only": llm_only,
        "fast_only": fast_only,
        "wiki_file_names": wiki_file_names,
        "record_ids": record_ids,
    }

    with _lock:
        if _state["running"]:
            pending = _enqueue_pending(
                owner_id=owner_id,
                owner_email=owner_email,
                sync_kwargs=sync_kwargs,
            )
            _state["queued"] = True
            logger.info(
                "flashcard sync queued (tenant=%s, record_ids=%s)",
                owner_id,
                pending["sync_kwargs"].get("record_ids"),
            )
            return {
                "ok": True,
                "started": False,
                "queued": True,
                **dict(_state),
            }
        mode = "full"
        if llm_only:
            mode = "llm_only"
        elif fast_only:
            mode = "fast_only"
        elif enrich_after_fast:
            mode = "enrich"
        _state.update(
            {
                "running": True,
                "queued": False,
                "use_llm": use_llm,
                "skip_images": skip_images,
                "enrich_after_fast": enrich_after_fast,
                "llm_only": llm_only,
                "fast_only": fast_only,
                "mode": mode,
                "stage": "starting",
                "started_at": datetime.now(timezone.utc).isoformat(),
                "finished_at": None,
                "result": None,
                "error": None,
                "progress_current": 0,
                "progress_total": 0,
                "current_wiki": "",
                "wikis_done": 0,
                "wikis_total": 0,
                "target_wiki_file_names": list(wiki_file_names or []),
                "target_record_ids": list(record_ids or []),
            }
        )

    def _run() -> None:
        set_tenant(user_id=owner_id, email=owner_email)
        progress_cb = _make_progress_callback()
        sync_kwargs = {
            "wiki_file_names": wiki_file_names,
            "record_ids": record_ids,
        }
        try:
            if enrich_after_fast:
                _set_progress(stage="fast")
                sync_flashcards_from_corpus(use_llm=False, skip_images=True, on_progress=progress_cb, **sync_kwargs)
                _set_progress(stage="llm")
                result = sync_flashcards_from_corpus(use_llm=True, skip_images=False, on_progress=progress_cb, **sync_kwargs)
            elif llm_only:
                _set_progress(stage="llm")
                result = sync_flashcards_from_corpus(use_llm=True, skip_images=True, on_progress=progress_cb, **sync_kwargs)
            elif fast_only:
                _set_progress(stage="fast")
                result = sync_flashcards_from_corpus(use_llm=False, skip_images=True, on_progress=progress_cb, **sync_kwargs)
            else:
                _set_progress(stage="llm" if use_llm else "fast")
                result = sync_flashcards_from_corpus(
                    use_llm=use_llm,
                    skip_images=skip_images,
                    on_progress=progress_cb,
                    **sync_kwargs,
                )
            with _lock:
                _state["result"] = result
                _state["error"] = None
                _state["stage"] = "done"
        except Exception as exc:  # noqa: BLE001
            logger.exception("flashcard sync job failed: %s", exc)
            with _lock:
                _state["error"] = str(exc)[:500]
                _state["stage"] = "failed"
        finally:
            pending: dict | None
            with _lock:
                _state["running"] = False
                _state["finished_at"] = datetime.now(timezone.utc).isoformat()
                pending = _pending_queue.pop(0) if _pending_queue else None
                _state["queued"] = bool(_pending_queue or pending)
            clear_tenant()
            if pending:
                logger.info(
                    "flashcard sync chaining queued job (tenant=%s, record_ids=%s)",
                    pending["owner_id"],
                    pending["sync_kwargs"].get("record_ids"),
                )
                set_tenant(
                    user_id=pending["owner_id"],
                    email=pending["owner_email"],
                )
                try:
                    start_sync_async(**pending["sync_kwargs"])
                finally:
                    clear_tenant()

    threading.Thread(target=_run, daemon=True).start()
    return {"ok": True, "started": True, "queued": False, **get_sync_status()}


def maybe_start_auto_llm_enrich(*, qa_ratio: float, cooldown_sec: float = 3600) -> bool:
    """Feed 首屏 QA 占比低时后台补 LLM 卡，冷却期内不重复触发。"""
    global _auto_enrich_at
    if qa_ratio >= 0.45:
        return False
    with _lock:
        if _state.get("running"):
            return False
        now = time.time()
        if _auto_enrich_at and now - _auto_enrich_at < cooldown_sec:
            return False
        _auto_enrich_at = now
    start_sync_async(llm_only=True, skip_images=True)
    return True
