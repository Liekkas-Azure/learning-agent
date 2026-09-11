"""LLM Wiki 长期记忆：Reflection 筛选高价值信息写回 Memory / Wiki。"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

from app.corpus_store import notify_path_written
from app.models import MemoryEpisode
from app.paths import tenant_data_dir
from app.storage import WIKI_DIR, engine
from app.tenant import current_user_id
from app.vector_store import upsert_document_chunks

logger = logging.getLogger("knotory.wiki_memory")

_MEMORY_WIKI = "_student_memory.md"
_VALUE_THRESHOLD = 0.55


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _slugify_concept(name: str) -> str:
    plain = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff_-]+", "-", (name or "").strip()).strip("-")
    return (plain or "concept")[:80]


def reflect_and_write(
    *,
    event: str,
    payload: dict[str, Any],
    concepts: list[str] | None = None,
) -> dict[str, Any]:
    """
    Reflection：评估交互是否值得写入长期记忆。
    - 低价值：丢弃，避免污染 Memory
    - 高价值：写入 MemoryEpisode + `_student_memory.md` + 向量块
    """
    owner = current_user_id()
    reflection = _reflect(event=event, payload=payload, concepts=concepts or [])
    value = float(reflection.get("value_score") or 0.0)
    if value < _VALUE_THRESHOLD:
        return {"written": False, "value_score": value, "reason": reflection.get("reason") or "低价值，跳过写回"}

    title = str(reflection.get("title") or event)[:256]
    body = str(reflection.get("body") or "").strip()
    if len(body) < 8:
        return {"written": False, "value_score": value, "reason": "反思正文过短"}

    concept_list = [str(c).strip() for c in (reflection.get("concepts") or concepts or []) if str(c).strip()]
    normalized = json.dumps(
        {
            "event": event,
            "title": title.strip().lower(),
            "body": re.sub(r"\s+", " ", body.strip().lower()),
            "concepts": sorted(c.lower() for c in concept_list),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    memory_key = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    with Session(engine) as session:
        existing = session.exec(
            select(MemoryEpisode).where(
                MemoryEpisode.user_id == owner,
                MemoryEpisode.memory_key == memory_key,
            )
        ).first()
        if existing is not None:
            return {
                "written": False,
                "duplicate": True,
                "value_score": value,
                "episode_id": existing.id,
                "reason": "相同高价值经验已存在，避免重复污染 Memory",
            }
        ep = MemoryEpisode(
            user_id=owner,
            memory_key=memory_key,
            kind="reflection",
            title=title,
            body=body[:4000],
            concepts_csv=",".join(concept_list[:12]),
            value_score=value,
            wiki_file_name=_MEMORY_WIKI,
            source_event=event[:128],
            created_at=_utcnow(),
        )
        session.add(ep)
        session.commit()
        session.refresh(ep)
        episode_id = ep.id

    wiki_path = _append_memory_wiki(title=title, body=body, concepts=concept_list, event=event)
    try:
        upsert_document_chunks(
            source_kind="memory",
            source_ref=f"episode:{episode_id}",
            title=title,
            text=f"{title}\n{body}\n概念: {', '.join(concept_list)}",
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("memory vector upsert failed: %s", exc)

    return {
        "written": True,
        "value_score": value,
        "episode_id": episode_id,
        "wiki_file_name": wiki_path.name if wiki_path else _MEMORY_WIKI,
        "title": title,
        "concepts": concept_list,
    }


def list_memory_episodes(*, limit: int = 20) -> list[dict[str, Any]]:
    owner = current_user_id()
    with Session(engine) as session:
        rows = list(
            session.exec(
                select(MemoryEpisode)
                .where(MemoryEpisode.user_id == owner)
                .order_by(MemoryEpisode.created_at.desc())
                .limit(max(1, limit))
            )
        )
    return [
        {
            "id": r.id,
            "title": r.title,
            "body": r.body,
            "concepts": [c for c in (r.concepts_csv or "").split(",") if c],
            "value_score": r.value_score,
            "source_event": r.source_event,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


def _append_memory_wiki(*, title: str, body: str, concepts: list[str], event: str) -> Path | None:
    root = tenant_data_dir() / WIKI_DIR
    root.mkdir(parents=True, exist_ok=True)
    path = root / _MEMORY_WIKI
    stamp = _utcnow().strftime("%Y-%m-%d %H:%M UTC")
    links = " ".join(f"[[{_slugify_concept(c)}]]" for c in concepts[:8])
    block = (
        f"\n## {title}\n\n"
        f"- 时间: {stamp}\n"
        f"- 事件: `{event}`\n"
        f"- 概念: {links or '—'}\n\n"
        f"{body.strip()}\n"
    )
    if not path.exists():
        header = (
            "---\n"
            "title: Student Long-term Memory\n"
            "tags: [memory, student-state, reflection]\n"
            "---\n\n"
            "# 学习长期记忆（LLM Wiki）\n\n"
            "> 由 Reflector 筛选高价值交互写回，低价值信息不入库，避免污染 Memory。\n"
        )
        path.write_text(header + block, encoding="utf-8")
    else:
        path.write_text(path.read_text(encoding="utf-8", errors="ignore") + block, encoding="utf-8")
    notify_path_written(path)
    return path


def _reflect(*, event: str, payload: dict[str, Any], concepts: list[str]) -> dict[str, Any]:
    """优先 LLM 反思；失败则用启发式价值分。"""
    heuristic = _heuristic_reflect(event=event, payload=payload, concepts=concepts)
    try:
        from app.llm import _openai_client_and_model  # noqa: PLC0415

        client, model, _ = _openai_client_and_model()
        user = (
            "评估这条学习交互是否应写入长期记忆。只输出 JSON：\n"
            '{"value_score":0-1,"title":"...","body":"高价值经验摘要","concepts":["..."],'
            '"reason":"为何写入或丢弃"}\n'
            "规则：重复刷卡、无新错误模式、纯闲聊 → 低分；典型错误、突破性理解、路径调整 → 高分。\n"
            f"event={event}\n"
            f"concepts={concepts}\n"
            f"payload={json.dumps(payload, ensure_ascii=False)[:2500]}"
        )
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "你是 Memory Reflector，负责防止无效信息污染长期记忆。"},
                {"role": "user", "content": user},
            ],
            temperature=0.2,
            max_tokens=400,
        )
        content = resp.choices[0].message.content or "{}"
        from app.llm import _parse_llm_json_object  # noqa: PLC0415

        parsed = _parse_llm_json_object(content)
        score = float(parsed.get("value_score", heuristic["value_score"]))
        return {
            "value_score": max(0.0, min(1.0, score)),
            "title": str(parsed.get("title") or heuristic["title"])[:256],
            "body": str(parsed.get("body") or heuristic["body"])[:2000],
            "concepts": parsed.get("concepts") if isinstance(parsed.get("concepts"), list) else concepts,
            "reason": str(parsed.get("reason") or "")[:240],
        }
    except Exception as exc:  # noqa: BLE001
        logger.info("reflection llm skipped: %s", exc)
        return heuristic


def _heuristic_reflect(*, event: str, payload: dict[str, Any], concepts: list[str]) -> dict[str, Any]:
    score = 0.35
    gaps = payload.get("gaps") or []
    if isinstance(gaps, list) and gaps:
        score += 0.25
    if payload.get("passed") is False:
        score += 0.15
    if payload.get("rating") == 0:
        score += 0.2
    if payload.get("replan"):
        score += 0.25
    if event in {"feynman_evaluate", "learning_replan", "agent_reflect"}:
        score += 0.1
    title = str(payload.get("concept") or (concepts[0] if concepts else event))[:80]
    body_bits = []
    if gaps:
        body_bits.append("典型缺口：" + "；".join(str(g) for g in gaps[:4]))
    if payload.get("coach_message"):
        body_bits.append(str(payload["coach_message"])[:200])
    if payload.get("summary"):
        body_bits.append(str(payload["summary"])[:240])
    if not body_bits:
        body_bits.append(f"事件 {event} 的学习痕迹。")
    return {
        "value_score": max(0.0, min(1.0, score)),
        "title": f"记忆 · {title}",
        "body": "\n".join(body_bits),
        "concepts": concepts,
        "reason": "heuristic",
    }
