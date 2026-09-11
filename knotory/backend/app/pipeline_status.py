"""文库流水线聚合状态：入库 + 拆卡 + 各篇闪卡数。"""

from __future__ import annotations

from app.flashcard_sync_job import get_sync_status
from app.ingest_job import list_active_jobs, list_recent_jobs
from app.ingest_pipeline import _slugify
from app.storage import flashcard_counts_by_wiki, list_records


def _wiki_name_for_record(file_name: str) -> str:
    return f"{_slugify(file_name)}.md"


def build_pipeline_status() -> dict:
    sync = get_sync_status()
    counts = flashcard_counts_by_wiki()
    records = list_records(limit=80)
    wiki_items: list[dict] = []
    for rec in records:
        if rec.id is None:
            continue
        wiki_name = _wiki_name_for_record(rec.file_name)
        wiki_items.append(
            {
                "record_id": rec.id,
                "file_name": rec.file_name,
                "wiki_file_name": wiki_name,
                "status": rec.status or "ok",
                "flashcard_count": counts.get(wiki_name, 0),
            }
        )

    active_ingest = list_active_jobs()
    job_record_ids = {int(j["record_id"]) for j in active_ingest}
    for rec in records:
        if rec.id is None or rec.status != "processing":
            continue
        if rec.id in job_record_ids:
            continue
        active_ingest.append(
            {
                "record_id": rec.id,
                "file_name": rec.file_name,
                "stage": "summarizing",
                "error": None,
                "started_at": rec.created_at.isoformat() if rec.created_at else None,
                "finished_at": None,
                "derived_from_record": True,
            }
        )

    return {
        "ingest": {
            "active": active_ingest,
            "recent": list_recent_jobs(6),
            "active_count": len(active_ingest),
        },
        "flashcard_sync": sync,
        "wiki_items": wiki_items,
        "totals": {
            "records": len(records),
            "active_flashcards": sum(counts.values()),
            "wikis_with_cards": sum(1 for c in counts.values() if c > 0),
        },
    }
