"""Hybrid 检索：向量语义 + 关键词 + 标签/标题加权。"""

from __future__ import annotations

import re
from pathlib import Path

from app.config import settings
from app.paths import tenant_data_dir
from app.corpus_search import _snippet, search_corpus
from app.flashcard_ingest import list_clips
from app.storage import OUTPUT_DIR, WIKI_DIR, list_records, list_wiki_docs


def _terms(query: str) -> list[str]:
    return [t for t in re.split(r"\s+", (query or "").lower()) if len(t) >= 2]


def _tag_overlap(tags_csv: str, terms: list[str]) -> float:
    tags = [t.strip().lower() for t in (tags_csv or "").split(",") if t.strip()]
    if not tags or not terms:
        return 0.0
    hits = sum(1 for tag in tags if any(t in tag or tag in t for t in terms))
    return hits / max(len(tags), 1)


def search_corpus_hybrid(query: str, *, limit: int = 30) -> list[dict]:
    """真 Hybrid：α·向量 + β·关键词（含标签/标题扩展）。"""
    keyword_hits = search_corpus(query, limit=limit * 2)
    vector_hits: list[dict] = []
    try:
        from app.vector_store import search_vectors  # noqa: PLC0415

        vector_hits = search_vectors(query, limit=limit)
    except Exception:  # noqa: BLE001
        vector_hits = []

    alpha = max(0.0, min(1.0, float(getattr(settings, "hybrid_vector_weight", 0.55) or 0.55)))
    beta = 1.0 - alpha

    merged: dict[str, dict] = {}

    if keyword_hits:
        max_kw = max(float(h.get("score", 1) or 1) for h in keyword_hits) or 1.0
        for h in keyword_hits:
            key = f"{h.get('kind')}:{h.get('wiki_file_name') or h.get('title')}"
            kw_n = float(h.get("score", 0) or 0) / max_kw
            item = dict(h)
            item["keyword_score"] = float(h.get("score", 0) or 0)
            item["keyword_norm"] = kw_n
            item["vector_score"] = 0.0
            item["hybrid_score"] = round(beta * kw_n, 4)
            item["match_reason"] = "关键词命中"
            merged[key] = item

    if vector_hits:
        max_v = max(float(h.get("vector_score", 0) or 0) for h in vector_hits) or 1.0
        for h in vector_hits:
            key = f"wiki:{h.get('wiki_file_name') or h.get('source_ref') or h.get('title')}"
            v_n = float(h.get("vector_score", 0) or 0) / max_v
            if key in merged:
                merged[key]["vector_score"] = float(h.get("vector_score", 0) or 0)
                kw_n = float(merged[key].get("keyword_norm", 0) or 0)
                merged[key]["hybrid_score"] = round(alpha * v_n + beta * kw_n, 4)
                merged[key]["match_reason"] = "向量+关键词 Hybrid"
            else:
                item = dict(h)
                item["keyword_score"] = 0.0
                item["hybrid_score"] = round(alpha * v_n, 4)
                item["match_reason"] = h.get("match_reason") or "向量语义命中"
                merged[key] = item

    if merged:
        out = sorted(merged.values(), key=lambda x: -float(x.get("hybrid_score", 0) or 0))
        return out[:limit]

    # 无关键词命中、也无向量时：走标题/标签扩展（原逻辑）

    terms = _terms(query)
    if not terms:
        return []

    root = tenant_data_dir()
    hits: list[tuple[float, dict]] = []

    for doc in list_wiki_docs():
        name = (doc.get("name") or "").strip()
        if not name:
            continue
        title_score = sum(1 for t in terms if t in name.lower()) * 2.0
        if title_score <= 0:
            continue
        path = root / WIKI_DIR / name
        snippet = ""
        if path.is_file():
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")[:80_000]
                snippet = _snippet(text, terms)
            except OSError:
                pass
        hits.append(
            (
                title_score,
                {
                    "kind": "wiki",
                    "title": name,
                    "wiki_file_name": name,
                    "snippet": snippet or name,
                    "keyword_score": 0,
                    "hybrid_score": title_score,
                    "match_reason": "标题/标签语义扩展",
                },
            )
        )

    for rec in list_records(limit=200):
        tag_s = _tag_overlap(rec.tags_csv, terms) * 3.0
        title_s = sum(1 for t in terms if t in (rec.file_name or "").lower())
        blob_s = sum(1 for t in terms if t in (rec.summary or "").lower()) * 0.5
        score = tag_s + title_s + blob_s
        if score <= 0:
            continue
        stem = Path(rec.file_name).stem
        hits.append(
            (
                score,
                {
                    "kind": "record",
                    "title": rec.file_name,
                    "record_id": rec.id,
                    "wiki_file_name": f"{stem}.md",
                    "snippet": _snippet(rec.summary or rec.file_name, terms),
                    "keyword_score": 0,
                    "hybrid_score": round(score, 3),
                    "match_reason": "标签/摘要相关",
                },
            )
        )

    for clip in list_clips(limit=60):
        blob = f"{clip.source_title}\n{clip.text}"
        score = sum(1 for t in terms if t in blob.lower()) * 0.8
        if score <= 0 or clip.id is None:
            continue
        hits.append(
            (
                score,
                {
                    "kind": "clip",
                    "title": clip.source_title or f"剪藏 #{clip.id}",
                    "clip_id": clip.id,
                    "wiki_file_name": clip.wiki_file_name or "",
                    "snippet": _snippet(clip.text, terms),
                    "keyword_score": 0,
                    "hybrid_score": round(score, 3),
                    "match_reason": "摘录相关",
                },
            )
        )

    hits.sort(key=lambda x: -x[0])
    seen: set[str] = set()
    out: list[dict] = []
    for _, item in hits:
        key = f"{item['kind']}:{item.get('wiki_file_name') or item.get('record_id') or item.get('clip_id')}"
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
        if len(out) >= limit:
            break
    return out
