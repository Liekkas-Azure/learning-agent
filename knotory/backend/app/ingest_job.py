"""入库后台任务状态（供 pipeline 轮询）。"""

from __future__ import annotations

import threading
from datetime import datetime, timezone

_lock = threading.Lock()
_jobs: dict[int, dict] = {}


def register_job(record_id: int, *, file_name: str, stage: str = "parsing") -> None:
    with _lock:
        _jobs[record_id] = {
            "record_id": record_id,
            "file_name": file_name,
            "stage": stage,
            "error": None,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
        }


def update_job(record_id: int, *, stage: str | None = None, **extra: object) -> None:
    with _lock:
        job = _jobs.get(record_id)
        if job is None:
            return
        if stage is not None:
            job["stage"] = stage
        job.update(extra)


def complete_job(record_id: int) -> None:
    with _lock:
        job = _jobs.get(record_id)
        if job is None:
            return
        job["stage"] = "done"
        job["finished_at"] = datetime.now(timezone.utc).isoformat()


def fail_job(record_id: int, error: str) -> None:
    with _lock:
        job = _jobs.get(record_id)
        if job is None:
            return
        job["stage"] = "failed"
        job["error"] = error[:500]
        job["finished_at"] = datetime.now(timezone.utc).isoformat()


def list_active_jobs() -> list[dict]:
    with _lock:
        out: list[dict] = []
        for job in _jobs.values():
            if job.get("stage") not in ("done", "failed"):
                out.append(dict(job))
        return out


def list_recent_jobs(limit: int = 8) -> list[dict]:
    with _lock:
        items = sorted(_jobs.values(), key=lambda j: j.get("started_at") or "", reverse=True)
        return [dict(j) for j in items[: max(1, limit)]]
