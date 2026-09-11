"""定时语料备份任务。"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings
from app.corpus_export import build_corpus_zip_bytes
from app.corpus_store import notify_path_deleted, notify_path_written

logger = logging.getLogger("knotory.backup_jobs")

_lock = threading.Lock()
_state: dict = {
    "last_run_at": None,
    "last_path": None,
    "last_error": None,
    "running": False,
}


def backup_status() -> dict:
    with _lock:
        return dict(_state)


def run_backup_async() -> dict:
    with _lock:
        if _state["running"]:
            return {"ok": False, "hint": "备份正在进行中", **backup_status()}
        _state["running"] = True
        _state["last_error"] = None

    def _run() -> None:
        try:
            data = build_corpus_zip_bytes()
            out_dir = settings.resolved_data_dir / "backups"
            out_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            out_path = out_dir / f"knotory-auto-{stamp}.zip"
            out_path.write_bytes(data)
            notify_path_written(out_path)
            # 保留最近 5 份
            backups = sorted(out_dir.glob("knotory-auto-*.zip"), key=lambda p: p.stat().st_mtime, reverse=True)
            for old in backups[5:]:
                try:
                    notify_path_deleted(old)
                    old.unlink()
                except OSError:
                    pass
            with _lock:
                _state["last_run_at"] = datetime.now(timezone.utc).isoformat()
                _state["last_path"] = str(out_path)
                _state["last_error"] = None
            logger.info("auto backup saved: %s", out_path)
        except Exception as exc:  # noqa: BLE001
            logger.exception("auto backup failed")
            with _lock:
                _state["last_error"] = str(exc)[:500]
        finally:
            with _lock:
                _state["running"] = False

    threading.Thread(target=_run, daemon=True).start()
    return {"ok": True, "started": True, **backup_status()}


def run_scheduled_backup() -> None:
    """供 APScheduler 调用。"""
    with _lock:
        if _state["running"]:
            return
    run_backup_async()
