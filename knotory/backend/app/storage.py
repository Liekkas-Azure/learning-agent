import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import text
from sqlmodel import Session, SQLModel, create_engine, select

from app.config import settings
from app.paths import tenant_data_dir
from app.tenant import current_user_id
from app.tenant_queries import cache_scope, feedback_scope, ingest_scope, flashcard_scope
from app.corpus_store import (
    OUTPUT_DIR,
    RAW_DIR,
    WIKI_DIR,
    ensure_local_path,
    notify_path_deleted,
    notify_path_written,
)
from app.models import ContentCache, IngestRecord, ReadingCompanionCache

logger = logging.getLogger("knotory.storage")

engine = create_engine(
    f"sqlite:///{settings.resolved_db_path}",
    echo=False,
    connect_args={"check_same_thread": False, "timeout": 30},
)


def _migrate_flashcard_visual_columns() -> None:
    """为已有 SQLite 库补充闪卡可视化列。"""
    cols = {
        "visual_mermaid": "TEXT DEFAULT ''",
        "visual_caption": "TEXT DEFAULT ''",
        "visual_palette": "TEXT DEFAULT ''",
        "visual_emoji": "TEXT DEFAULT ''",
        "visual_image_path": "TEXT DEFAULT ''",
        "image_prompt": "TEXT DEFAULT ''",
        "quality_score": "REAL DEFAULT 1.0",
        "quality_flags": "TEXT DEFAULT ''",
        "source_anchor": "TEXT DEFAULT ''",
        "generation_meta": "TEXT DEFAULT ''",
    }
    with engine.connect() as conn:
        rows = conn.execute(text("PRAGMA table_info(knowledgeflashcard)")).fetchall()
        existing = {r[1] for r in rows}
        for name, ddl in cols.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE knowledgeflashcard ADD COLUMN {name} {ddl}"))
        conn.commit()


def _migrate_ingest_columns() -> None:
    cols = {"contradictions_json": "TEXT DEFAULT '[]'"}
    with engine.connect() as conn:
        rows = conn.execute(text("PRAGMA table_info(ingestrecord)")).fetchall()
        existing = {r[1] for r in rows}
        for name, ddl in cols.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE ingestrecord ADD COLUMN {name} {ddl}"))
        try:
            conn.execute(text("PRAGMA journal_mode=WAL"))
        except Exception:  # noqa: BLE001
            pass
        conn.commit()


def _migrate_tenant_columns() -> None:
    """为已有库补充 user_id 列（多租户）。"""
    tables_cols = {
        "ingestrecord": "user_id",
        "contentcache": "user_id",
        "knowledgeflashcard": "user_id",
        "flashcardreviewstate": "user_id",
        "flashcardusernote": "user_id",
        "knowledgeclip": "user_id",
        "flashcardfeedback": "user_id",
        "readingcompanioncache": "user_id",
    }
    with engine.connect() as conn:
        for table, col in tables_cols.items():
            rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            existing = {r[1] for r in rows}
            if col not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} TEXT DEFAULT '__default__'"))
        conn.commit()


def _migrate_student_state_columns() -> None:
    """为早期 Student State 表补 BKT/DKT 融合字段。"""
    cols = {
        "bkt_probability": "REAL DEFAULT 0.2",
        "dkt_probability": "REAL DEFAULT 0.2",
        "dkt_model": "TEXT DEFAULT ''",
        "dkt_sequence_length": "INTEGER DEFAULT 0",
        "dkt_loss": "REAL",
        "confidence": "REAL DEFAULT 0.0",
    }
    with engine.connect() as conn:
        rows = conn.execute(text("PRAGMA table_info(conceptmastery)")).fetchall()
        existing = {r[1] for r in rows}
        for name, ddl in cols.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE conceptmastery ADD COLUMN {name} {ddl}"))
        memory_rows = conn.execute(text("PRAGMA table_info(memoryepisode)")).fetchall()
        memory_existing = {r[1] for r in memory_rows}
        if memory_rows and "memory_key" not in memory_existing:
            conn.execute(
                text("ALTER TABLE memoryepisode ADD COLUMN memory_key TEXT DEFAULT ''")
            )
        conn.commit()


def init_db() -> None:
    settings.resolved_db_path.parent.mkdir(parents=True, exist_ok=True)
    from app.models import (  # noqa: PLC0415
        BanditArmStat,
        ConceptMastery,
        FlashcardReviewState,
        FlashcardUserNote,
        KnowledgePrerequisite,
        KnowledgeClip,
        MemoryEpisode,
        StudentObservation,
        User,
        UserLearningProfile,
        VectorChunk,
        WaitlistEmail,
    )

    _ = (
        FlashcardReviewState,
        FlashcardUserNote,
        KnowledgeClip,
        User,
        WaitlistEmail,
        ConceptMastery,
        MemoryEpisode,
        VectorChunk,
        BanditArmStat,
        StudentObservation,
        UserLearningProfile,
        KnowledgePrerequisite,
    )
    SQLModel.metadata.create_all(engine)
    try:
        _migrate_flashcard_visual_columns()
        _migrate_ingest_columns()
        _migrate_tenant_columns()
        _migrate_student_state_columns()
    except Exception as exc:  # noqa: BLE001
        logger.warning("flashcard visual migration skipped: %s", exc)
    logger.info("SQLite initialized at %s", settings.resolved_db_path)


def save_record(
    file_name: str,
    source_path: str,
    summary: str,
    tags: list[str],
    *,
    contradictions: list | None = None,
    status: str = "ok",
) -> IngestRecord:
    cj = json.dumps(contradictions or [], ensure_ascii=False)
    owner = current_user_id()
    with Session(engine) as session:
        rec = IngestRecord(
            user_id=owner,
            file_name=file_name,
            source_path=source_path,
            summary=summary,
            tags_csv=",".join(tags),
            contradictions_json=cj,
            status=status,
        )
        session.add(rec)
        session.commit()
        session.refresh(rec)
        return rec


def update_record(record_id: int, **fields: object) -> IngestRecord | None:
    with Session(engine) as session:
        rec = session.get(IngestRecord, record_id)
        if rec is None:
            return None
        for key, value in fields.items():
            if hasattr(rec, key):
                setattr(rec, key, value)
        session.add(rec)
        session.commit()
        session.refresh(rec)
        return rec


def flashcard_counts_by_wiki() -> dict[str, int]:
    from app.models import KnowledgeFlashcard  # noqa: PLC0415

    with Session(engine) as session:
        rows = session.exec(
            select(KnowledgeFlashcard.wiki_file_name)
            .where(KnowledgeFlashcard.active == True)  # noqa: E712
            .where(flashcard_scope())
        ).all()
    counts: dict[str, int] = {}
    for name in rows:
        key = (name or "").strip()
        if not key:
            continue
        counts[key] = counts.get(key, 0) + 1
    return counts


def list_saved_flashcards(limit: int = 40) -> list[dict]:
    """最近「保存」反馈对应的闪卡（搞懂清单）。"""
    from app.models import FlashcardFeedback, KnowledgeFlashcard  # noqa: PLC0415

    lim = max(1, min(limit, 100))
    owner = current_user_id()
    with Session(engine) as session:
        fb_rows = session.exec(
            select(FlashcardFeedback)
            .where(FlashcardFeedback.action == "save")
            .where(FlashcardFeedback.user_id == owner)
            .order_by(FlashcardFeedback.id.desc())
            .limit(lim * 3)
        ).all()
        seen: set[int] = set()
        out: list[dict] = []
        for fb in fb_rows:
            if fb.flashcard_id in seen:
                continue
            card = session.get(KnowledgeFlashcard, fb.flashcard_id)
            if card is None or not card.active:
                continue
            seen.add(fb.flashcard_id)
            out.append(
                {
                    "id": card.id,
                    "front_text": card.front_text,
                    "back_text": card.back_text[:280],
                    "wiki_file_name": card.wiki_file_name,
                    "section_id": card.section_id,
                    "topic": card.topic,
                    "saved_at": fb.created_at.isoformat() if fb.created_at else "",
                }
            )
            if len(out) >= lim:
                break
        return out


def list_records(limit: int = 50) -> list[IngestRecord]:
    with Session(engine) as session:
        st = (
            select(IngestRecord)
            .where(ingest_scope())
            .order_by(IngestRecord.id.desc())
            .limit(limit)
        )
        return list(session.exec(st))


def get_record_by_id(record_id: int) -> IngestRecord | None:
    with Session(engine) as session:
        return session.get(IngestRecord, record_id)


def delete_record_by_id(record_id: int) -> bool:
    with Session(engine) as session:
        rec = session.get(IngestRecord, record_id)
        if rec is None:
            return False
        session.delete(rec)
        session.commit()
        return True


def delete_caches_for_ingest_record(record_id: int) -> int:
    """删除与该入库记录关联的内容缓存行（便于同文件再次上传重新编译）。"""
    with Session(engine) as session:
        st = select(ContentCache).where(ContentCache.ingest_record_id == record_id)
        rows = list(session.exec(st))
        for row in rows:
            session.delete(row)
        if rows:
            session.commit()
        return len(rows)


def delete_raw_artifacts(base_name: str) -> None:
    """删除 raw/wiki/outputs 下与 base_name 对应的产物（禁止路径穿越）。"""
    if not base_name or ".." in base_name or "/" in base_name or "\\" in base_name:
        logger.warning("Refusing delete for unsafe base_name: %r", base_name)
        return
    root = tenant_data_dir()
    names = (
        (RAW_DIR, f"{base_name}.txt"),
        (RAW_DIR, f"{base_name}.ai.txt"),
        (RAW_DIR, f"{base_name}.ai.meta.json"),
        (RAW_DIR, f"{base_name}.source"),
        (WIKI_DIR, f"{base_name}.md"),
        (OUTPUT_DIR, f"{base_name}.json"),
    )
    for sub, fname in names:
        p = root / sub / fname
        try:
            if p.is_file():
                notify_path_deleted(p)
            p.unlink(missing_ok=True)
        except OSError as exc:
            logger.warning("Could not delete %s: %s", p, exc)


def get_cache_by_hash(sha256_hex: str) -> ContentCache | None:
    with Session(engine) as session:
        st = select(ContentCache).where(ContentCache.content_sha256 == sha256_hex).where(cache_scope())
        return session.exec(st).first()


def delete_content_cache_by_sha256(sha256_hex: str) -> bool:
    """按内容哈希删除摘要缓存行（用于孤儿缓存：记录已删但 ContentCache 仍命中）。"""
    with Session(engine) as session:
        st = select(ContentCache).where(ContentCache.content_sha256 == sha256_hex)
        row = session.exec(st).first()
        if row is None:
            return False
        session.delete(row)
        session.commit()
        return True


def upsert_content_cache(
    *,
    sha256_hex: str,
    file_name: str,
    base_name: str,
    ingest_record_id: int | None,
    output_json: str,
) -> ContentCache:
    with Session(engine) as session:
        st = select(ContentCache).where(ContentCache.content_sha256 == sha256_hex).where(cache_scope())
        existing = session.exec(st).first()
        if existing:
            existing.file_name = file_name
            existing.base_name = base_name
            existing.ingest_record_id = ingest_record_id
            existing.output_json = output_json
            session.add(existing)
            session.commit()
            session.refresh(existing)
            return existing
        row = ContentCache(
            user_id=current_user_id(),
            content_sha256=sha256_hex,
            file_name=file_name,
            base_name=base_name,
            ingest_record_id=ingest_record_id,
            output_json=output_json,
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row


def write_raw_file(base_name: str, content: str) -> Path:
    p = tenant_data_dir() / RAW_DIR / f"{base_name}.txt"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    notify_path_written(p)
    return p


def write_raw_ai_formatted_file(
    base_name: str,
    content: str,
    *,
    provider: str | None = None,
    segments: int | None = None,
) -> Path:
    """入库或手动重排后写入：大模型整理后的正文（与 .txt 同源 slug）。"""
    safe = Path(str(base_name)).name
    if not safe:
        raise ValueError("invalid base_name")
    p = tenant_data_dir() / RAW_DIR / f"{safe}.ai.txt"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    notify_path_written(p)
    if provider is not None:
        write_ai_format_meta(safe, provider=provider, segments=int(segments or 0))
    return p


def sha256_hex_file(path: Path) -> str | None:
    if not path.is_file():
        return None
    try:
        h = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None


def write_ai_format_meta(base_name: str, *, provider: str, segments: int) -> Path:
    """记录 AI 稿排版/重跑的模型与分段信息，便于审计。"""
    safe = Path(str(base_name)).name
    if not safe:
        raise ValueError("invalid base_name")
    root = tenant_data_dir()
    extracted_path = root / RAW_DIR / f"{safe}.txt"
    meta = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "provider": provider,
        "segments": int(segments),
        "operation": "format_extracted_body",
    }
    src_hash = sha256_hex_file(extracted_path)
    if src_hash:
        meta["source_sha256"] = src_hash
    path = root / RAW_DIR / f"{safe}.ai.meta.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    notify_path_written(path)
    return path


def read_ai_format_meta_for_wiki(wiki_name: str) -> dict | None:
    """读取 raw/{stem}.ai.meta.json；无文件时返回 None。"""
    safe = Path(wiki_name).name
    stem = Path(safe).stem
    if not stem:
        return None
    p = ensure_local_path(tenant_data_dir() / RAW_DIR / f"{stem}.ai.meta.json")
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def write_wiki_file(base_name: str, markdown: str) -> Path:
    p = tenant_data_dir() / WIKI_DIR / f"{base_name}.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(markdown, encoding="utf-8")
    notify_path_written(p)
    return p


def write_output_file(base_name: str, content: str) -> Path:
    p = tenant_data_dir() / OUTPUT_DIR / f"{base_name}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    notify_path_written(p)
    return p


def list_wiki_docs() -> list[dict]:
    docs: list[dict] = []
    wiki_dir = tenant_data_dir() / WIKI_DIR
    for p in sorted(wiki_dir.glob("*.md"), key=lambda x: x.stat().st_mtime, reverse=True):
        docs.append(
            {
                "name": p.name,
                "path": str(p),
                "updated_at": p.stat().st_mtime,
            }
        )
    return docs


def read_wiki_doc(name: str) -> str:
    safe = Path(name).name
    p = ensure_local_path(tenant_data_dir() / WIKI_DIR / safe)
    if not p.exists():
        raise FileNotFoundError(f"Wiki file not found: {safe}")
    return p.read_text(encoding="utf-8")


def read_raw_extracted_for_wiki(wiki_name: str) -> str | None:
    """与 wiki 同主名的 raw/*.txt：入库时写入的抽取正文（非 Summary）。"""
    safe = Path(wiki_name).name
    stem = Path(safe).stem
    if not stem:
        return None
    p = ensure_local_path(tenant_data_dir() / RAW_DIR / f"{stem}.txt")
    if not p.exists():
        return None
    return p.read_text(encoding="utf-8")


def read_raw_ai_formatted_for_wiki(wiki_name: str) -> str | None:
    """与 wiki 同主名的 raw/*.ai.txt：入库或 format-body 写入的大模型排版正文。"""
    safe = Path(wiki_name).name
    stem = Path(safe).stem
    if not stem:
        return None
    p = ensure_local_path(tenant_data_dir() / RAW_DIR / f"{stem}.ai.txt")
    if not p.exists():
        return None
    return p.read_text(encoding="utf-8")


def read_body_text_for_reading_companion(wiki_name: str) -> str:
    """
    与前端沉浸式阅读（WikiAiResultReading）正文来源一致：
    优先 raw/*.ai.txt，其次 raw/*.txt，最后 wiki/*.md。
    伴读章节切分与缓存须与此同源，否则 section_id 与前端 splitMarkdownIntoSections 对不上。
    """
    safe = Path(wiki_name).name
    fmt = (read_raw_ai_formatted_for_wiki(safe) or "").strip()
    if fmt:
        return fmt
    ext = (read_raw_extracted_for_wiki(safe) or "").strip()
    if ext:
        return ext
    try:
        return read_wiki_doc(safe)
    except FileNotFoundError:
        return ""


def original_upload_path(base_name: str) -> Path:
    """入库时保存的原始字节：raw/{slug}.source（base_name 为 wiki 主名，不含路径）。"""
    safe = Path(str(base_name)).name
    if not safe or ".." in str(base_name):
        return tenant_data_dir() / RAW_DIR / ".invalid"
    return tenant_data_dir() / RAW_DIR / f"{safe}.source"


def read_original_filename_from_outputs(base_name: str) -> str | None:
    """从 outputs/{slug}.json 读取入库时的原始文件名（用于 MIME 与下载名）。"""
    safe = Path(str(base_name)).name
    if not safe:
        return None
    p = ensure_local_path(tenant_data_dir() / OUTPUT_DIR / f"{safe}.json")
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    fn = data.get("file_name")
    if isinstance(fn, str) and fn.strip():
        return Path(fn).name
    return None


def delete_reading_companion_cache_for_wiki(wiki_file_name: str) -> int:
    """删除某篇 wiki 的全部伴读缓存（删册或重传时）。"""
    safe = Path(wiki_file_name).name
    if not safe:
        return 0
    with Session(engine) as session:
        st = select(ReadingCompanionCache).where(ReadingCompanionCache.wiki_file_name == safe)
        rows = list(session.exec(st))
        for row in rows:
            session.delete(row)
        if rows:
            session.commit()
        return len(rows)


def list_reading_companion_rows_for_wiki(wiki_file_name: str) -> list[ReadingCompanionCache]:
    safe = Path(wiki_file_name).name
    with Session(engine) as session:
        st = select(ReadingCompanionCache).where(ReadingCompanionCache.wiki_file_name == safe)
        return list(session.exec(st))


def upsert_reading_companion_row(
    *,
    wiki_file_name: str,
    section_id: str,
    section_title: str,
    companion_markdown: str,
    provider: str,
    status: str,
    error_message: str,
    inputs_sha256: str,
) -> ReadingCompanionCache:
    safe = Path(wiki_file_name).name
    now = datetime.utcnow()
    with Session(engine) as session:
        st = select(ReadingCompanionCache).where(
            ReadingCompanionCache.wiki_file_name == safe,
            ReadingCompanionCache.section_id == section_id,
        )
        row = session.exec(st).first()
        if row:
            row.section_title = section_title
            row.companion_markdown = companion_markdown
            row.provider = provider
            row.status = status
            row.error_message = error_message
            row.inputs_sha256 = inputs_sha256
            row.updated_at = now
            session.add(row)
            session.commit()
            session.refresh(row)
            return row
        new_row = ReadingCompanionCache(
            wiki_file_name=safe,
            section_id=section_id,
            section_title=section_title,
            companion_markdown=companion_markdown,
            provider=provider,
            status=status,
            error_message=error_message,
            inputs_sha256=inputs_sha256,
            updated_at=now,
        )
        session.add(new_row)
        session.commit()
        session.refresh(new_row)
        return new_row
