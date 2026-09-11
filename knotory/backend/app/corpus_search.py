"""语料全文检索：wiki 正文、入库摘要、剪藏摘录。"""

from __future__ import annotations

import re
from pathlib import Path

from app.config import settings
from app.paths import tenant_data_dir
from app.flashcard_ingest import list_clips
from app.storage import OUTPUT_DIR, WIKI_DIR, list_records, list_wiki_docs


def _score(haystack: str, terms: list[str]) -> int:
    low = haystack.lower()
    return sum(low.count(t) for t in terms)


def search_corpus(query: str, *, limit: int = 40) -> list[dict]:
    q = (query or "").strip()
    if len(q) < 2:
        return []
    terms = [t for t in re.split(r"\s+", q.lower()) if len(t) >= 2]
    if not terms:
        return []

    root = tenant_data_dir()
    hits: list[tuple[int, dict]] = []

    for doc in list_wiki_docs():
        name = (doc.get("name") or "").strip()
        if not name or "/" in name:
            continue
        path = root / WIKI_DIR / name
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")[:120_000]
        except OSError:
            continue
        s = _score(text, terms) + (5 if any(t in name.lower() for t in terms) else 0)
        if s > 0:
            snippet = _snippet(text, terms)
            hits.append(
                (
                    s,
                    {
                        "kind": "wiki",
                        "title": name,
                        "wiki_file_name": name,
                        "snippet": snippet,
                        "score": s,
                    },
                )
            )

    for rec in list_records(limit=200):
        blob = f"{rec.file_name}\n{rec.summary}\n{rec.tags_csv}"
        s = _score(blob, terms)
        stem = Path(rec.file_name).stem
        if s > 0:
            wiki_name = f"{stem}.md"
            hits.append(
                (
                    s + 2,
                    {
                        "kind": "record",
                        "title": rec.file_name,
                        "record_id": rec.id,
                        "wiki_file_name": wiki_name if (root / WIKI_DIR / wiki_name).is_file() else "",
                        "snippet": _snippet(rec.summary or rec.file_name, terms),
                        "score": s,
                    },
                )
            )
        out_path = root / OUTPUT_DIR / f"{stem}.json"
        if out_path.is_file():
            try:
                extra = out_path.read_text(encoding="utf-8", errors="ignore")[:20_000]
                s2 = _score(extra, terms)
                if s2 > s:
                    hits.append(
                        (
                            s2,
                            {
                                "kind": "record",
                                "title": rec.file_name,
                                "record_id": rec.id,
                                "snippet": _snippet(extra, terms),
                                "score": s2,
                            },
                        )
                    )
            except OSError:
                pass

    for clip in list_clips(limit=80):
        blob = f"{clip.source_title}\n{clip.text}\n{clip.source_url}"
        s = _score(blob, terms)
        if s > 0 and clip.id is not None:
            hits.append(
                (
                    s,
                    {
                        "kind": "clip",
                        "title": clip.source_title or f"剪藏 #{clip.id}",
                        "clip_id": clip.id,
                        "wiki_file_name": clip.wiki_file_name or "",
                        "snippet": _snippet(clip.text, terms),
                        "score": s,
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


def _snippet(text: str, terms: list[str], radius: int = 80) -> str:
    low = text.lower()
    pos = -1
    for t in terms:
        i = low.find(t)
        if i >= 0 and (pos < 0 or i < pos):
            pos = i
    if pos < 0:
        return text[:160].replace("\n", " ")
    start = max(0, pos - radius)
    end = min(len(text), pos + radius)
    chunk = text[start:end].replace("\n", " ")
    if start > 0:
        chunk = "…" + chunk
    if end < len(text):
        chunk = chunk + "…"
    return chunk
