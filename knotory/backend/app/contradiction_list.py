"""矛盾列表：从入库记录聚合，供信任透明 UI。"""

from __future__ import annotations

import json

from app.storage import list_records


def list_contradictions(*, limit: int = 80) -> list[dict]:
    records = list_records(limit=300)
    by_id = {r.id: r for r in records if r.id is not None}
    out: list[dict] = []
    seen: set[str] = set()
    for rec in records:
        raw = (rec.contradictions_json or "").strip()
        if not raw:
            continue
        try:
            items = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            other_id = item.get("other_record_id")
            key = f"{rec.id}:{other_id}"
            if key in seen:
                continue
            seen.add(key)
            stem = (rec.file_name or "").rsplit(".", 1)[0]
            other_rec = by_id.get(other_id) if other_id is not None else None
            other_stem = (other_rec.file_name or "").rsplit(".", 1)[0] if other_rec else ""
            out.append(
                {
                    "record_id": rec.id,
                    "file_name": rec.file_name,
                    "wiki_file_name": f"{stem}.md" if stem else "",
                    "other_record_id": other_id,
                    "other_file_name": other_rec.file_name if other_rec else "",
                    "other_wiki_file_name": f"{other_stem}.md" if other_stem else "",
                    "overlap_tags": item.get("overlap_tags") or [],
                    "note": item.get("note") or "",
                }
            )
            if len(out) >= limit:
                return out
    return out
