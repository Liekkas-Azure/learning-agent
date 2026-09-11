"""从 wiki / 入库记录生成知识闪卡（优先 LLM 问答式，LLM 不可用时才模板回退）。"""

from __future__ import annotations

import json
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from sqlmodel import Session, select

from app.ark_image import ark_image_config_status, ensure_flashcard_image_for_payload, probe_ark_image_model
from app.flashcard_llm import qa_cards_for_section, qa_cards_for_summary, section_has_qa_cache
from app.flashcard_quality import sync_contradiction_cards
from app.flashcard_style import build_generation_style_hint, style_fingerprint
from app.flashcard_srs import ensure_review_states
from app.flashcard_visual import visual_bundle_for_card
from app.markdown_sections import MarkdownSection, split_sections_for_flashcards
from app.models import IngestRecord, KnowledgeFlashcard, ReadingCompanionCache
from app.storage import (
    OUTPUT_DIR,
    engine,
    list_reading_companion_rows_for_wiki,
    list_records,
    list_wiki_docs,
    read_body_text_for_reading_companion,
    settings,
)
from app.tenant import current_user_id
from app.tenant_queries import flashcard_scope

logger = logging.getLogger("knotory.flashcards")

_sync_lock = threading.Lock()

_MIN_SECTION_CHARS = 120
_MAX_BACK_CHARS = 1400
_MAX_FRONT_CHARS = 200


def _clip(text: str, limit: int) -> str:
    t = re.sub(r"\s+", " ", (text or "").strip())
    if len(t) <= limit:
        return t
    return t[: limit - 1].rstrip() + "…"


def _topics_from_record_tags(tags_csv: str) -> list[str]:
    parts = [p.strip() for p in (tags_csv or "").split(",") if p.strip()]
    return parts or ["未分类"]


def _load_output_tags(wiki_name: str) -> list[str]:
    stem = Path(wiki_name).stem
    p = settings.resolved_data_dir / OUTPUT_DIR / f"{stem}.json"
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    tags = data.get("tags")
    if isinstance(tags, list):
        return [str(t).strip() for t in tags if str(t).strip()]
    return []


_SYNC_PAYLOAD_DEFAULTS: dict = {
    "visual_mermaid": "",
    "visual_caption": "",
    "visual_palette": "",
    "visual_emoji": "",
    "visual_image_path": "",
    "image_prompt": "",
    "quality_score": 1.0,
    "quality_flags": "",
    "source_anchor": "",
    "generation_meta": "",
}


def _normalize_payload(payload: dict) -> dict:
    from app.flashcard_quality import audit_payload_quality  # noqa: PLC0415

    out = {**_SYNC_PAYLOAD_DEFAULTS, **payload, "user_id": current_user_id()}
    _enrich_payload_provenance(out)
    audit_payload_quality(out)
    return out


def _enrich_payload_provenance(payload: dict) -> None:
    wiki = str(payload.get("wiki_file_name", "")).strip()
    sec = str(payload.get("section_id", "")).strip()
    payload["source_anchor"] = f"{wiki}#{sec}" if wiki and sec else wiki
    payload.setdefault("quality_score", 1.0)
    payload.setdefault("quality_flags", "")
    payload.setdefault("image_prompt", "")
    payload.setdefault(
        "generation_meta",
        json.dumps({"card_kind": payload.get("card_kind", "")}, ensure_ascii=False),
    )


def _companion_map(wiki_name: str) -> dict[str, str]:
    rows: list[ReadingCompanionCache] = list_reading_companion_rows_for_wiki(wiki_name)
    out: dict[str, str] = {}
    for row in rows:
        if row.status == "ok" and (row.companion_markdown or "").strip():
            out[row.section_id] = row.companion_markdown.strip()
    return out


def _template_section_payload(
    *,
    wiki_name: str,
    section_id: str,
    section_title: str,
    section_md: str,
    topics: list[str],
    companion: str | None,
) -> dict | None:
    body = (section_md or "").strip()
    if len(body) < _MIN_SECTION_CHARS:
        return None
    topic = topics[0] if topics else "未分类"
    title = (section_title or "本节").strip()
    front = _clip(f"「{title}」这一块在讲什么？关键概念与联系是什么？", _MAX_FRONT_CHARS)
    back_source = (companion or body).strip()
    back = _clip(back_source, _MAX_BACK_CHARS)
    if len(back) < 40:
        return None
    base = {
        "content_key": f"tpl:section:{wiki_name}:{section_id}",
        "card_kind": "section",
        "wiki_file_name": wiki_name,
        "section_id": section_id,
        "topic": topic,
        "topics_csv": ",".join(topics[:8]),
        "front_text": front,
        "back_text": back,
        "source_title": wiki_name,
    }
    base.update(
        visual_bundle_for_card(
            topic=topic,
            topics=topics,
            section_title=title,
        )
    )
    return base


def _qa_section_payloads(
    *,
    wiki_name: str,
    section_id: str,
    section_title: str,
    topics: list[str],
    qa_cards: list[dict[str, str]],
    style_fingerprint: str = "",
) -> list[dict]:
    topic = topics[0] if topics else "未分类"
    out: list[dict] = []
    gen_meta = {"card_kind": "qa", "prompt_version": "v4-teach"}
    if style_fingerprint:
        gen_meta["style_fp"] = style_fingerprint
    for i, pair in enumerate(qa_cards):
        q = pair.get("question", "").strip()
        a = pair.get("answer", "").strip()
        if not q or not a:
            continue
        payload = {
            "content_key": f"qa:{wiki_name}:{section_id}:{i}",
            "card_kind": "qa",
            "wiki_file_name": wiki_name,
            "section_id": section_id,
            "topic": topic,
            "topics_csv": ",".join(topics[:8]),
            "front_text": q,
            "back_text": a,
            "source_title": section_title or wiki_name,
        }
        img_p = str(pair.get("image_prompt", "")).strip()
        if img_p:
            payload["image_prompt"] = img_p
        payload.update(
            visual_bundle_for_card(
                topic=topic,
                topics=topics,
                section_title=section_title,
                visual_mermaid=pair.get("visual_mermaid"),
                visual_caption=pair.get("visual_caption"),
            )
        )
        payload["generation_meta"] = json.dumps(gen_meta, ensure_ascii=False)
        out.append(payload)
    return out


def _template_summary_payload(rec: IngestRecord) -> dict | None:
    summary = (rec.summary or "").strip()
    if len(summary) < 48:
        return None
    topics = _topics_from_record_tags(rec.tags_csv)
    topic = topics[0]
    front = _clip(f"《{rec.file_name}》讲了什么？", _MAX_FRONT_CHARS)
    back = _clip(summary, _MAX_BACK_CHARS)
    wiki_guess = f"{Path(rec.file_name).stem}.md"
    base = {
        "content_key": f"tpl:summary:record:{rec.id}",
        "card_kind": "summary",
        "wiki_file_name": wiki_guess,
        "section_id": "",
        "topic": topic,
        "topics_csv": ",".join(topics[:8]),
        "front_text": front,
        "back_text": back,
        "source_title": rec.file_name,
    }
    base.update(visual_bundle_for_card(topic=topic, topics=topics, section_title=rec.file_name))
    return base


def _qa_summary_payload(
    rec: IngestRecord,
    qa_cards: list[dict[str, str]],
    *,
    style_fingerprint: str = "",
) -> dict | None:
    if not qa_cards or rec.id is None:
        return None
    topics = _topics_from_record_tags(rec.tags_csv)
    pair = qa_cards[0]
    q = pair.get("question", "").strip()
    a = pair.get("answer", "").strip()
    if not q or not a:
        return None
    gen_meta = {"card_kind": "qa", "prompt_version": "v4-teach"}
    if style_fingerprint:
        gen_meta["style_fp"] = style_fingerprint
    base = {
        "content_key": f"qa:summary:record:{rec.id}:0",
        "card_kind": "qa",
        "wiki_file_name": f"{Path(rec.file_name).stem}.md",
        "section_id": "",
        "topic": topics[0],
        "topics_csv": ",".join(topics[:8]),
        "front_text": q,
        "back_text": a,
        "source_title": rec.file_name,
    }
    img_p = str(pair.get("image_prompt", "")).strip()
    if img_p:
        base["image_prompt"] = img_p
    base.update(
        visual_bundle_for_card(
            topic=topics[0],
            topics=topics,
            section_title=rec.file_name,
            visual_mermaid=pair.get("visual_mermaid"),
            visual_caption=pair.get("visual_caption"),
        )
    )
    base["generation_meta"] = json.dumps(gen_meta, ensure_ascii=False)
    return base


@dataclass
class _SectionTask:
    wiki_name: str
    wiki_index: int
    sec: MarkdownSection
    topics: list[str]
    section_body: str
    llm_input: str
    companion: str | None
    needs_llm_call: bool


def _section_qa_list(
    task: _SectionTask,
    *,
    use_llm: bool,
    llm_budget: list[int],
    budget_lock: threading.Lock | None,
    style_hint: str = "",
    style_fp: str = "",
) -> list[dict[str, str]]:
    if not use_llm or not settings.flashcard_llm_enabled:
        return []
    return qa_cards_for_section(
        wiki_name=task.wiki_name,
        section_id=task.sec.id,
        section_title=task.sec.title,
        section_text=task.llm_input,
        topics=task.topics,
        llm_budget=llm_budget,
        budget_lock=budget_lock if task.needs_llm_call else None,
        style_hint=style_hint,
        style_fingerprint=style_fp,
    )


def _apply_section_task(
    task: _SectionTask,
    qa_list: list[dict[str, str]],
    *,
    qa_sections: set[tuple[str, str]],
    allow_template_fallback: bool,
    style_fp: str = "",
) -> list[dict]:
    out: list[dict] = []
    if qa_list:
        qa_payloads = _qa_section_payloads(
            wiki_name=task.wiki_name,
            section_id=task.sec.id,
            section_title=task.sec.title,
            topics=task.topics,
            qa_cards=qa_list,
            style_fingerprint=style_fp,
        )
        out.extend(qa_payloads)
        qa_sections.add((task.wiki_name, task.sec.id))
        return out
    if (task.wiki_name, task.sec.id) in qa_sections:
        return out
    if not allow_template_fallback:
        return out
    tpl = _template_section_payload(
        wiki_name=task.wiki_name,
        section_id=task.sec.id,
        section_title=task.sec.title,
        section_md=task.section_body,
        topics=task.topics,
        companion=task.companion,
    )
    if tpl:
        out.append(tpl)
    return out


def _resolve_sync_scope(
    *,
    wiki_file_names: list[str] | None,
    record_ids: list[int] | None,
) -> tuple[set[str] | None, set[int] | None]:
    wiki_filter = {w.strip() for w in (wiki_file_names or []) if w and w.strip()} or None
    record_filter = {int(r) for r in (record_ids or [])} or None
    if record_filter is not None and wiki_filter is None:
        from app.pipeline_status import _wiki_name_for_record  # noqa: PLC0415

        rows = list_records(limit=500)
        wiki_filter = {_wiki_name_for_record(r.file_name) for r in rows if r.id in record_filter}
    return wiki_filter, record_filter


def collect_flashcard_payloads(
    *,
    use_llm: bool = True,
    skip_images: bool = False,
    on_progress: Callable[..., None] | None = None,
    style_hint: str | None = None,
    user_id: str | None = None,
    wiki_file_names: list[str] | None = None,
    record_ids: list[int] | None = None,
) -> tuple[list[dict], dict[str, int]]:
    payloads: list[dict] = []
    stats: dict = {
        "qa_cards": 0,
        "template_cards": 0,
        "llm_sections_used": 0,
        "ai_images": 0,
        "ai_image_ready": False,
        "ai_image_hint": "",
    }
    llm_budget = [max(0, int(settings.flashcard_llm_max_sections_per_sync))] if use_llm else [0]
    llm_active = bool(use_llm and settings.flashcard_llm_enabled)
    allow_template_fallback = not llm_active
    hint = style_hint if style_hint is not None else build_generation_style_hint(user_id=user_id)
    style_fp = style_fingerprint(hint)
    image_budget = (
        [max(0, int(settings.flashcard_image_max_per_sync))]
        if settings.flashcard_image_enabled and not skip_images
        else [0]
    )
    if image_budget[0] > 0:
        img_ok, img_hint = probe_ark_image_model()
        stats["ai_image_ready"] = img_ok
        stats["ai_image_hint"] = img_hint
        if not img_ok:
            logger.warning("flashcard images skipped: %s", img_hint)
            image_budget[0] = 0

    wiki_docs = list_wiki_docs()
    record_rows = list_records(limit=200)
    wiki_filter, record_filter = _resolve_sync_scope(
        wiki_file_names=wiki_file_names,
        record_ids=record_ids,
    )
    if wiki_filter is not None:
        wiki_docs = [doc for doc in wiki_docs if doc["name"] in wiki_filter]
    if record_filter is not None:
        record_rows = [rec for rec in record_rows if rec.id in record_filter]
    section_jobs: list[tuple[str, object]] = []
    for doc in wiki_docs:
        wiki_name = doc["name"]
        body = read_body_text_for_reading_companion(wiki_name)
        for sec in split_sections_for_flashcards(body):
            section_body = (sec.markdown or "").strip()
            if len(section_body) >= _MIN_SECTION_CHARS:
                section_jobs.append((wiki_name, sec))
    progress_total = len(section_jobs) + len(record_rows)
    if on_progress:
        on_progress(
            progress_current=0,
            progress_total=max(progress_total, 1),
            wikis_total=len(wiki_docs),
            wikis_done=0,
            current_wiki=wiki_docs[0]["name"] if wiki_docs else "",
            stage="llm" if use_llm else "fast",
        )

    wiki_index = 0
    progress_current = 0
    qa_sections: set[tuple[str, str]] = set()
    section_tasks: list[_SectionTask] = []
    for doc in wiki_docs:
        wiki_name = doc["name"]
        topics = _load_output_tags(wiki_name) or ["未分类"]
        companions = _companion_map(wiki_name)
        body = read_body_text_for_reading_companion(wiki_name)
        if on_progress:
            on_progress(
                current_wiki=wiki_name,
                wikis_done=wiki_index,
                wikis_total=len(wiki_docs),
                stage="llm" if use_llm else "fast",
            )
        sections: list[MarkdownSection] = []
        for sec in split_sections_for_flashcards(body):
            section_body = (sec.markdown or "").strip()
            if len(section_body) >= _MIN_SECTION_CHARS:
                sections.append(sec)
        if use_llm and settings.flashcard_llm_enabled:
            sections.sort(
                key=lambda s: (
                    1
                    if section_has_qa_cache(
                        wiki_name,
                        s.id,
                        (s.markdown or "").strip(),
                        style_fingerprint=style_fp,
                    )
                    else 0,
                    s.id,
                )
            )
        for sec in sections:
            section_body = (sec.markdown or "").strip()
            llm_input = section_body
            companion = companions.get(sec.id)
            if companion and len(companion) > len(section_body) * 0.5:
                llm_input = f"{section_body}\n\n---\n\n{companion[:2000]}"
            needs_llm = bool(
                use_llm
                and settings.flashcard_llm_enabled
                and not section_has_qa_cache(
                    wiki_name,
                    sec.id,
                    section_body,
                    style_fingerprint=style_fp,
                )
            )
            section_tasks.append(
                _SectionTask(
                    wiki_name=wiki_name,
                    wiki_index=wiki_index,
                    sec=sec,
                    topics=topics,
                    section_body=section_body,
                    llm_input=llm_input,
                    companion=companion,
                    needs_llm_call=needs_llm,
                )
            )
        wiki_index += 1

    budget_lock = threading.Lock() if use_llm and settings.flashcard_llm_enabled else None
    workers = (
        max(1, int(settings.flashcard_llm_parallel_workers))
        if use_llm and settings.flashcard_llm_enabled
        else 1
    )
    progress_lock = threading.Lock()

    def _run_section_task(task: _SectionTask) -> tuple[_SectionTask, list[dict[str, str]]]:
        qa_list = _section_qa_list(
            task,
            use_llm=use_llm,
            llm_budget=llm_budget,
            budget_lock=budget_lock if task.needs_llm_call and workers > 1 else None,
            style_hint=hint,
            style_fp=style_fp,
        )
        return task, qa_list

    def _bump_progress(task: _SectionTask) -> None:
        nonlocal progress_current
        with progress_lock:
            progress_current += 1
            pc = progress_current
        if on_progress:
            on_progress(
                progress_current=pc,
                progress_total=max(progress_total, 1),
                current_wiki=task.wiki_name,
                wikis_done=min(task.wiki_index, len(wiki_docs)),
                wikis_total=len(wiki_docs),
                stage="llm" if use_llm else "fast",
            )

    cached_tasks = [t for t in section_tasks if not t.needs_llm_call]
    uncached_tasks = [t for t in section_tasks if t.needs_llm_call]

    section_results: list[tuple[_SectionTask, list[dict[str, str]]]] = []

    def _collect_result(task: _SectionTask, qa_list: list[dict[str, str]]) -> None:
        section_results.append((task, qa_list))

    if workers > 1 and len(section_tasks) > 1:
        with ThreadPoolExecutor(max_workers=min(workers, len(section_tasks))) as pool:
            pending = section_tasks
            futures = {pool.submit(_run_section_task, task): task for task in pending}
            for fut in as_completed(futures):
                task, qa_list = fut.result()
                _bump_progress(task)
                _collect_result(task, qa_list)
    else:
        for task in cached_tasks + uncached_tasks:
            _bump_progress(task)
            _collect_result(*_run_section_task(task))

    section_results.sort(key=lambda pair: (pair[0].wiki_index, pair[0].sec.id))
    for task, qa_list in section_results:
        batch = _apply_section_task(
            task,
            qa_list,
            qa_sections=qa_sections,
            allow_template_fallback=allow_template_fallback,
            style_fp=style_fp,
        )
        for p in batch:
            payloads.append(p)
            if str(p.get("content_key", "")).startswith("qa:"):
                stats["qa_cards"] += 1
            else:
                stats["template_cards"] += 1

    stats["llm_sections_used"] = max(0, int(settings.flashcard_llm_max_sections_per_sync)) - llm_budget[0]

    for rec in record_rows:
        if rec.id is None:
            continue
        progress_current += 1
        if on_progress:
            on_progress(
                progress_current=progress_current,
                progress_total=max(progress_total, 1),
                current_wiki=rec.file_name,
                stage="llm" if use_llm else "fast",
            )
        topics = _topics_from_record_tags(rec.tags_csv)
        qa_list = []
        if use_llm and settings.flashcard_llm_enabled:
            qa_list = qa_cards_for_summary(
                record_id=rec.id,
                file_name=rec.file_name,
                summary=rec.summary,
                topics=topics,
                llm_budget=llm_budget,
                budget_lock=budget_lock,
                style_hint=hint,
                style_fingerprint=style_fp,
            )
        if qa_list:
            p = _qa_summary_payload(rec, qa_list, style_fingerprint=style_fp)
            if p:
                payloads.append(p)
                stats["qa_cards"] += 1
                continue
        if not allow_template_fallback:
            continue
        tpl = _template_summary_payload(rec)
        if tpl:
            payloads.append(tpl)
            stats["template_cards"] += 1

    if on_progress and image_budget[0] > 0:
        on_progress(stage="images", progress_current=0, progress_total=min(len(payloads), image_budget[0]))

    qa_sec = {
        (p.get("wiki_file_name", ""), p.get("section_id", ""))
        for p in payloads
        if str(p.get("content_key", "")).startswith("qa:")
    }
    if qa_sec:
        payloads = [
            p
            for p in payloads
            if not (
                str(p.get("content_key", "")).startswith("tpl:section:")
                and (p.get("wiki_file_name", ""), p.get("section_id", "")) in qa_sec
            )
        ]

    payloads = [_normalize_payload(p) for p in payloads]
    image_done = 0
    for p in payloads:
        ensure_flashcard_image_for_payload(p, image_budget=image_budget)
        if image_budget[0] <= 0:
            break
        image_done += 1
        if on_progress and image_budget[0] > 0:
            on_progress(stage="images", progress_current=image_done, progress_total=int(settings.flashcard_image_max_per_sync))
    stats["ai_images"] = max(0, int(settings.flashcard_image_max_per_sync)) - image_budget[0]

    if on_progress:
        on_progress(stage="persist", progress_current=progress_total, progress_total=max(progress_total, 1))

    return payloads, stats


def corpus_has_material() -> bool:
    if list_wiki_docs():
        return True
    return bool(list_records(limit=1))


def sync_flashcards_from_corpus(
    *,
    use_llm: bool = True,
    skip_images: bool = False,
    on_progress: Callable[..., None] | None = None,
    wiki_file_names: list[str] | None = None,
    record_ids: list[int] | None = None,
) -> dict[str, int]:
    """按 content_key 幂等写入/更新闪卡；语料删除的卡片标记 inactive。"""
    with _sync_lock:
        return _sync_flashcards_from_corpus_locked(
            use_llm=use_llm,
            skip_images=skip_images,
            on_progress=on_progress,
            wiki_file_names=wiki_file_names,
            record_ids=record_ids,
        )


def _card_in_partial_sync_scope(
    row: KnowledgeFlashcard,
    *,
    wiki_filter: set[str] | None,
    record_filter: set[int] | None,
) -> bool:
    if wiki_filter is None and record_filter is None:
        return True
    if wiki_filter and (row.wiki_file_name or "") in wiki_filter:
        return True
    if record_filter and row.content_key:
        key = row.content_key
        for rid in record_filter:
            token = f":record:{rid}"
            if token in key:
                return True
    return False


def _sync_flashcards_from_corpus_locked(
    *,
    use_llm: bool,
    skip_images: bool,
    on_progress: Callable[..., None] | None = None,
    wiki_file_names: list[str] | None = None,
    record_ids: list[int] | None = None,
) -> dict[str, int]:
    wiki_filter, record_filter = _resolve_sync_scope(
        wiki_file_names=wiki_file_names,
        record_ids=record_ids,
    )
    payloads, gen_stats = collect_flashcard_payloads(
        use_llm=use_llm,
        skip_images=skip_images,
        on_progress=on_progress,
        user_id=current_user_id(),
        wiki_file_names=list(wiki_filter) if wiki_filter else None,
        record_ids=list(record_filter) if record_filter else None,
    )
    keys_seen = {p["content_key"] for p in payloads}
    created = 0
    updated = 0
    deactivated = 0

    with Session(engine) as session:
        uid = current_user_id()
        existing = {
            row.content_key: row
            for row in session.exec(
                select(KnowledgeFlashcard).where(KnowledgeFlashcard.user_id == uid)
            ).all()
        }
        for raw in payloads:
            p = _normalize_payload(raw)
            row = existing.get(p["content_key"])
            if row is None:
                session.add(KnowledgeFlashcard(**p))
                created += 1
            else:
                changed = False
                for field in (
                    "card_kind",
                    "wiki_file_name",
                    "section_id",
                    "topic",
                    "topics_csv",
                    "front_text",
                    "back_text",
                    "source_title",
                    "visual_mermaid",
                    "visual_caption",
                    "visual_palette",
                    "visual_emoji",
                    "visual_image_path",
                    "image_prompt",
                    "quality_score",
                    "quality_flags",
                    "source_anchor",
                    "generation_meta",
                ):
                    if getattr(row, field) != p[field]:
                        setattr(row, field, p[field])
                        changed = True
                if not row.active:
                    row.active = True
                    changed = True
                if changed:
                    updated += 1
                session.add(row)
        for key, row in existing.items():
            if key not in keys_seen and row.active and (row.user_id or "") == uid:
                if not _card_in_partial_sync_scope(
                    row,
                    wiki_filter=wiki_filter,
                    record_filter=record_filter,
                ):
                    continue
                row.active = False
                session.add(row)
                deactivated += 1
        session.commit()

    active_cards = get_active_flashcards()
    ensure_review_states(active_cards)
    contra = sync_contradiction_cards()
    if contra:
        active_cards = get_active_flashcards()
        ensure_review_states(active_cards)

    from app.flashcard_feed import invalidate_feed_candidates_cache  # noqa: PLC0415

    invalidate_feed_candidates_cache()

    total_active = len(active_cards)
    logger.info(
        "flashcard sync: created=%s updated=%s deactivated=%s active=%s qa=%s tpl=%s",
        created,
        updated,
        deactivated,
        total_active,
        gen_stats.get("qa_cards", 0),
        gen_stats.get("template_cards", 0),
    )
    return {
        "created": created,
        "updated": updated,
        "deactivated": deactivated,
        "active": total_active,
        "contradiction_cards": contra,
        **gen_stats,
    }


def get_active_flashcards() -> list[KnowledgeFlashcard]:
    with Session(engine) as session:
        st = select(KnowledgeFlashcard).where(KnowledgeFlashcard.active == True).where(flashcard_scope())  # noqa: E712
        return list(session.exec(st))
