"""
为星图补边：文档—文档（共享标签）、标签—标签（轻量相似），减轻「只有点、没有丝」的孤岛感。
"""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from typing import Any

from app.tag_semantics import doc_association_overlap

logger = logging.getLogger("knotory.graph_enrich")

# 标签相似：子串判定时双方最短长度下限（中英混合按字符数）
_MIN_TAG_LEN_SIMILAR = 3


def slugify_filename(name: str) -> str:
    """与 main.slugify 一致，供相关册页 wikilink 使用（避免 main↔graph 循环引用）。"""
    plain = re.sub(r"\.[a-zA-Z0-9]+$", "", name)
    plain = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff_-]+", "-", plain).strip("-")
    return plain or "untitled"


def related_wiki_slugs(
    current_file_name: str,
    tags: list[str],
    recent: list[Any],
    *,
    limit: int = 500,
) -> list[str]:
    """
    按与当前上传文件的标签交集，从已有入库记录里选出相关册页 slug（对应 wiki/*.md  basename）。
    `recent` 为 IngestRecord 列表（含 file_name、tags_csv）。
    """
    cur = slugify_filename(current_file_name)
    tag_set = {t.strip() for t in tags if t.strip()}
    if not tag_set:
        return []

    scored: list[tuple[int, str]] = []
    for rec in recent:
        fn = getattr(rec, "file_name", "") or ""
        other = slugify_filename(fn)
        if not other or other == cur:
            continue
        csv = getattr(rec, "tags_csv", "") or ""
        other_tags = {t.strip() for t in csv.split(",") if t.strip()}
        literal, themes = doc_association_overlap(tag_set, other_tags)
        if literal or themes:
            score = len(literal) * 3 + len(themes) * 2
            scored.append((score, other))
    scored.sort(key=lambda x: (-x[0], x[1]))
    out: list[str] = []
    seen: set[str] = set()
    for _, slug in scored:
        if slug in seen:
            continue
        seen.add(slug)
        out.append(slug)
        if len(out) >= limit:
            break
    return out


def _tag_norm(s: str) -> str:
    return (s or "").strip().lower()


def _tags_similar(a: str, b: str) -> bool:
    if a == b:
        return True
    na, nb = _tag_norm(a), _tag_norm(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    if len(na) < _MIN_TAG_LEN_SIMILAR or len(nb) < _MIN_TAG_LEN_SIMILAR:
        return False
    return na in nb or nb in na


def _undirected_key(a: str, b: str) -> frozenset[str]:
    return frozenset({a, b})


def enrich_knotory_graph(payload: dict[str, Any]) -> dict[str, Any]:
    """
    在现有 Document—TAGGED→Tag 之上追加：
    - SHARED_TAG：两册书有字面相同标签，或字面+语义同时成立时优先此边
    - SHARED_SEMANTIC：仅通过同义/近义主题簇对齐（字面标签不同）
    - SIMILAR_TAG：标签互为子串/同形（弱归纳，便于星图聚拢）
    """
    nodes = list(payload.get("nodes") or [])
    links = list(payload.get("links") or [])
    source = payload.get("source", "unknown")

    doc_ids = [n["id"] for n in nodes if n.get("group") == "document"]
    doc_tags: dict[str, set[str]] = defaultdict(set)
    for ln in links:
        if ln.get("kind") != "TAGGED":
            continue
        s, t = ln.get("source"), ln.get("target")
        if not isinstance(s, str) or not isinstance(t, str):
            continue
        if t.startswith("tag:"):
            doc_tags[s].add(t[len("tag:") :])

    new_links: list[dict[str, Any]] = []
    seen_undir: set[frozenset[str]] = set()

    for i, d1 in enumerate(doc_ids):
        t1 = doc_tags.get(d1)
        if not t1:
            continue
        for d2 in doc_ids[i + 1 :]:
            t2 = doc_tags.get(d2)
            if not t2:
                continue
            literal, themes = doc_association_overlap(t1, t2)
            if not literal and not themes:
                continue
            k = _undirected_key(d1, d2)
            if k in seen_undir:
                continue
            seen_undir.add(k)
            if literal:
                new_links.append(
                    {
                        "source": d1,
                        "target": d2,
                        "kind": "SHARED_TAG",
                        "shared_count": len(literal),
                        "semantic_themes": themes,
                    }
                )
            elif themes:
                new_links.append(
                    {
                        "source": d1,
                        "target": d2,
                        "kind": "SHARED_SEMANTIC",
                        "shared_count": len(themes),
                        "semantic_themes": themes,
                    }
                )

    tag_names = sorted({n["id"][len("tag:") :] for n in nodes if n.get("group") == "tag" and str(n.get("id", "")).startswith("tag:")})
    seen_tag_pairs: set[frozenset[str]] = set()
    for i, a in enumerate(tag_names):
        id_a = f"tag:{a}"
        for b in tag_names[i + 1 :]:
            if not _tags_similar(a, b):
                continue
            k = _undirected_key(id_a, f"tag:{b}")
            if k in seen_tag_pairs:
                continue
            seen_tag_pairs.add(k)
            new_links.append({"source": id_a, "target": f"tag:{b}", "kind": "SIMILAR_TAG"})

    if new_links:
        logger.info("Graph enrich: +%s links (doc shared / tag similar)", len(new_links))

    out = {**payload, "nodes": nodes, "links": links + new_links, "source": source}
    return out
