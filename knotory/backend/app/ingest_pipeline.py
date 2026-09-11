"""文件入库流水线（上传 API 与目录监视共用）。"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
from pathlib import Path

from openai import OpenAIError

from app.contradiction import detect_contradictions
from app.graph_enrich import related_wiki_slugs
from app.graph_neo4j import sync_document
from app.llm import ExtractionNotConfiguredError, extract_with_llm, format_extracted_body_with_llm
from app.parser import extract_text, parse_code_ast, pdf_extraction_is_placeholder
from app.config import settings
from app.paths import tenant_data_dir
from app.corpus_store import notify_path_written
from app.ingest_job import complete_job, fail_job, register_job, update_job
from app.storage import (
    delete_content_cache_by_sha256,
    get_cache_by_hash,
    get_record_by_id,
    list_records,
    save_record,
    update_record,
    upsert_content_cache,
    write_output_file,
    write_raw_ai_formatted_file,
    write_raw_file,
    write_wiki_file,
)
from app.companion_jobs import try_start_wiki_companion_refresh
from app.tenant import capture_tenant, run_as_tenant
from app.wiki_builder import build_obsidian_markdown

logger = logging.getLogger("knotory.ingest_pipeline")


def _slugify(name: str) -> str:
    plain = re.sub(r"\.[a-zA-Z0-9]+$", "", name)
    plain = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff_-]+", "-", plain).strip("-")
    return plain or "untitled"


def _schedule_format_body_async(base_name: str, text: str) -> None:
    """全文 AI 排版耗时较长，后台执行以免上传请求超时。"""
    owner_id, owner_email = capture_tenant()

    def _run() -> None:
        run_as_tenant(
            owner_id,
            owner_email,
            _format_body_job,
            base_name=base_name,
            text=text,
        )

    threading.Thread(target=_run, daemon=True, name=f"format-{base_name}").start()


def _format_body_job(*, base_name: str, text: str) -> None:
    try:
        formatted_body, fmt_provider, fmt_segments = format_extracted_body_with_llm(text)
        if formatted_body.strip():
            write_raw_ai_formatted_file(
                base_name,
                formatted_body,
                provider=fmt_provider,
                segments=fmt_segments,
            )
            try_start_wiki_companion_refresh(f"{base_name}.md")
    except (ExtractionNotConfiguredError, ValueError, OpenAIError) as exc:
        logger.info("background format skipped for %s: %s", base_name, exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("background format failed for %s: %s", base_name, exc)


def _build_response_body(
    rec,
    *,
    tags: list[str],
    raw_path,
    wiki_path,
    output_path,
    contradictions: list,
    content_hash: str,
    llm_provider: str,
    cached: bool = False,
    background: bool = False,
) -> dict:
    return {
        "id": rec.id,
        "file_name": rec.file_name,
        "status": rec.status,
        "summary": rec.summary,
        "tags": tags,
        "created_at": rec.created_at.isoformat(),
        "paths": {"raw": str(raw_path), "wiki": str(wiki_path), "outputs": str(output_path)},
        "contradictions": contradictions,
        "cached": cached,
        "background": background,
        "content_sha256": content_hash,
        "llm_provider": llm_provider,
    }


def _finalize_ingest(
    *,
    file_name: str,
    raw_bytes: bytes,
    content_hash: str,
    base_name: str,
    source_file: Path,
    text: str,
    ast_data: dict,
    preset_tags: list[str] | None,
    source_url: str,
    skip_llm: bool,
    record_id: int | None = None,
) -> dict:
    if skip_llm:
        summary = text[:400].replace("\n", " ").strip() or file_name
        tags = [t.strip() for t in (preset_tags or []) if t.strip()] or ["inbox"]
        concepts = tags[:20]
        prerequisites: list[dict] = []
        llm_provider = "clip"
    else:
        llm_out, llm_provider = extract_with_llm(text)
        summary = str(llm_out.get("summary", "")).strip()
        tags = [str(t) for t in llm_out.get("tags", [])]
        concepts = [str(c) for c in llm_out.get("concepts", []) if str(c).strip()]
        prerequisites = [
            edge for edge in llm_out.get("prerequisites", []) if isinstance(edge, dict)
        ]
        if preset_tags:
            for t in preset_tags:
                ts = str(t).strip()
                if ts and ts not in tags:
                    tags.append(ts)

    recent = list_records(limit=40)
    contradictions = detect_contradictions(tags, summary, recent, self_id=record_id)
    neighbor_slugs = related_wiki_slugs(file_name, tags, recent)

    raw_path = write_raw_file(base_name, text)
    if len(text.strip()) >= 80:
        _schedule_format_body_async(base_name, text)

    wiki_md = build_obsidian_markdown(
        file_name,
        summary,
        tags,
        ast_data,
        related_slugs=neighbor_slugs,
        source_url=source_url,
    )
    wiki_path = write_wiki_file(base_name, wiki_md)
    output_payload = {
        "file_name": file_name,
        "summary": summary,
        "tags": tags,
        "concepts": concepts,
        "prerequisites": prerequisites,
        "ast": ast_data,
        "llm_provider": llm_provider,
        "contradictions": contradictions,
    }
    output_path = write_output_file(base_name, json.dumps(output_payload, ensure_ascii=False, indent=2))

    if record_id is not None:
        rec = update_record(
            record_id,
            summary=summary,
            tags_csv=",".join(tags),
            contradictions_json=json.dumps(contradictions, ensure_ascii=False),
            status="ok",
        )
        if rec is None:
            raise ValueError(f"record {record_id} not found")
    else:
        rec = save_record(
            file_name,
            str(source_file),
            summary,
            tags,
            contradictions=contradictions,
            status="ok",
        )

    sync_document(base_name, file_name, summary, tags)
    try:
        from app.vector_store import upsert_document_chunks  # noqa: PLC0415
        from app.knowledge_graph import sync_knowledge_structure  # noqa: PLC0415

        wiki_text = wiki_md if isinstance(wiki_md, str) else ""
        upsert_document_chunks(
            source_kind="wiki",
            source_ref=f"{base_name}.md",
            title=file_name,
            text=f"{summary}\n\n{wiki_text}\n\n{text[:6000]}",
        )
        sync_knowledge_structure(
            doc_slug=base_name,
            concepts=concepts or tags,
            prerequisites=prerequisites,
            source_wiki=f"{base_name}.md",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("memory/vector index after ingest skipped: %s", exc)

    response_body = _build_response_body(
        rec,
        tags=tags,
        raw_path=raw_path,
        wiki_path=wiki_path,
        output_path=output_path,
        contradictions=contradictions,
        content_hash=content_hash,
        llm_provider=llm_provider,
    )
    upsert_content_cache(
        sha256_hex=content_hash,
        file_name=file_name,
        base_name=base_name,
        ingest_record_id=rec.id,
        output_json=json.dumps(response_body, ensure_ascii=False),
    )
    try_start_wiki_companion_refresh(f"{base_name}.md")

    from app.flashcard_sync_job import start_sync_async  # noqa: PLC0415

    sync_record_ids = [rec.id] if rec.id is not None else None
    started = start_sync_async(enrich_after_fast=True, record_ids=sync_record_ids)
    if not started.get("started") and started.get("queued"):
        logger.info("flashcard sync queued after ingest for record %s", rec.id)
    elif not started.get("ok"):
        logger.warning("flashcard sync not started after ingest for record %s: %s", rec.id, started.get("hint"))
    return response_body


def _run_background_ingest(
    *,
    record_id: int,
    file_name: str,
    raw_bytes: bytes,
    content_hash: str,
    base_name: str,
    source_file: Path,
    text: str,
    ast_data: dict,
    preset_tags: list[str] | None,
    source_url: str,
) -> None:
    try:
        update_job(record_id, stage="summarizing")
        _finalize_ingest(
            file_name=file_name,
            raw_bytes=raw_bytes,
            content_hash=content_hash,
            base_name=base_name,
            source_file=source_file,
            text=text,
            ast_data=ast_data,
            preset_tags=preset_tags,
            source_url=source_url,
            skip_llm=False,
            record_id=record_id,
        )
        complete_job(record_id)
    except ExtractionNotConfiguredError as exc:
        fail_job(record_id, str(exc))
        update_record(record_id, status="failed", summary=str(exc)[:400])
    except Exception as exc:  # noqa: BLE001
        logger.exception("background ingest failed for record %s: %s", record_id, exc)
        fail_job(record_id, str(exc))
        update_record(record_id, status="failed", summary=f"入库失败：{str(exc)[:200]}")


def ingest_text_document(
    file_name: str,
    text: str,
    *,
    tags: list[str] | None = None,
    source_url: str = "",
    skip_llm: bool = False,
    background: bool | None = None,
) -> dict:
    """剪藏/纯文本入库：走与上传相同的记录、wiki、矛盾检测与闪卡同步。"""
    body = (text or "").strip()
    if len(body) < 8:
        raise ValueError("正文过短")
    raw_bytes = body.encode("utf-8")
    return ingest_file_bytes(
        file_name,
        raw_bytes,
        preset_tags=tags,
        source_url=source_url,
        skip_llm=skip_llm,
        background=background,
    )


def ingest_file_bytes(
    file_name: str,
    raw_bytes: bytes,
    *,
    preset_tags: list[str] | None = None,
    source_url: str = "",
    skip_llm: bool = False,
    background: bool | None = None,
) -> dict:
    if not raw_bytes:
        raise ValueError("Empty file")

    use_background = settings.ingest_fast_return if background is None else background

    content_hash = hashlib.sha256(raw_bytes).hexdigest()
    cached = get_cache_by_hash(content_hash)
    if cached and cached.output_json:
        try:
            body = json.loads(cached.output_json)
            rid = body.get("id")
            if isinstance(rid, int) and get_record_by_id(rid) is not None:
                body["cached"] = True
                return body
            delete_content_cache_by_sha256(content_hash)
        except json.JSONDecodeError:
            pass

    base_name = _slugify(file_name)
    source_file = tenant_data_dir() / "raw" / f"{base_name}.source"
    source_file.parent.mkdir(parents=True, exist_ok=True)
    source_file.write_bytes(raw_bytes)
    notify_path_written(source_file)

    text = extract_text(source_file, original_filename=file_name)
    if file_name.lower().endswith(".pdf") and pdf_extraction_is_placeholder(text):
        raise ValueError(f"PDF 正文不可用: {text[:200]}")

    ast_data = parse_code_ast(Path(file_name), text)

    if use_background and not skip_llm:
        rec = save_record(
            file_name,
            str(source_file),
            "正在生成摘要…",
            ["inbox"],
            status="processing",
        )
        register_job(rec.id or 0, file_name=file_name, stage="parsing")
        wiki_path = tenant_data_dir() / "wiki" / f"{base_name}.md"
        output_path = tenant_data_dir() / "outputs" / f"{base_name}.json"
        raw_path = tenant_data_dir() / "raw" / f"{base_name}.txt"
        response_body = _build_response_body(
            rec,
            tags=["inbox"],
            raw_path=raw_path,
            wiki_path=wiki_path,
            output_path=output_path,
            contradictions=[],
            content_hash=content_hash,
            llm_provider="pending",
            background=True,
        )
        rid = rec.id or 0
        owner_id, owner_email = capture_tenant()
        ingest_kwargs = {
            "record_id": rid,
            "file_name": file_name,
            "raw_bytes": raw_bytes,
            "content_hash": content_hash,
            "base_name": base_name,
            "source_file": source_file,
            "text": text,
            "ast_data": ast_data,
            "preset_tags": preset_tags,
            "source_url": source_url,
        }
        threading.Thread(
            target=lambda: run_as_tenant(
                owner_id,
                owner_email,
                _run_background_ingest,
                **ingest_kwargs,
            ),
            daemon=True,
            name=f"ingest-{rid}",
        ).start()
        return response_body

    return _finalize_ingest(
        file_name=file_name,
        raw_bytes=raw_bytes,
        content_hash=content_hash,
        base_name=base_name,
        source_file=source_file,
        text=text,
        ast_data=ast_data,
        preset_tags=preset_tags,
        source_url=source_url,
        skip_llm=skip_llm,
    )
