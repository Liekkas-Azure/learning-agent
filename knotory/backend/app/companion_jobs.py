"""伴读后台任务：入库预生成、按需补跑、定时按知识库指纹刷新。"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path

from openai import OpenAIError

from app.config import settings
from app.llm import ExtractionNotConfiguredError, excerpt_text_for_companion_raw, generate_reading_companion
from app.markdown_sections import MarkdownSection, split_markdown_into_sections
from app.storage import (
    list_reading_companion_rows_for_wiki,
    list_records,
    list_wiki_docs,
    read_body_text_for_reading_companion,
    read_raw_extracted_for_wiki,
    upsert_reading_companion_row,
)

logger = logging.getLogger("knotory.companion_jobs")

_wiki_refresh_lock = threading.Lock()
_running_wikis: set[str] = set()
_companion_threads: dict[str, threading.Thread] = {}
_per_wiki_lock: dict[str, threading.Lock] = {}
_meta = threading.Lock()


def _lock_for_wiki(wiki_file_name: str) -> threading.Lock:
    with _meta:
        if wiki_file_name not in _per_wiki_lock:
            _per_wiki_lock[wiki_file_name] = threading.Lock()
        return _per_wiki_lock[wiki_file_name]


def _release_companion_thread(safe: str) -> None:
    with _wiki_refresh_lock:
        _running_wikis.discard(safe)
        _companion_threads.pop(safe, None)


def _sweep_dead_companion_threads() -> None:
    """防御：线程已结束但 running 位未释放时清掉，避免永远无法再开新任务。"""
    with _wiki_refresh_lock:
        for k, th in list(_companion_threads.items()):
            if not th.is_alive():
                _running_wikis.discard(k)
                _companion_threads.pop(k, None)


def _companion_llm_worker(
    *,
    wiki_file_name: str,
    section_id: str,
    section_title: str,
    section_markdown: str,
    doc_title: str,
    corpus: list[tuple[str, str]],
    excerpt: str,
) -> tuple[str, str, str, str, str]:
    """
    仅调大模型，不写库。返回:
    section_id, section_title, markdown, provider, error_message（空表示成功）
    """
    try:
        md, provider = generate_reading_companion(
            section_title=section_title,
            section_text=section_markdown,
            doc_title=doc_title,
            corpus=corpus,
            full_raw_excerpt=excerpt,
        )
        return section_id, section_title, md, provider, ""
    except ExtractionNotConfiguredError as exc:
        return section_id, section_title, "", "", str(exc)
    except OpenAIError as exc:
        logger.warning("companion LLM error %s section=%s: %s", wiki_file_name, section_id, exc)
        return section_id, section_title, "", "", f"大模型接口错误: {exc}"
    except Exception as exc:  # noqa: BLE001
        logger.exception("companion failed %s section=%s", wiki_file_name, section_id)
        return section_id, section_title, "", "", f"{type(exc).__name__}: {str(exc)[:500]}"


def corpus_tuples_for_companion(*, limit: int = 40) -> list[tuple[str, str]]:
    rows = list_records(limit=max(1, min(limit, 200)))
    return [((r.file_name or "").strip(), (r.summary or "").strip()) for r in rows]


def companion_inputs_fingerprint(
    *,
    section_markdown: str,
    raw_excerpt: str,
    corpus: list[tuple[str, str]],
) -> str:
    payload = json.dumps(
        {"corpus": corpus, "raw": raw_excerpt, "sec": section_markdown},
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def try_start_wiki_companion_refresh(wiki_file_name: str) -> bool:
    """若该 wiki 尚未在跑伴读任务，则启动后台线程。返回是否新启动了线程。"""
    safe = Path(wiki_file_name).name
    if not safe:
        return False
    _sweep_dead_companion_threads()
    with _wiki_refresh_lock:
        if safe in _running_wikis:
            return False
        _running_wikis.add(safe)

    def _run() -> None:
        try:
            refresh_wiki_companions(safe, force_refresh=False)
        except Exception:  # noqa: BLE001
            logger.exception("companion refresh failed for %s", safe)
        finally:
            _release_companion_thread(safe)

    th = threading.Thread(target=_run, daemon=True, name=f"knotory-companion-{safe}")
    with _wiki_refresh_lock:
        _companion_threads[safe] = th
    th.start()
    return True


def refresh_wiki_companions(wiki_file_name: str, *, force_refresh: bool = False) -> None:
    """为单篇 wiki 的所有章节生成/更新伴读缓存（同 wiki 互斥）。"""
    safe = Path(wiki_file_name).name
    if not safe:
        return
    with _lock_for_wiki(safe):
        _refresh_wiki_companions_unlocked(safe, force_refresh=force_refresh)


def _refresh_wiki_companions_unlocked(wiki_file_name: str, *, force_refresh: bool) -> None:
    wiki_body = read_body_text_for_reading_companion(wiki_file_name)
    if not wiki_body.strip():
        logger.warning("companion refresh: no readable body (ai.txt / raw.txt / wiki.md) for %s", wiki_file_name)
        return

    raw_src = (read_raw_extracted_for_wiki(wiki_file_name) or "").strip()
    excerpt = excerpt_text_for_companion_raw(raw_src)
    corpus = corpus_tuples_for_companion()
    doc_title = wiki_file_name
    sections = split_markdown_into_sections(wiki_body)
    existing = {r.section_id: r for r in list_reading_companion_rows_for_wiki(wiki_file_name)}

    todo: list[tuple[MarkdownSection, str]] = []
    for sec in sections:
        fp = companion_inputs_fingerprint(section_markdown=sec.markdown, raw_excerpt=excerpt, corpus=corpus)
        prev = existing.get(sec.id)
        if (
            not force_refresh
            and prev is not None
            and prev.status == "ok"
            and prev.inputs_sha256 == fp
            and (prev.companion_markdown or "").strip()
        ):
            continue
        todo.append((sec, fp))

    if not todo:
        return

    for sec, fp in todo:
        upsert_reading_companion_row(
            wiki_file_name=wiki_file_name,
            section_id=sec.id,
            section_title=sec.title,
            companion_markdown="",
            provider="",
            status="pending",
            error_message="",
            inputs_sha256=fp,
        )

    workers = max(1, min(8, int(settings.companion_parallel_sections)))

    def _apply_one(sid: str, stitle: str, md: str, provider: str, err: str, fp: str) -> None:
        if err:
            upsert_reading_companion_row(
                wiki_file_name=wiki_file_name,
                section_id=sid,
                section_title=stitle,
                companion_markdown="",
                provider="",
                status="error",
                error_message=err,
                inputs_sha256=fp,
            )
        else:
            upsert_reading_companion_row(
                wiki_file_name=wiki_file_name,
                section_id=sid,
                section_title=stitle,
                companion_markdown=md,
                provider=provider,
                status="ok",
                error_message="",
                inputs_sha256=fp,
            )

    if workers == 1 or len(todo) == 1:
        for sec, fp in todo:
            _sid, _stitle, md, provider, err = _companion_llm_worker(
                wiki_file_name=wiki_file_name,
                section_id=sec.id,
                section_title=sec.title,
                section_markdown=sec.markdown,
                doc_title=doc_title,
                corpus=corpus,
                excerpt=excerpt,
            )
            _apply_one(_sid, _stitle, md, provider, err, fp)
        return

    fp_by_section = {sec.id: fp for sec, fp in todo}
    workers_n = min(workers, len(todo))
    per_section_budget = max(150.0, float(settings.companion_llm_timeout_sec) + 45.0)
    total_budget = time.monotonic() + len(todo) * per_section_budget

    executor = ThreadPoolExecutor(max_workers=workers_n, thread_name_prefix="knotory-companion")
    futs = {
        executor.submit(
            _companion_llm_worker,
            wiki_file_name=wiki_file_name,
            section_id=sec.id,
            section_title=sec.title,
            section_markdown=sec.markdown,
            doc_title=doc_title,
            corpus=corpus,
            excerpt=excerpt,
        ): sec
        for sec, fp in todo
    }
    pending = set(futs.keys())
    try:
        while pending:
            slice_timeout = min(25.0, max(0.5, total_budget - time.monotonic()))
            if slice_timeout <= 0:
                break
            done, not_done = wait(pending, timeout=slice_timeout, return_when=FIRST_COMPLETED)
            for fut in done:
                sec = futs[fut]
                fp = fp_by_section[sec.id]
                try:
                    sid, stitle, md, provider, err = fut.result()
                except Exception as exc:  # noqa: BLE001
                    logger.exception("companion future failed %s section=%s", wiki_file_name, sec.id)
                    sid, stitle, md, provider, err = sec.id, sec.title, "", "", f"{type(exc).__name__}: {str(exc)[:500]}"
                _apply_one(sid, stitle, md, provider, err, fp)
            pending = not_done

        if pending:
            logger.warning(
                "companion refresh budget exceeded for %s (%d section(s) unfinished)",
                wiki_file_name,
                len(pending),
            )
        for fut in pending:
            sec = futs[fut]
            fp = fp_by_section[sec.id]
            _apply_one(
                sec.id,
                sec.title,
                "",
                "",
                "生成超时：模型或网络长时间无响应。请检查 API 与网络后重试，或稍后在「伴读」中刷新。",
                fp,
            )
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


def refresh_all_wikis_companions(*, force_refresh: bool = False) -> None:
    """定时任务：遍历知识库中全部 wiki。"""
    try:
        docs = list_wiki_docs()
    except OSError as exc:
        logger.warning("list_wiki_docs failed: %s", exc)
        return
    for d in docs:
        name = d.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        try:
            refresh_wiki_companions(name, force_refresh=force_refresh)
        except Exception:  # noqa: BLE001
            logger.exception("daily companion refresh failed for %s", name)


def build_companion_bundle_payload(wiki_file_name: str) -> dict:
    """供 GET /reading-companions：合并当前正文切分与缓存行。"""
    safe = Path(wiki_file_name).name
    wiki_body = read_body_text_for_reading_companion(safe)
    if not wiki_body.strip():
        return {"wiki_file_name": safe, "items": [], "any_pending": False}
    sections = split_markdown_into_sections(wiki_body)
    rows = {r.section_id: r for r in list_reading_companion_rows_for_wiki(safe)}
    items: list[dict] = []
    any_pending = False
    for sec in sections:
        r = rows.get(sec.id)
        if r is None:
            any_pending = True
            items.append(
                {
                    "section_id": sec.id,
                    "section_title": sec.title,
                    "status": "pending",
                    "companion_markdown": None,
                    "provider": None,
                    "error_message": None,
                    "updated_at": None,
                },
            )
            continue
        st = r.status or "pending"
        if st == "pending":
            any_pending = True
        items.append(
            {
                "section_id": sec.id,
                "section_title": sec.title,
                "status": st,
                "companion_markdown": r.companion_markdown if st == "ok" else None,
                "provider": (r.provider or None) if st == "ok" else None,
                "error_message": (r.error_message or None) if st == "error" else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            },
        )
    return {"wiki_file_name": safe, "items": items, "any_pending": any_pending}


def maybe_kick_background_refresh(wiki_file_name: str, bundle: dict) -> None:
    if bundle.get("any_pending"):
        _sweep_dead_companion_threads()
        try_start_wiki_companion_refresh(wiki_file_name)
