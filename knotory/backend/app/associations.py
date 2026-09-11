"""从入库记录计算文档—文档关联（字面共享标签 + 语义同义簇），供首页直接展示。"""

from __future__ import annotations

from typing import Any

from app.graph_enrich import slugify_filename
from app.storage import list_records
from app.tag_semantics import doc_association_overlap


def build_record_associations(*, limit: int = 40) -> dict[str, Any]:
    """
    返回 nodes（含 slug 便于链到 wiki）与 edges。
    - shared_tags：两册标签字面交集
    - semantic_themes：通过同义/近义簇对齐后的共同主题（可与字面交集并存）
    - via_semantic：无字面交集、仅靠语义主题连上的边
    """
    lim = max(1, min(limit, 200))
    rows = list_records(limit=lim)
    nodes: list[dict[str, Any]] = []
    for r in rows:
        rid = getattr(r, "id", None)
        if rid is None:
            continue
        fn = getattr(r, "file_name", "") or ""
        tags_csv = getattr(r, "tags_csv", "") or ""
        tag_set = {t.strip() for t in tags_csv.split(",") if t.strip()}
        nodes.append(
            {
                "id": rid,
                "file_name": fn,
                "slug": slugify_filename(fn),
                "tags": sorted(tag_set),
            }
        )

    id_to_tags = {n["id"]: set(n["tags"]) for n in nodes}
    edges: list[dict[str, Any]] = []
    ids = [n["id"] for n in nodes]
    for i, a in enumerate(ids):
        ta = id_to_tags.get(a) or set()
        if not ta:
            continue
        for b in ids[i + 1 :]:
            tb = id_to_tags.get(b) or set()
            if not tb:
                continue
            literal, themes = doc_association_overlap(ta, tb)
            if not literal and not themes:
                continue
            edges.append(
                {
                    "source_id": a,
                    "target_id": b,
                    "shared_tags": literal,
                    "semantic_themes": themes,
                    "via_semantic": bool(themes) and not bool(literal),
                }
            )

    edges.sort(
        key=lambda e: (
            -(len(e["shared_tags"]) + len(e["semantic_themes"])),
            bool(e.get("via_semantic")),
            e["source_id"],
            e["target_id"],
        )
    )
    return {"nodes": nodes, "edges": edges}
