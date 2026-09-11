"""个人语料库可迁移导出：manifest 与 zip 归档。"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings
from app.corpus_store import ensure_local_path
from app.paths import tenant_data_dir
from app.storage import OUTPUT_DIR, RAW_DIR, WIKI_DIR, list_wiki_docs
from app.tenant import auth_enabled

MANIFEST_VERSION = 1


def _rel(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.name


def _corpus_root() -> Path:
    return tenant_data_dir()


def build_corpus_manifest() -> dict:
    root = _corpus_root()
    storage_backend = settings.resolved_storage_backend
    documents: list[dict] = []
    for doc in list_wiki_docs():
        name = doc.get("name") or ""
        if not name or "/" in name or "\\" in name:
            continue
        stem = Path(name).stem
        if not stem:
            continue
        wiki_path = ensure_local_path(root / WIKI_DIR / name)
        extracted_path = ensure_local_path(root / RAW_DIR / f"{stem}.txt")
        ai_path = ensure_local_path(root / RAW_DIR / f"{stem}.ai.txt")
        meta_path = ensure_local_path(root / RAW_DIR / f"{stem}.ai.meta.json")
        source_path = ensure_local_path(root / RAW_DIR / f"{stem}.source")
        output_path = ensure_local_path(root / OUTPUT_DIR / f"{stem}.json")
        entry: dict = {
            "slug": stem,
            "wiki_file": name,
            "paths": {},
        }
        if wiki_path.is_file():
            entry["paths"]["wiki"] = _rel(wiki_path, root)
        if extracted_path.is_file():
            entry["paths"]["extracted"] = _rel(extracted_path, root)
        if ai_path.is_file():
            entry["paths"]["ai_formatted"] = _rel(ai_path, root)
        if meta_path.is_file():
            entry["paths"]["ai_format_meta"] = _rel(meta_path, root)
        if source_path.is_file():
            entry["paths"]["original_upload"] = _rel(source_path, root)
        if output_path.is_file():
            entry["paths"]["ingest_output"] = _rel(output_path, root)
        documents.append(entry)

    db_note = (
        "多用户云端模式下 zip 不含全局索引库；请另下载闪卡 Markdown/JSON 与笔记导出。"
        if auth_enabled()
        else "归档 zip 可含 knotory.db（若存在），内含闪卡、SRS、反馈、伴读缓存等。"
    )
    database_file = None
    if not auth_enabled():
        db_path = settings.resolved_db_path
        if db_path.is_file():
            try:
                database_file = _rel(db_path, settings.resolved_data_dir)
            except ValueError:
                database_file = db_path.name

    return {
        "manifest_version": MANIFEST_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "storage_mode": "cloud" if storage_backend == "s3" else "local",
        "storage_backend": storage_backend,
        "corpus_scope": "user_cloud_corpus",
        "layout": {
            "wiki": "Obsidian 兼容 Markdown，可使用 [[双向链接]]",
            "raw": "抽取正文 .txt、AI 稿 .ai.txt、审计 .ai.meta.json、原件 .source",
            "outputs": "导入摘要与标签 JSON",
        },
        "documents": documents,
        "note": db_note,
        "database_file": database_file,
        "export_endpoints": {
            "flashcards_markdown": "/api/v1/flashcards/export/markdown",
            "flashcards_json": "/api/v1/flashcards/export/json",
            "notes_markdown": "/api/v1/flashcards/notes/export",
            "obsidian_vault": "/api/v1/corpus/export/obsidian",
        },
    }


def iter_corpus_archive_files(root: Path) -> list[tuple[str, Path]]:
    """返回 (zip 内路径, 磁盘路径) 列表。"""
    out: list[tuple[str, Path]] = []
    for wiki_dir in (root / WIKI_DIR, root / RAW_DIR, root / OUTPUT_DIR):
        if not wiki_dir.is_dir():
            continue
        for p in sorted(wiki_dir.rglob("*")):
            if not p.is_file():
                continue
            local = ensure_local_path(p)
            if local.is_file():
                out.append((_rel(local, root), local))
    return out


def build_corpus_zip_bytes() -> bytes:
    root = _corpus_root()
    buf = io.BytesIO()
    manifest = build_corpus_manifest()
    db_path = settings.resolved_db_path
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "manifest.json",
            json.dumps(manifest, ensure_ascii=False, indent=2),
            compress_type=zipfile.ZIP_DEFLATED,
        )
        for arcname, disk_path in iter_corpus_archive_files(root):
            zf.write(disk_path, arcname=arcname)
        if not auth_enabled() and db_path.is_file():
            try:
                arc = _rel(db_path, settings.resolved_data_dir)
            except ValueError:
                arc = db_path.name
            zf.write(db_path, arcname=arc)
    return buf.getvalue()
