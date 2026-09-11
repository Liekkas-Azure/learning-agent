"""剪藏入库与监视目录扫描。"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

from sqlmodel import Session, select

from app.config import settings
from app.corpus_store import notify_path_written
from app.llm import ExtractionNotConfiguredError
from app.models import KnowledgeClip
from app.storage import WIKI_DIR, engine, list_records

logger = logging.getLogger("knotory.flashcard_ingest")

_CLIP_DIR = "clips"
_ALLOWED_SUFFIX = {".pdf", ".md", ".txt", ".docx", ".pptx", ".png", ".jpg", ".jpeg", ".webp"}


def _slug(s: str) -> str:
    plain = re.sub(r"\.[a-zA-Z0-9]+$", "", s)
    plain = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff_-]+", "-", plain).strip("-")
    return plain or "clip"


def _archive_source_url(url: str, clip_id: int) -> str | None:
    u = (url or "").strip()
    if not u.startswith(("http://", "https://")):
        return None
    root = settings.resolved_data_dir / "raw" / "clips"
    root.mkdir(parents=True, exist_ok=True)
    dest = root / f"clip-{clip_id}-source.html"
    try:
        req = Request(u, headers={"User-Agent": "Knotory/1.0 (personal corpus)"})
        with urlopen(req, timeout=12) as resp:  # noqa: S310
            data = resp.read(512_000)
        dest.write_bytes(data)
        return str(dest)
    except (URLError, OSError, ValueError) as exc:
        logger.info("clip url archive skipped %s: %s", u, exc)
        return None


def save_clip(
    *,
    text: str,
    source_title: str = "",
    source_url: str = "",
    wiki_file_name: str = "",
    section_id: str = "",
    tags: list[str] | None = None,
) -> KnowledgeClip:
    body = (text or "").strip()
    if len(body) < 8:
        raise ValueError("剪藏内容过短")
    tags_csv = ",".join(t.strip() for t in (tags or []) if t.strip())
    with Session(engine) as session:
        clip = KnowledgeClip(
            text=body[:8000],
            source_title=(source_title or "")[:200],
            source_url=(source_url or "")[:500],
            wiki_file_name=(wiki_file_name or "")[:255],
            section_id=(section_id or "")[:120],
            tags_csv=tags_csv,
        )
        session.add(clip)
        session.commit()
        session.refresh(clip)

    root = settings.resolved_data_dir
    clip_dir = root / "outputs" / _CLIP_DIR
    clip_dir.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha256(body.encode("utf-8")).hexdigest()[:12]
    fname = f"clip-{clip.id or 0}-{h}.md"
    md_path = clip_dir / fname
    archive_path = _archive_source_url(source_url, int(clip.id or 0))
    lines = [
        "---",
        f"source_title: {source_title or '剪藏'}",
        f"source_url: {source_url or ''}",
        f"tags: {tags_csv}",
        f"created_at: {datetime.now(timezone.utc).isoformat()}",
    ]
    if archive_path:
        lines.append(f"source_archive: {archive_path}")
    lines.extend(["---", "", body])
    md_path.write_text("\n".join(lines), encoding="utf-8")
    notify_path_written(md_path)

    wiki_root = root / WIKI_DIR
    wiki_root.mkdir(parents=True, exist_ok=True)
    wiki_name = wiki_file_name.strip() if wiki_file_name else f"clip-{_slug(source_title or fname)}-{h}.md"
    excerpt_block = f"\n\n> 摘录\n\n{body}\n"
    if source_url:
        excerpt_block = f"\n\n> 来源：[{source_url}]({source_url})\n\n{body}\n"
    wiki_path = wiki_root / wiki_name
    wiki_path.write_text(
        f"# {source_title or '剪藏摘录'}{excerpt_block}",
        encoding="utf-8",
    )
    notify_path_written(wiki_path)
    if clip.id is not None:
        with Session(engine) as session:
            row = session.get(KnowledgeClip, clip.id)
            if row is not None:
                row.wiki_file_name = wiki_name
                session.add(row)
                session.commit()
                session.refresh(clip)
    return clip


def ingest_clip_to_corpus(clip: KnowledgeClip, *, tags: list[str] | None = None) -> dict:
    """将剪藏纳入正式 IngestRecord / 关联图 / 闪卡流水线。"""
    from app.ingest_pipeline import ingest_text_document  # noqa: PLC0415

    tag_list = tags or [t.strip() for t in (clip.tags_csv or "").split(",") if t.strip()]
    wiki_name = (clip.wiki_file_name or "").strip() or f"clip-{clip.id}.md"
    header = ""
    if clip.source_url:
        header = f"原文链接: {clip.source_url}\n\n"
    body = header + (clip.text or "")
    file_label = clip.source_title.strip() or wiki_name
    ingest_name = file_label if file_label.endswith(".md") else f"{_slug(file_label)}.md"

    try:
        return ingest_text_document(
            ingest_name,
            body,
            tags=tag_list,
            source_url=clip.source_url or "",
            skip_llm=False,
        )
    except ExtractionNotConfiguredError:
        return ingest_text_document(
            ingest_name,
            body,
            tags=tag_list or ["剪藏", "inbox"],
            source_url=clip.source_url or "",
            skip_llm=True,
        )


def list_clips(limit: int = 50) -> list[KnowledgeClip]:
    with Session(engine) as session:
        st = select(KnowledgeClip).order_by(KnowledgeClip.id.desc()).limit(limit)
        return list(session.exec(st))


def scan_watch_folder() -> dict:
    """扫描 KNOTORY_WATCH_DIR 下新文件（按 basename 是否已入库判断）。"""
    watch = (settings.watch_dir or "").strip()
    if not watch:
        return {"ok": False, "hint": "未配置 KNOTORY_WATCH_DIR", "imported": 0, "skipped": 0}
    root = Path(watch).expanduser().resolve()
    if not root.is_dir():
        return {"ok": False, "hint": f"目录不存在: {root}", "imported": 0, "skipped": 0}

    known = {r.file_name for r in list_records(limit=500)}
    imported = 0
    skipped = 0
    errors: list[str] = []

    from app.ingest_pipeline import ingest_file_bytes

    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() not in _ALLOW_SUFFIX:
            skipped += 1
            continue
        if path.name in known:
            skipped += 1
            continue
        try:
            raw = path.read_bytes()
            ingest_file_bytes(path.name, raw)
            imported += 1
            known.add(path.name)
        except Exception as exc:  # noqa: BLE001
            logger.warning("watch import failed %s: %s", path, exc)
            errors.append(f"{path.name}: {exc}")

    meta_path = settings.resolved_data_dir / "outputs" / "watch_scan.json"
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(
        json.dumps(
            {
                "watch_dir": str(root),
                "imported": imported,
                "skipped": skipped,
                "errors": errors[:20],
                "scanned_at": datetime.now(timezone.utc).isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    notify_path_written(meta_path)
    return {
        "ok": True,
        "watch_dir": str(root),
        "imported": imported,
        "skipped": skipped,
        "errors": errors[:20],
    }


def schedule_clip_corpus_ingest(clip: KnowledgeClip, *, tags: list[str] | None = None) -> None:
    def _run() -> None:
        try:
            ingest_clip_to_corpus(clip, tags=tags)
        except Exception as exc:  # noqa: BLE001
            logger.warning("clip corpus ingest failed: %s", exc)

    threading.Thread(target=_run, daemon=True).start()
