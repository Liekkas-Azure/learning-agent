import hashlib
import asyncio
import io
import json
import logging
import mimetypes
import re
import threading
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from openai import OpenAIError
from pydantic import BaseModel, Field

from app.associations import build_record_associations
from app.corpus_export import build_corpus_manifest, build_corpus_zip_bytes
from app.corpus_search import search_corpus
from app.config import settings
from app.corpus_store import ensure_local_path, init_corpus_store, shutdown_corpus_store, storage_info
from app.contradiction import detect_contradictions
from app.graph_enrich import related_wiki_slugs
from app.graph_neo4j import (
    close_driver,
    delete_document,
    fetch_graph_payload,
    fetch_graph_sqlite_fallback,
    sync_document,
)
from app.llm import (
    ExtractionNotConfiguredError,
    excerpt_text_for_companion_raw,
    extract_with_llm,
    format_extracted_body_with_llm,
    generate_reading_companion,
    iter_reading_companion_sse,
)
from app.daily_digest import build_daily_digest
from app.daily_stats import today_progress
from app.demo_flashcards import list_demo_flashcards
from app.auth import CurrentUser, authenticate_user, create_access_token, register_user
from app.paths import tenant_data_dir
from app.tenant import auth_enabled
from app.tenant_queries import ingest_owned
from app.flashcard_export import (
    aggregate_notes_markdown,
    build_learning_path,
    build_writing_draft,
    export_flashcards_json,
    export_flashcards_markdown,
    share_pack,
)
from app.flashcard_feed import build_feed, feedback_stats, record_feedback
from app.flashcard_ingest import list_clips, save_clip, scan_watch_folder, schedule_clip_corpus_ingest
from app.flashcard_sync_job import get_sync_status, maybe_start_auto_llm_enrich, start_sync_async
from app.flashcard_srs import apply_review, list_due_flashcards, mastery_by_topic
from app.flashcards import corpus_has_material, sync_flashcards_from_corpus
from app.models import FlashcardUserNote
from sqlmodel import Session, select
from app.storage import engine
from app.companion_jobs import (
    build_companion_bundle_payload,
    maybe_kick_background_refresh,
    refresh_wiki_companions,
    try_start_wiki_companion_refresh,
)
from app.logger import setup_logger
from app.security import (
    ApiKeyMiddleware,
    TenantAuthMiddleware,
    api_key_configured,
    check_expensive_rate_limit,
    check_upload_rate_limit,
    check_waitlist_rate_limit,
    client_key_from_request,
    llm_configured,
    read_upload_with_limit,
)
from app.parser import extract_text, parse_code_ast, pdf_extraction_is_placeholder
from app.scheduler import shutdown_companion_scheduler, start_companion_scheduler
from app.wiki_builder import build_obsidian_markdown
from app.storage import (
    delete_caches_for_ingest_record,
    delete_content_cache_by_sha256,
    delete_raw_artifacts,
    delete_reading_companion_cache_for_wiki,
    delete_record_by_id,
    get_cache_by_hash,
    get_record_by_id,
    init_db,
    list_records,
    list_wiki_docs,
    read_raw_ai_formatted_for_wiki,
    read_raw_extracted_for_wiki,
    read_ai_format_meta_for_wiki,
    read_wiki_doc,
    save_record,
    upsert_content_cache,
    write_output_file,
    write_raw_ai_formatted_file,
    write_raw_file,
    write_wiki_file,
    original_upload_path,
    read_original_filename_from_outputs,
    OUTPUT_DIR,
    RAW_DIR,
    WIKI_DIR,
)

setup_logger()
logger = logging.getLogger("knotory.api")

app = FastAPI(
    title="Knotory API",
    version="0.4.0",
    docs_url=None if settings.disable_openapi else "/docs",
    redoc_url=None if settings.disable_openapi else "/redoc",
    openapi_url=None if settings.disable_openapi else "/openapi.json",
)

app.add_middleware(ApiKeyMiddleware)
app.add_middleware(TenantAuthMiddleware)
if settings.resolved_trusted_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.resolved_trusted_hosts)

# 浏览器禁止 Access-Control-Allow-Origin: * 与 credentials 同时使用；本 API 不依赖 Cookie，关闭 credentials 最稳。
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.resolved_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_corpus_store()
    init_db()
    start_companion_scheduler()


@app.on_event("shutdown")
def on_shutdown() -> None:
    shutdown_companion_scheduler()
    shutdown_corpus_store()
    close_driver()


def slugify(name: str) -> str:
    plain = re.sub(r"\.[a-zA-Z0-9]+$", "", name)
    plain = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff_-]+", "-", plain).strip("-")
    return plain or "untitled"


class CorpusSnippet(BaseModel):
    file_name: str = ""
    summary: str = ""


class ReadingCompanionBody(BaseModel):
    """伴读请求体；extracted_raw 可选，为前端已持有的 raw/*.txt 全文抽取（不传则由服务端读取）。"""

    section_title: str = ""
    section_text: str = ""
    doc_title: str = ""
    corpus: list[CorpusSnippet] = Field(default_factory=list)
    extracted_raw: str | None = Field(default=None, description="可选：全文抽取 raw，省略则从服务端读取")



@app.get("/health")
def health() -> dict:
    db_ok = False
    try:
        settings.resolved_db_path.parent.mkdir(parents=True, exist_ok=True)
        import sqlite3

        with sqlite3.connect(str(settings.resolved_db_path), timeout=2.0) as conn:
            conn.execute("SELECT 1")
        db_ok = True
    except Exception as exc:  # noqa: BLE001
        logger.warning("health db check failed: %s", exc)
    data_writable = False
    try:
        settings.resolved_data_dir.mkdir(parents=True, exist_ok=True)
        probe = settings.resolved_data_dir / ".health_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        data_writable = True
    except Exception as exc:  # noqa: BLE001
        logger.warning("health data_dir check failed: %s", exc)
    ok = db_ok and data_writable
    return {
        "ok": ok,
        "checks": {
            "database": db_ok,
            "data_dir_writable": data_writable,
            "llm_configured": llm_configured(),
        },
        "data_dir": str(settings.resolved_data_dir),
        "storage": storage_info(),
        "api_auth_required": api_key_configured(),
        "openapi_enabled": not settings.disable_openapi,
        "version": app.version,
        "cloud_demo_url": settings.cloud_demo_public_url.strip() or None,
        "is_cloud_demo": settings.is_cloud_demo,
        "auth_required": auth_enabled(),
    }


@app.get("/api/v1/graph")
def graph_snapshot() -> dict:
    payload = fetch_graph_payload()
    if payload and payload.get("nodes"):
        return payload
    return fetch_graph_sqlite_fallback()


def _load_record_contradictions(rec: object) -> list:
    raw = getattr(rec, "contradictions_json", "") or ""
    if raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass
    rid = getattr(rec, "id", None)
    if rid is None:
        return []
    stem = slugify(getattr(rec, "file_name", "") or "")
    out_path = tenant_data_dir() / OUTPUT_DIR / f"{stem}.json"
    if out_path.is_file():
        try:
            body = json.loads(out_path.read_text(encoding="utf-8"))
            c = body.get("contradictions")
            if isinstance(c, list):
                return c
        except (json.JSONDecodeError, OSError):
            pass
    return []


def _record_to_api_dict(rec: object) -> dict:
    """与上传响应字段对齐，供列表接口使用。"""
    tags_csv = getattr(rec, "tags_csv", "") or ""
    tags = [t.strip() for t in tags_csv.split(",") if t.strip()]
    created = getattr(rec, "created_at", None)
    created_s = created.isoformat() if created is not None else ""
    return {
        "id": rec.id,
        "file_name": rec.file_name,
        "status": getattr(rec, "status", "ok"),
        "summary": getattr(rec, "summary", "") or "",
        "tags": tags,
        "created_at": created_s,
        "cached": False,
        "contradictions": _load_record_contradictions(rec),
    }


class AuthRegisterBody(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(default="", max_length=64)


class AuthLoginBody(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=128)


@app.post("/api/v1/auth/register")
def auth_register(body: AuthRegisterBody) -> dict:
    user = register_user(email=body.email, password=body.password, display_name=body.display_name)
    token = create_access_token(user_id=user.id, email=user.email)
    return {
        "token": token,
        "user": {"id": user.id, "email": user.email, "display_name": user.display_name},
    }


@app.post("/api/v1/auth/login")
def auth_login(body: AuthLoginBody) -> dict:
    user = authenticate_user(email=body.email, password=body.password)
    token = create_access_token(user_id=user.id, email=user.email)
    return {
        "token": token,
        "user": {"id": user.id, "email": user.email, "display_name": user.display_name},
    }


@app.get("/api/v1/auth/me")
def auth_me(user=CurrentUser) -> dict:
    return {"id": user.id, "email": user.email, "display_name": getattr(user, "display_name", "")}


@app.get("/api/v1/associations")
def knowledge_associations(limit: int = 40) -> dict:
    """文档之间通过共享标签建立的关联（首页展示用）。"""
    lim = max(1, min(limit, 200))
    return build_record_associations(limit=lim)


@app.get("/api/v1/records")
def list_ingest_records(limit: int = 40) -> list[dict]:
    """最近入库记录（页面刷新后仍可列出已上架内容）。"""
    lim = max(1, min(limit, 200))
    return [_record_to_api_dict(r) for r in list_records(limit=lim)]


@app.get("/api/v1/corpus/search")
def corpus_search(
    q: str = Query(..., min_length=2, max_length=200),
    limit: int = Query(default=30, ge=1, le=80),
    mode: str = Query(default="keyword", description="keyword | hybrid"),
) -> dict:
    if mode.strip().lower() == "hybrid":
        from app.hybrid_search import search_corpus_hybrid  # noqa: PLC0415

        items = search_corpus_hybrid(q, limit=limit)
    else:
        items = search_corpus(q, limit=limit)
    return {"query": q, "mode": mode, "count": len(items), "items": items}


@app.delete("/api/v1/records/{record_id}")
def delete_ingest_record(record_id: int) -> dict:
    """删除一册：SQLite 记录、内容缓存、raw/wiki/outputs 产物、Neo4j 文档节点。"""
    rec = get_record_by_id(record_id)
    if rec is None or not ingest_owned(rec):
        raise HTTPException(status_code=404, detail="记录不存在")

    base_name = slugify(rec.file_name)
    try:
        delete_caches_for_ingest_record(record_id)
        delete_reading_companion_cache_for_wiki(f"{base_name}.md")
        delete_raw_artifacts(base_name)
        delete_document(base_name)
        if not delete_record_by_id(record_id):
            raise HTTPException(status_code=500, detail="删除数据库记录失败")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("delete_ingest_record failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"删除失败: {exc}") from exc

    return {"ok": True, "id": record_id, "removed_base": base_name}


@app.post("/api/v1/upload")
async def upload(request: Request, file: UploadFile = File(...)) -> JSONResponse:
    try:
        if not file.filename:
            raise HTTPException(status_code=400, detail="Missing filename")

        check_upload_rate_limit(client_key_from_request(request))
        raw_bytes = await read_upload_with_limit(file)
        if not raw_bytes:
            raise HTTPException(status_code=400, detail="Empty file")

        content_hash = hashlib.sha256(raw_bytes).hexdigest()
        cached = get_cache_by_hash(content_hash)
        if cached and cached.output_json:
            try:
                body = json.loads(cached.output_json)
                rid = body.get("id")
                if isinstance(rid, int) and get_record_by_id(rid) is not None:
                    body["cached"] = True
                    return JSONResponse(body)
                logger.info(
                    "内容缓存无效或孤儿 (id=%r)，删除缓存并重新完整入库。",
                    rid,
                )
                delete_content_cache_by_sha256(content_hash)
            except json.JSONDecodeError:
                logger.warning("Stale cache JSON for hash %s…", content_hash[:12])

        from app.ingest_pipeline import ingest_file_bytes

        try:
            body = await asyncio.to_thread(
                ingest_file_bytes,
                file.filename,
                raw_bytes,
                background=settings.ingest_fast_return,
            )
            return JSONResponse(body)
        except ExtractionNotConfiguredError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ValueError as exc:
            msg = str(exc)
            if "PDF" in msg or "正文" in msg:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        "未能从 PDF 提取可用于知识编译的正文。"
                        "若为扫描件或图片型 PDF，请配置 ARK 多模态或 KNOTORY_CLOUD 视觉模型。"
                        f" 解析提示: {msg[:800]}"
                    ),
                ) from exc
            raise HTTPException(status_code=400, detail=msg) from exc
        except OpenAIError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"大模型接口错误（请检查 ARK / KNOTORY_CLOUD 配置与网络）: {exc}",
            ) from exc
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("Upload processing failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"上传处理失败: {type(exc).__name__}: {str(exc)[:500]}",
        ) from exc


@app.post("/api/v1/wiki/{name}/reading-companion")
def wiki_reading_companion(name: str, body: ReadingCompanionBody) -> dict:
    """为当前阅读段落生成伴读 Markdown（非流式；含全文 raw 摘录上下文）。"""
    safe = Path(name).name
    if not safe:
        raise HTTPException(status_code=400, detail="无效文档名")
    raw_src = (body.extracted_raw or "").strip() or (read_raw_extracted_for_wiki(safe) or "").strip()
    excerpt = excerpt_text_for_companion_raw(raw_src)
    try:
        md, provider = generate_reading_companion(
            section_title=body.section_title,
            section_text=body.section_text,
            doc_title=(body.doc_title or safe).strip(),
            corpus=[(c.file_name, c.summary) for c in body.corpus],
            full_raw_excerpt=excerpt,
        )
        return {"companion_markdown": md, "provider": provider}
    except ExtractionNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except OpenAIError as exc:
        logger.warning("reading-companion LLM error: %s", exc)
        raise HTTPException(status_code=502, detail=f"大模型接口错误: {exc}") from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("reading-companion failed: %s", exc)
        raise HTTPException(status_code=500, detail="伴读生成失败") from exc


@app.post("/api/v1/wiki/{name}/reading-companion/stream")
def wiki_reading_companion_stream(name: str, body: ReadingCompanionBody) -> StreamingResponse:
    """伴读 SSE：meta → delta* → done；结合全文 raw 摘录与其它摘要。"""
    safe = Path(name).name
    if not safe:
        raise HTTPException(status_code=400, detail="无效文档名")
    raw_src = (body.extracted_raw or "").strip() or (read_raw_extracted_for_wiki(safe) or "").strip()
    excerpt = excerpt_text_for_companion_raw(raw_src)
    corpus_tuples = [(c.file_name, c.summary) for c in body.corpus]
    doc_title = (body.doc_title or safe).strip()

    def byte_gen():
        for chunk in iter_reading_companion_sse(
            section_title=body.section_title,
            section_text=body.section_text,
            doc_title=doc_title,
            corpus=corpus_tuples,
            full_raw_excerpt=excerpt,
        ):
            yield chunk

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(byte_gen(), media_type="text/event-stream; charset=utf-8", headers=headers)


@app.get("/api/v1/wiki")
def list_wiki() -> list[dict]:
    try:
        docs = list_wiki_docs()
        return [
            {
                "name": d["name"],
                "path": d["path"],
                "updated_at": d["updated_at"],
            }
            for d in docs
        ]
    except Exception as exc:  # noqa: BLE001
        logger.exception("List wiki failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to list wiki docs") from exc


@app.get("/api/v1/wiki/{name}/reading-companions")
def get_reading_companions_bundle(name: str) -> dict:
    """沉浸式阅读用：返回按章节切分后的伴读缓存；若有 pending 则尝试启动后台生成。"""
    safe = Path(name).name
    if not safe:
        raise HTTPException(status_code=400, detail="无效文档名")
    try:
        bundle = build_companion_bundle_payload(safe)
    except Exception as exc:  # noqa: BLE001
        logger.exception("reading-companions bundle failed: %s", exc)
        raise HTTPException(status_code=500, detail="读取伴读缓存失败") from exc
    maybe_kick_background_refresh(safe, bundle)
    return bundle


@app.post("/api/v1/wiki/{name}/reading-companions/refresh")
def post_reading_companions_refresh(name: str, force: bool = False) -> dict:
    """同步重算该篇全部章节伴读（可能较久）；force=true 时忽略指纹命中仍重调大模型。"""
    safe = Path(name).name
    if not safe:
        raise HTTPException(status_code=400, detail="无效文档名")
    try:
        refresh_wiki_companions(safe, force_refresh=force)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Wiki 不存在") from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("reading-companions refresh failed: %s", exc)
        raise HTTPException(status_code=500, detail="伴读刷新失败") from exc
    try:
        return build_companion_bundle_payload(safe)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Wiki 不存在") from exc


@app.get("/api/v1/wiki/{name}/original")
def get_wiki_original_upload(name: str) -> FileResponse:
    """原始上传字节（如 PDF），与入库时 raw/{slug}.source 一致。"""
    stem = Path(Path(name).name).stem
    if not stem:
        raise HTTPException(status_code=404, detail="无效文档名")
    path = original_upload_path(stem)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="未找到原始上传文件")
    download_name = read_original_filename_from_outputs(stem) or f"{stem}.source"
    media, _enc = mimetypes.guess_type(download_name)
    if not media:
        media = "application/octet-stream"
    return FileResponse(
        path=str(path.resolve()),
        filename=download_name,
        media_type=media,
        content_disposition_type="inline",
    )


@app.get("/api/v1/meta")
def knotory_deployment_meta() -> dict:
    """云端语料与导出能力摘要（不含密钥与服务器路径）。"""
    neo_uri = (settings.neo4j_uri or "").strip()
    backend = settings.resolved_storage_backend
    return {
        "api_version": app.version,
        "storage_mode": "cloud" if backend == "s3" else "local",
        "storage_backend": backend,
        "corpus_scope": "user_cloud_corpus",
        "neo4j_configured": bool(neo_uri),
        "api_auth_required": api_key_configured(),
        "export_available": True,
        "portable_layout": {
            "wiki": "Obsidian 兼容 Markdown（[[双向链接]]）",
            "raw": "抽取 .txt、AI 稿 .ai.txt、审计 .ai.meta.json、原件 .source",
            "outputs": "摘要与标签 JSON",
        },
        "export_endpoints": {
            "archive": "/api/v1/corpus/archive",
            "flashcards_markdown": "/api/v1/flashcards/export/markdown",
            "notes_markdown": "/api/v1/flashcards/notes/export",
        },
    }


@app.get("/api/v1/corpus/manifest")
def get_corpus_manifest() -> dict:
    """个人语料库文件清单（可迁移结构说明 + 各篇路径）。"""
    return build_corpus_manifest()


@app.get("/api/v1/corpus/archive")
def download_corpus_archive() -> StreamingResponse:
    """打包当前用户 wiki/、raw/、outputs/ 与 manifest.json，便于从云端带走学习资料。"""
    data = build_corpus_zip_bytes()
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="knotory-corpus.zip"'},
    )


@app.get("/api/v1/wiki/{name}/export")
def export_wiki_asset(
    name: str,
    role: Literal["wiki", "extracted", "ai", "ai_meta"] = Query(
        "wiki",
        description="wiki=.md；extracted=抽取；ai=AI 稿；ai_meta=重排审计 JSON",
    ),
) -> FileResponse:
    """下载可迁移文件（附件），便于备份或与 Obsidian 等工具衔接。"""
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(status_code=400, detail="无效文档名")
    safe = Path(name).name
    if not safe:
        raise HTTPException(status_code=400, detail="无效文档名")
    stem = Path(safe).stem
    if not stem:
        raise HTTPException(status_code=400, detail="无效文档名")
    root = tenant_data_dir()
    if role == "wiki":
        path = ensure_local_path(root / WIKI_DIR / safe)
        if not path.is_file():
            raise HTTPException(status_code=404, detail="未找到 wiki 文件")
        return FileResponse(
            path=str(path.resolve()),
            filename=safe,
            media_type="text/markdown; charset=utf-8",
            content_disposition_type="attachment",
        )
    if role == "extracted":
        path = ensure_local_path(root / RAW_DIR / f"{stem}.txt")
        if not path.is_file():
            raise HTTPException(status_code=404, detail="未找到抽取正文")
        return FileResponse(
            path=str(path.resolve()),
            filename=f"{stem}.extracted.txt",
            media_type="text/plain; charset=utf-8",
            content_disposition_type="attachment",
        )
    if role == "ai_meta":
        path = ensure_local_path(root / RAW_DIR / f"{stem}.ai.meta.json")
        if not path.is_file():
            raise HTTPException(status_code=404, detail="未找到 AI 重排审计元数据")
        return FileResponse(
            path=str(path.resolve()),
            filename=f"{stem}.ai.meta.json",
            media_type="application/json; charset=utf-8",
            content_disposition_type="attachment",
        )
    path = ensure_local_path(root / RAW_DIR / f"{stem}.ai.txt")
    if not path.is_file():
        raise HTTPException(status_code=404, detail="未找到 AI 排版稿")
    return FileResponse(
        path=str(path.resolve()),
        filename=f"{stem}.ai.txt",
        media_type="text/plain; charset=utf-8",
        content_disposition_type="attachment",
    )


@app.get("/api/v1/wiki/{name}")
def get_wiki(name: str) -> dict:
    try:
        content = read_wiki_doc(name)
        extracted = read_raw_extracted_for_wiki(name)
        formatted = read_raw_ai_formatted_for_wiki(name)
        stem = Path(Path(name).name).stem
        orig_path = original_upload_path(stem) if stem else None
        orig_fn = read_original_filename_from_outputs(stem) if stem else None
        original_bytes_available = bool(stem and orig_path and orig_path.is_file())
        return {
            "content": content,
            "extracted_text": extracted,
            "formatted_text": formatted,
            "original_filename": orig_fn,
            "original_bytes_available": original_bytes_available,
            "ai_format_meta": read_ai_format_meta_for_wiki(name),
        }
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Read wiki failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to read wiki doc") from exc


@app.post("/api/v1/wiki/{name}/format-body")
def format_wiki_extracted_body(name: str) -> dict:
    """用文本大模型对 raw 抽取正文做重新排版（长文分段调用后拼接）。"""
    extracted = read_raw_extracted_for_wiki(name)
    if extracted is None or not extracted.strip():
        raise HTTPException(status_code=404, detail="未找到抽取正文（raw），无法排版。")
    try:
        formatted, provider, segments = format_extracted_body_with_llm(extracted)
    except ExtractionNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OpenAIError as exc:
        logger.warning("format-body LLM error: %s", exc)
        raise HTTPException(status_code=502, detail=f"大模型接口错误: {exc}") from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("format-body failed: %s", exc)
        raise HTTPException(status_code=500, detail="排版处理失败") from exc
    stem = Path(Path(name).name).stem
    if stem:
        write_raw_ai_formatted_file(stem, formatted, provider=provider, segments=segments)
    meta = read_ai_format_meta_for_wiki(name) if stem else None
    return {"formatted": formatted, "provider": provider, "segments": segments, "ai_format_meta": meta}


class FlashcardFeedbackBody(BaseModel):
    action: Literal["like", "dislike", "skip", "save", "open_source", "bad_card", "flip"] = "skip"
    dwell_ms: int = Field(default=0, ge=0, le=3_600_000)
    session_id: str = Field(default="default", max_length=128)


class FlashcardNoteBody(BaseModel):
    text: str = Field(default="", max_length=12000)


class FlashcardRegenerateBody(BaseModel):
    direction: str = Field(default="", max_length=800)
    use_note: bool = True


class FlashcardUnderstandBody(BaseModel):
    mode: str = Field(default="explain", max_length=32)
    use_note: bool = True


class FlashcardUnderstandApplyBody(BaseModel):
    mode: str = Field(..., max_length=32)
    preview: dict[str, Any] | None = None


class FlashcardFeynmanEvaluateBody(BaseModel):
    explanation: str = Field(..., min_length=8, max_length=4000)
    attempt: int = Field(default=1, ge=1, le=12)


class ClipIngestBody(BaseModel):
    text: str = Field(..., min_length=8, max_length=8000)
    source_title: str = Field(default="", max_length=200)
    source_url: str = Field(default="", max_length=500)
    wiki_file_name: str = Field(default="", max_length=255)
    section_id: str = Field(default="", max_length=120)
    tags: list[str] = Field(default_factory=list)


class WaitlistBody(BaseModel):
    email: str = Field(..., min_length=5, max_length=200)
    source: str = Field(default="welcome", max_length=64)


class WritingDraftBody(BaseModel):
    card_ids: list[int] = Field(default_factory=list, max_length=40)


class SharePackBody(BaseModel):
    card_ids: list[int] = Field(default_factory=list, max_length=30)


class SrsReviewBody(BaseModel):
    rating: int = Field(..., ge=0, le=3, description="0=again 1=hard 2=good 3=easy")


class LearningActionFeedbackBody(BaseModel):
    action: Literal[
        "feed_review",
        "srs_due",
        "feynman",
        "deep_read",
        "exam",
        "rag_clarify",
    ]
    reward: float = Field(..., ge=0.0, le=1.0)
    context_key: str = Field(default="", max_length=200)


@app.post("/api/v1/waitlist")
def waitlist_join(body: WaitlistBody, request: Request) -> dict:
    from app.models import WaitlistEmail

    check_waitlist_rate_limit(client_key_from_request(request))
    email = body.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="邮箱格式无效")
    with Session(engine) as session:
        existing = session.exec(select(WaitlistEmail).where(WaitlistEmail.email == email)).first()
        if existing is not None:
            return {"ok": True, "duplicate": True, "email": email}
        session.add(WaitlistEmail(email=email, source=(body.source or "welcome")[:64]))
        session.commit()
    return {"ok": True, "duplicate": False, "email": email}


def _flashcard_source_wiki_url(card) -> str:
    wiki = (card.wiki_file_name or "").strip()
    if not wiki:
        return ""
    sec = (card.section_id or "").strip()
    base = f"/library?wiki={quote(wiki)}"
    if sec:
        return f"{base}&section={quote(sec)}"
    return base


def _flashcard_to_api(
    card,
    *,
    explain: str = "",
    review_due: bool = False,
    feed_reason: str = "default",
) -> dict:
    return {
        "id": card.id,
        "card_kind": card.card_kind,
        "topic": card.topic,
        "topics": [t.strip() for t in (card.topics_csv or "").split(",") if t.strip()],
        "front_text": card.front_text,
        "back_text": card.back_text,
        "wiki_file_name": card.wiki_file_name,
        "section_id": card.section_id,
        "source_title": card.source_title,
        "source_anchor": card.source_anchor or "",
        "source_wiki_url": _flashcard_source_wiki_url(card),
        "quality_score": float(card.quality_score or 1.0),
        "quality_flags": card.quality_flags or "",
        "generation_meta": card.generation_meta or "",
        "visual_mermaid": card.visual_mermaid or "",
        "visual_caption": card.visual_caption or "",
        "visual_palette": card.visual_palette or "",
        "visual_emoji": card.visual_emoji or "",
        "visual_image_url": _flashcard_image_url(card.visual_image_path),
        "feed_explain": explain,
        "feed_reason": feed_reason,
        "review_due": review_due,
    }


def _flashcard_image_url(relative_path: str | None) -> str:
    rel = (relative_path or "").strip().replace("\\", "/")
    if not rel or ".." in rel:
        return ""
    name = Path(rel).name
    if not name or not re.match(r"^fc_[a-f0-9]+\.png$", name):
        return ""
    return f"/api/v1/flashcards/assets/{name}"


@app.get("/api/v1/flashcards/assets/{filename}")
def flashcard_asset(filename: str):
    safe = Path(filename).name
    if not re.match(r"^fc_[a-f0-9]+\.png$", safe):
        raise HTTPException(status_code=404, detail="Not found")
    path = ensure_local_path(tenant_data_dir() / "outputs" / "flashcard_images" / safe)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path=str(path.resolve()), media_type="image/png")


@app.get("/api/v1/flashcards/image-status")
def flashcards_image_status(
    probe: bool = Query(default=False, description="true 时远程探测文生图（较慢，默认仅读配置）"),
) -> dict:
    """文生图配置是否可用（未配置接入点时会返回 hint）。"""
    from app.ark_image import ark_image_config_status  # noqa: PLC0415

    return ark_image_config_status(probe=probe)


@app.get("/api/v1/pipeline/status")
def pipeline_status() -> dict:
    """聚合入库任务、拆卡进度与各篇闪卡数。"""
    from app.pipeline_status import build_pipeline_status  # noqa: PLC0415

    return build_pipeline_status()


@app.post("/api/v1/flashcards/sync")
def flashcards_sync(
    request: Request,
    use_llm: bool = Query(default=True, description="false 时仅快速模板卡，不调文本大模型"),
    background: bool = Query(default=True, description="true 时后台执行并立即返回状态"),
    skip_images: bool = Query(default=False, description="true 时跳过配图生成"),
    mode: str = Query(
        default="full",
        description="full | enrich | llm_only | fast_only — enrich=先模板后 LLM",
    ),
    wiki_file_name: list[str] = Query(default=[], description="仅重拆指定 wiki，可重复传参"),
    record_id: list[int] = Query(default=[], description="仅重拆指定入库记录，可重复传参"),
) -> dict:
    """从当前语料（wiki 章节 + 入库摘要）生成/更新闪卡索引。"""
    check_expensive_rate_limit(client_key_from_request(request))
    mode_norm = (mode or "full").strip().lower()
    llm_only = mode_norm == "llm_only"
    fast_only = mode_norm == "fast_only"
    enrich = mode_norm == "enrich"
    wiki_names = [w.strip() for w in wiki_file_name if w and w.strip()] or None
    record_ids = [int(r) for r in record_id] or None
    if background:
        return start_sync_async(
            use_llm=use_llm,
            skip_images=skip_images,
            enrich_after_fast=enrich,
            llm_only=llm_only,
            fast_only=fast_only,
            wiki_file_names=wiki_names,
            record_ids=record_ids,
        )
    try:
        result = sync_flashcards_from_corpus(
            use_llm=use_llm,
            skip_images=skip_images,
            wiki_file_names=wiki_names,
            record_ids=record_ids,
        )
        return {"ok": True, "running": False, "result": result}
    except Exception as exc:  # noqa: BLE001
        logger.exception("flashcard sync failed: %s", exc)
        raise HTTPException(status_code=500, detail="闪卡同步失败") from exc


@app.get("/api/v1/flashcards/saved")
def flashcards_saved(limit: int = Query(default=30, ge=1, le=80)) -> dict:
    """用户保存（搞懂）的闪卡清单。"""
    from app.storage import list_saved_flashcards  # noqa: PLC0415

    items = list_saved_flashcards(limit=limit)
    return {"count": len(items), "items": items}


@app.get("/api/v1/flashcards/sync/status")
def flashcards_sync_status() -> dict:
    return get_sync_status()


@app.get("/api/v1/flashcards/feed")
def flashcards_feed(
    limit: int = Query(default=8, ge=1, le=20),
    session_id: str = Query(default="default", max_length=128),
    auto_sync: bool = Query(
        default=False,
        description="为 true 时仅做快速模板同步（不调 LLM），避免阻塞首屏",
    ),
    exclude_ids: str = Query(default="", description="逗号分隔的已展示 card id，用于加载更多"),
) -> dict:
    exclude: set[int] = set()
    for part in (exclude_ids or "").split(","):
        part = part.strip()
        if part.isdigit():
            exclude.add(int(part))
    items, has_more = build_feed(session_id, limit=limit, exclude_ids=exclude or None)
    sync_status = get_sync_status()
    if auto_sync and corpus_has_material() and not sync_status.get("running"):
        if not items:
            start_sync_async(use_llm=False, skip_images=True)
            items, has_more = build_feed(session_id, limit=limit, exclude_ids=exclude or None)
            sync_status = get_sync_status()
        elif llm_configured():
            qa_n = sum(1 for it in items if (it.card.card_kind or "") == "qa")
            qa_ratio = qa_n / max(len(items), 1)
            if qa_ratio < 0.45:
                maybe_start_auto_llm_enrich(qa_ratio=qa_ratio)
                sync_status = get_sync_status()

    qa_in_batch = sum(1 for it in items if (it.card.card_kind or "") == "qa")
    due_count = len(list_due_flashcards(limit=500))
    return {
        "session_id": session_id,
        "items": [
            _flashcard_to_api(
                it.card,
                explain=it.explain,
                review_due=it.review_due,
                feed_reason=it.feed_reason,
            )
            for it in items
        ],
        "count": len(items),
        "has_more": has_more,
        "has_corpus": corpus_has_material(),
        "qa_ratio": round(qa_in_batch / max(len(items), 1), 3) if items else 0.0,
        "due_count": due_count,
        "profile": feedback_stats(session_id),
        "daily": today_progress(session_id=session_id),
        "sync": {
            "running": sync_status.get("running"),
            "error": sync_status.get("error"),
            "stage": sync_status.get("stage"),
            "progress_current": sync_status.get("progress_current"),
            "progress_total": sync_status.get("progress_total"),
        },
        "llm_configured": llm_configured(),
    }


@app.post("/api/v1/flashcards/{card_id}/feedback")
def flashcards_feedback(card_id: int, body: FlashcardFeedbackBody) -> dict:
    try:
        record_feedback(
            flashcard_id=card_id,
            action=body.action,
            dwell_ms=body.dwell_ms,
            session_id=body.session_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "card_id": card_id, "action": body.action}


@app.get("/api/v1/flashcards/profile")
def flashcards_profile(session_id: str = Query(default="default", max_length=128)) -> dict:
    return {**feedback_stats(session_id), "daily": today_progress(session_id=session_id)}


@app.get("/api/v1/flashcards/demo-feed")
def flashcards_demo_feed(limit: int = Query(default=8, ge=1, le=20)) -> dict:
    cards = list_demo_flashcards()
    slice_cards = cards[:limit]
    return {
        "is_demo": True,
        "items": [
            _flashcard_to_api(c, feed_reason="demo", explain="示例体验，无需上传文库")
            for c in slice_cards
        ],
        "count": len(slice_cards),
        "has_more": len(cards) > limit,
        "has_corpus": corpus_has_material(),
    }


@app.get("/api/v1/flashcards/daily-stats")
def flashcards_daily_stats(
    session_id: str = Query(default="default", max_length=128),
    goal: int | None = Query(default=None, ge=1, le=50),
) -> dict:
    return today_progress(session_id=session_id, goal=goal)


@app.get("/api/v1/flashcards/daily-digest")
def flashcards_daily_digest(session_id: str = Query(default="default", max_length=128)) -> dict:
    return build_daily_digest(session_id=session_id)


@app.get("/api/v1/flashcards/due")
def flashcards_due(limit: int = Query(default=20, ge=1, le=50)) -> dict:
    cards = list_due_flashcards(limit=limit)
    return {"count": len(cards), "items": [_flashcard_to_api(c, review_due=True) for c in cards]}


@app.post("/api/v1/flashcards/{card_id}/review")
def flashcards_srs_review(card_id: int, body: SrsReviewBody) -> dict:
    try:
        state = apply_review(card_id, body.rating)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "ok": True,
        "flashcard_id": card_id,
        "next_review_at": state.next_review_at.isoformat(),
        "interval_days": state.interval_days,
        "repetitions": state.repetitions,
    }


@app.get("/api/v1/flashcards/exam")
def flashcards_exam(
    wiki_file_name: str = Query(..., min_length=3, max_length=255),
    limit: int = Query(default=15, ge=5, le=40),
) -> dict:
    import random

    from sqlmodel import select
    from app.models import KnowledgeFlashcard

    with Session(engine) as session:
        st = (
            select(KnowledgeFlashcard)
            .where(KnowledgeFlashcard.active == True)  # noqa: E712
            .where(KnowledgeFlashcard.wiki_file_name == wiki_file_name)
            .limit(min(limit * 3, 120))
        )
        cards = list(session.exec(st))
    random.shuffle(cards)
    cards = cards[:limit]
    return {
        "wiki_file_name": wiki_file_name,
        "count": len(cards),
        "items": [_flashcard_to_api(c) for c in cards],
    }


@app.get("/api/v1/flashcards/{card_id}/note")
def flashcards_get_note(card_id: int) -> dict:
    with Session(engine) as session:
        row = session.get(FlashcardUserNote, card_id)
    return {"flashcard_id": card_id, "text": row.text if row else ""}


@app.put("/api/v1/flashcards/{card_id}/note")
def flashcards_put_note(card_id: int, body: FlashcardNoteBody) -> dict:
    with Session(engine) as session:
        card = session.get(KnowledgeFlashcard, card_id)
        if card is None or not card.active:
            raise HTTPException(status_code=404, detail="闪卡不存在")
        row = session.get(FlashcardUserNote, card_id)
        if row is None:
            row = FlashcardUserNote(flashcard_id=card_id, text=body.text)
        else:
            row.text = body.text
        session.add(row)
        session.commit()
    return {"ok": True, "flashcard_id": card_id}


@app.post("/api/v1/flashcards/{card_id}/regenerate")
def flashcards_regenerate(card_id: int, body: FlashcardRegenerateBody, request: Request) -> dict:
    from app.flashcard_regenerate import regenerate_flashcard  # noqa: PLC0415
    from app.llm import ExtractionNotConfiguredError  # noqa: PLC0415

    check_expensive_rate_limit(client_key_from_request(request))
    try:
        card = regenerate_flashcard(
            card_id,
            direction=body.direction,
            use_note=body.use_note,
        )
    except ExtractionNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail="未配置大模型 API，无法重写闪卡") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("flashcard regenerate failed id=%s: %s", card_id, exc)
        raise HTTPException(status_code=500, detail="闪卡重写失败") from exc
    return {"ok": True, "item": _flashcard_to_api(card)}


@app.post("/api/v1/flashcards/{card_id}/understand")
def flashcards_understand(card_id: int, body: FlashcardUnderstandBody, request: Request) -> dict:
    from app.flashcard_understand import fetch_flashcard_understanding  # noqa: PLC0415
    from app.llm import ExtractionNotConfiguredError  # noqa: PLC0415

    check_expensive_rate_limit(client_key_from_request(request))
    try:
        payload = fetch_flashcard_understanding(
            card_id,
            mode=body.mode,
            use_note=body.use_note,
        )
    except ExtractionNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail="未配置大模型 API，无法生成理解辅助") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("flashcard understand failed id=%s: %s", card_id, exc)
        raise HTTPException(status_code=500, detail="生成理解辅助失败") from exc
    return {"ok": True, "understanding": payload}


@app.post("/api/v1/flashcards/{card_id}/understand/apply")
def flashcards_understand_apply(card_id: int, body: FlashcardUnderstandApplyBody, request: Request) -> dict:
    from app.flashcard_understand import apply_flashcard_understanding  # noqa: PLC0415
    from app.flashcard_feed import invalidate_feed_candidates_cache  # noqa: PLC0415

    check_expensive_rate_limit(client_key_from_request(request))
    try:
        card = apply_flashcard_understanding(
            card_id,
            mode=body.mode,
            preview=body.preview,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("flashcard understand apply failed id=%s: %s", card_id, exc)
        raise HTTPException(status_code=500, detail="替换闪卡失败") from exc
    invalidate_feed_candidates_cache()
    return {"ok": True, "item": _flashcard_to_api(card)}


@app.get("/api/v1/flashcards/{card_id}/feynman/brief")
def flashcards_feynman_brief(card_id: int, use_note: bool = Query(default=True)) -> dict:
    from app.feynman_session import build_feynman_brief  # noqa: PLC0415

    try:
        return {"ok": True, "brief": build_feynman_brief(card_id, use_note=use_note)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/v1/flashcards/{card_id}/feynman/evaluate")
def flashcards_feynman_evaluate(
    card_id: int,
    body: FlashcardFeynmanEvaluateBody,
    request: Request,
) -> dict:
    from app.feynman_session import evaluate_feynman_explanation  # noqa: PLC0415
    from app.llm import ExtractionNotConfiguredError  # noqa: PLC0415

    check_expensive_rate_limit(client_key_from_request(request))
    try:
        result = evaluate_feynman_explanation(
            card_id,
            explanation=body.explanation,
            attempt=body.attempt,
        )
    except ExtractionNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail="未配置大模型 API，无法进行费曼评估") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("feynman evaluate failed id=%s: %s", card_id, exc)
        raise HTTPException(status_code=500, detail="费曼评估失败") from exc
    return {"ok": True, "evaluation": result}


@app.post("/api/v1/clips")
def clips_ingest(body: ClipIngestBody) -> dict:
    try:
        clip = save_clip(
            text=body.text,
            source_title=body.source_title,
            source_url=body.source_url,
            wiki_file_name=body.wiki_file_name,
            section_id=body.section_id,
            tags=body.tags,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    schedule_clip_corpus_ingest(clip, tags=body.tags)
    return {
        "ok": True,
        "id": clip.id,
        "wiki_file_name": clip.wiki_file_name,
        "hint": "摘录已入库，正在后台拆成知识点闪卡",
    }


@app.get("/api/v1/clips")
def clips_list(limit: int = Query(default=30, ge=1, le=100)) -> list[dict]:
    return [
        {
            "id": c.id,
            "text": c.text[:200],
            "source_title": c.source_title,
            "source_url": c.source_url,
            "wiki_file_name": c.wiki_file_name,
            "created_at": c.created_at.isoformat(),
        }
        for c in list_clips(limit=limit)
        if c.id is not None
    ]


@app.post("/api/v1/watch/scan")
def watch_folder_scan() -> dict:
    return scan_watch_folder()


@app.get("/api/v1/flashcards/export/markdown")
def flashcards_export_markdown(wiki_file_name: str | None = Query(default=None)) -> dict:
    return {"markdown": export_flashcards_markdown(wiki_file_name=wiki_file_name)}


@app.get("/api/v1/flashcards/export/json")
def flashcards_export_json(wiki_file_name: str | None = Query(default=None)) -> dict:
    return {"items": export_flashcards_json(wiki_file_name=wiki_file_name)}


@app.get("/api/v1/flashcards/notes/export")
def flashcards_notes_export() -> dict:
    return {"markdown": aggregate_notes_markdown()}


@app.post("/api/v1/flashcards/writing-draft")
def flashcards_writing_draft(body: WritingDraftBody) -> dict:
    if not body.card_ids:
        raise HTTPException(status_code=400, detail="card_ids 不能为空")
    return build_writing_draft(body.card_ids)


@app.get("/api/v1/flashcards/learning-path")
def flashcards_learning_path(days: int = Query(default=7, ge=3, le=21)) -> dict:
    return build_learning_path(days=days)


@app.get("/api/v1/student/state")
def student_state(use_llm: bool = Query(default=False)) -> dict:
    from app.student_state import build_student_state_snapshot  # noqa: PLC0415

    return {"ok": True, **build_student_state_snapshot(use_llm=use_llm)}


@app.get("/api/v1/memory/episodes")
def memory_episodes(limit: int = Query(default=20, ge=1, le=50)) -> dict:
    from app.wiki_memory import list_memory_episodes  # noqa: PLC0415

    items = list_memory_episodes(limit=limit)
    return {"ok": True, "count": len(items), "items": items}


@app.post("/api/v1/agent/learning-loop")
def agent_learning_loop(
    days: int = Query(default=7, ge=3, le=21),
    goal: str = Query(default="个性化学习闭环", max_length=200),
) -> dict:
    from app.agents.learning_graph import run_learning_loop  # noqa: PLC0415

    result = run_learning_loop(goal=goal, days=days)
    return {"ok": True, **result}


@app.post("/api/v1/agent/action-feedback")
def agent_action_feedback(body: LearningActionFeedbackBody) -> dict:
    """Executor 结果/用户反馈写回 Contextual Bandit Policy。"""
    from app.contextual_bandit import record_reward  # noqa: PLC0415

    record_reward(
        body.action,
        body.reward,
        context_key=body.context_key,
    )
    if body.context_key:
        try:
            from app.student_state import observe_concept  # noqa: PLC0415

            correctness = (
                True
                if body.reward >= 0.85
                else (False if body.reward <= 0.15 else None)
            )
            observe_concept(
                body.context_key,
                correct=correctness,
                semantic_score=body.reward,
                source="agent_action_feedback",
                action=body.action,
                evidence_weight=0.75,
            )
        except Exception as exc:  # noqa: BLE001
            logger.info("agent feedback student-state update skipped: %s", exc)
    from app.wiki_memory import reflect_and_write  # noqa: PLC0415

    memory = reflect_and_write(
        event="agent_action_feedback",
        payload={
            "primary_action": body.action,
            "reward": body.reward,
            "concept": body.context_key,
            "gaps": (
                [f"{body.action} 对当前学习者效果较差"]
                if body.reward <= 0.15
                else []
            ),
        },
        concepts=[body.context_key] if body.context_key else [],
    )
    return {"ok": True, "memory_write": memory}


@app.post("/api/v1/flashcards/share-pack")
def flashcards_share_pack(body: SharePackBody) -> dict:
    if not body.card_ids:
        raise HTTPException(status_code=400, detail="card_ids 不能为空")
    return share_pack(body.card_ids)


@app.get("/api/v1/flashcards/usage")
def flashcards_usage() -> dict:
    from sqlmodel import select
    from app.models import FlashcardFeedback, KnowledgeFlashcard

    with Session(engine) as session:
        active = len(
            list(session.exec(select(KnowledgeFlashcard).where(KnowledgeFlashcard.active == True)))  # noqa: E712
        )
        feedback_n = len(list(session.exec(select(FlashcardFeedback))))
        notes_n = len(list(session.exec(select(FlashcardUserNote))))
    img_dir = tenant_data_dir() / "outputs" / "flashcard_images"
    images_n = len(list(img_dir.glob("fc_*.png"))) if img_dir.is_dir() else 0
    return {
        "active_flashcards": active,
        "feedback_events": feedback_n,
        "server_notes": notes_n,
        "cached_images": images_n,
        "data_dir": str(settings.resolved_data_dir),
        "mastery": mastery_by_topic()[:8],
    }


class RagChatBody(BaseModel):
    query: str = Field(..., min_length=2, max_length=2000)


class FactCheckBody(BaseModel):
    claim: str = Field(..., min_length=6, max_length=2000)


class CuratorBody(BaseModel):
    wiki_file_name: str = Field(..., min_length=3, max_length=255)


@app.get("/api/v1/corpus/search/hybrid")
def corpus_search_hybrid_route(q: str = Query(..., min_length=2, max_length=200), limit: int = Query(default=30, ge=1, le=80)) -> dict:
    from app.hybrid_search import search_corpus_hybrid  # noqa: PLC0415

    items = search_corpus_hybrid(q, limit=limit)
    return {"query": q, "count": len(items), "items": items}


@app.post("/api/v1/chat/rag")
def chat_rag(body: RagChatBody) -> dict:
    from app.rag_chat import answer_with_rag  # noqa: PLC0415

    try:
        return answer_with_rag(body.query)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("rag chat failed")
        raise HTTPException(status_code=503, detail="RAG 回答失败") from exc


@app.post("/api/v1/fact-check")
def fact_check(body: FactCheckBody) -> dict:
    from app.fact_checker import check_claim  # noqa: PLC0415

    try:
        return check_claim(body.claim)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/v1/curator/suggest")
def curator_suggest(body: CuratorBody) -> dict:
    from app.curator import suggest_curation  # noqa: PLC0415

    try:
        return suggest_curation(wiki_file_name=body.wiki_file_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/v1/contradictions")
def contradictions_list(limit: int = Query(default=50, ge=1, le=200)) -> dict:
    from app.contradiction_list import list_contradictions  # noqa: PLC0415

    items = list_contradictions(limit=limit)
    return {"count": len(items), "items": items}


@app.get("/api/v1/flashcards/srs/calendar")
def flashcards_srs_calendar(days: int = Query(default=14, ge=1, le=60)) -> dict:
    from app.srs_analytics import due_calendar  # noqa: PLC0415

    return {"days": days, "items": due_calendar(days=days)}


@app.get("/api/v1/flashcards/srs/trend")
def flashcards_srs_trend(top_n: int = Query(default=8, ge=1, le=20)) -> dict:
    from app.srs_analytics import mastery_trend  # noqa: PLC0415

    return mastery_trend(top_n=top_n)


@app.get("/api/v1/corpus/export/obsidian")
def corpus_export_obsidian() -> StreamingResponse:
    from app.obsidian_export import build_obsidian_vault_zip_bytes  # noqa: PLC0415

    data = build_obsidian_vault_zip_bytes()
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="knotory-obsidian-vault.zip"'},
    )


@app.post("/api/v1/corpus/backup/run")
def corpus_backup_run() -> dict:
    from app.backup_jobs import run_backup_async  # noqa: PLC0415

    return run_backup_async()


@app.get("/api/v1/corpus/backup/status")
def corpus_backup_status() -> dict:
    from app.backup_jobs import backup_status  # noqa: PLC0415

    return backup_status()


@app.post("/api/v1/flashcards/images/regenerate")
def flashcards_images_regenerate(request: Request, limit: int = Query(default=200, ge=1, le=500)) -> dict:
    check_expensive_rate_limit(client_key_from_request(request), limit_per_minute=2)
    from app.flashcard_image_batch import start_image_regenerate_async  # noqa: PLC0415

    return start_image_regenerate_async(limit=limit)


@app.get("/api/v1/flashcards/images/regenerate/status")
def flashcards_images_regenerate_status() -> dict:
    from app.flashcard_image_batch import image_regenerate_status  # noqa: PLC0415

    return image_regenerate_status()
