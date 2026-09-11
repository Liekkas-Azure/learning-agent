"""闪卡导出、笔记聚合、写作草稿、学习路径。"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone

from sqlmodel import Session, select

from app.flashcard_srs import mastery_by_topic
from app.models import FlashcardUserNote, KnowledgeFlashcard
from app.storage import engine, list_records, list_wiki_docs
from app.tenant_queries import flashcard_scope, note_scope

def export_flashcards_markdown(*, wiki_file_name: str | None = None) -> str:
    with Session(engine) as session:
        st = (
            select(KnowledgeFlashcard)
            .where(flashcard_scope())
            .where(KnowledgeFlashcard.active == True)  # noqa: E712
        )
        if wiki_file_name:
            st = st.where(KnowledgeFlashcard.wiki_file_name == wiki_file_name)
        cards = list(session.exec(st.order_by(KnowledgeFlashcard.topic, KnowledgeFlashcard.id)))
    lines = ["# Knotory 闪卡导出", f"导出时间: {datetime.now(timezone.utc).isoformat()}", ""]
    for c in cards:
        lines.append(f"## [{c.topic}] {c.front_text[:60]}")
        lines.append(f"- 类型: {c.card_kind} | 来源: {c.source_title}")
        if c.wiki_file_name:
            lines.append(f"- Wiki: `{c.wiki_file_name}` 节 `{c.section_id}`")
        lines.append("")
        lines.append(f"**问：** {c.front_text}")
        lines.append("")
        lines.append(f"**答：** {c.back_text}")
        lines.append("")
    return "\n".join(lines)


def export_flashcards_json(*, wiki_file_name: str | None = None) -> list[dict]:
    with Session(engine) as session:
        st = (
            select(KnowledgeFlashcard)
            .where(flashcard_scope())
            .where(KnowledgeFlashcard.active == True)  # noqa: E712
        )
        if wiki_file_name:
            st = st.where(KnowledgeFlashcard.wiki_file_name == wiki_file_name)
        cards = list(session.exec(st))
    return [
        {
            "id": c.id,
            "topic": c.topic,
            "card_kind": c.card_kind,
            "front_text": c.front_text,
            "back_text": c.back_text,
            "wiki_file_name": c.wiki_file_name,
            "section_id": c.section_id,
            "source_title": c.source_title,
            "quality_score": c.quality_score,
        }
        for c in cards
        if c.id is not None
    ]


def aggregate_notes_markdown() -> str:
    with Session(engine) as session:
        notes = {n.flashcard_id: n.text for n in session.exec(select(FlashcardUserNote).where(note_scope())).all()}
        cards = list(
            session.exec(
                select(KnowledgeFlashcard).where(flashcard_scope()).where(KnowledgeFlashcard.active == True)  # noqa: E712
            )
        )
    lines = ["# 闪卡笔记汇总", ""]
    for c in cards:
        if c.id is None or c.id not in notes or not notes[c.id].strip():
            continue
        lines.append(f"## {c.topic} · {c.front_text[:40]}")
        lines.append(notes[c.id].strip())
        lines.append("")
    if len(lines) <= 2:
        lines.append("_（暂无服务端笔记）_")
    return "\n".join(lines)


def build_writing_draft(card_ids: list[int]) -> dict:
    with Session(engine) as session:
        cards = [session.get(KnowledgeFlashcard, i) for i in card_ids]
    cards = [c for c in cards if c is not None and c.active]
    topics: dict[str, list[KnowledgeFlashcard]] = defaultdict(list)
    for c in cards:
        topics[c.topic].append(c)
    outline_lines = ["# 学习要点草稿", ""]
    for topic, group in sorted(topics.items(), key=lambda x: x[0]):
        outline_lines.append(f"## {topic}")
        for c in group:
            outline_lines.append(f"- **{c.front_text}** — {c.back_text[:120]}…")
        outline_lines.append("")
    body = "\n".join(outline_lines)
    return {"outline_markdown": body, "card_count": len(cards), "topics": list(topics.keys())}


def build_learning_path_heuristic(*, days: int = 7) -> dict:
    """启发式路径（供 Agent Planner 与 Agent 关闭时回退）。"""
    docs = list_wiki_docs()
    records = list_records(limit=100)
    mastery = mastery_by_topic()
    try:
        from app.student_state import weak_concepts  # noqa: PLC0415

        bkt_weak = weak_concepts(limit=max(days, 3))
    except Exception:  # noqa: BLE001
        bkt_weak = []

    if bkt_weak:
        weak = [
            {
                "topic": w["concept_label"],
                "mastery_pct": w["mastery_pct"],
                "due": 0,
            }
            for w in bkt_weak
        ]
    else:
        weak = sorted(mastery, key=lambda m: (m["mastery_pct"], -m["due"]))[: max(days, 3)]
    weak_topics = {m["topic"] for m in weak}

    def _doc_priority(doc: dict) -> tuple:
        name = (doc.get("name") or "").lower()
        score = 0
        for t in weak_topics:
            if t.lower() in name:
                score += 10
        return (-score, name)

    ordered_docs = sorted(docs, key=_doc_priority)
    path: list[dict] = []
    for day, doc in enumerate(ordered_docs[:days], start=1):
        name = doc.get("name", "")
        topic_hint = next((m for m in weak if m["topic"].lower() in name.lower()), None)
        if topic_hint is None and day - 1 < len(weak):
            topic_hint = weak[day - 1]
        tasks = [
            f"轻量刷读：推荐流刷 5～10 张（今日目标）",
            f"深读《{name.replace('.md', '')}》关键章节（可选）",
            f"巩固到期卡（约 {topic_hint['due'] if topic_hint else '若干'} 张）",
        ]
        path.append(
            {
                "day": day,
                "title": name.replace(".md", ""),
                "wiki_file_name": name,
                "focus_topic": topic_hint["topic"] if topic_hint else "",
                "tasks": tasks,
                "actions": [
                    {"label": "刷推荐流", "href": "/"},
                    {"label": "巩固到期卡", "href": "/review"},
                    {"label": "专题测验", "href": "/exam"},
                ],
                "why": (
                    f"优先补「{topic_hint['topic']}」掌握度（当前约 {topic_hint['mastery_pct']}%）"
                    if topic_hint
                    else "按文库顺序推进，配合推荐流碎片化刷读"
                ),
            }
        )
    return {
        "days": days,
        "steps": path,
        "mastery": mastery[:12],
        "corpus_count": len(records),
        "weak_topics": [m["topic"] for m in weak[:6]],
    }


def build_learning_path(*, days: int = 7) -> dict:
    from app.config import settings  # noqa: PLC0415

    if getattr(settings, "learning_agent_enabled", True):
        try:
            from app.agents.learning_graph import run_learning_loop  # noqa: PLC0415

            loop = run_learning_loop(goal="个性化学习闭环", days=days)
            plan = loop.get("plan") or {}
            if plan.get("steps"):
                return {
                    **plan,
                    "agent": {
                        "engine": loop.get("engine"),
                        "trace": loop.get("trace"),
                        "diagnosis_summary": (loop.get("diagnosis") or {}).get("summary"),
                        "diagnosis": loop.get("diagnosis"),
                        "policy": loop.get("policy"),
                        "execution": loop.get("execution"),
                        "execution_history": loop.get("execution_history") or [],
                        "evaluation": loop.get("evaluation"),
                        "memory_write": loop.get("memory_write"),
                        "replanned": bool(plan.get("replanned")),
                    },
                    "student_state": {
                        "weak_concepts": (loop.get("diagnosis") or {}).get("weak_concepts") or [],
                    },
                }
        except Exception:  # noqa: BLE001
            pass

    return build_learning_path_heuristic(days=days)


def share_pack(card_ids: list[int]) -> dict:
    """脱敏分享包（无原文路径，仅正反面）。"""
    with Session(engine) as session:
        cards = [session.get(KnowledgeFlashcard, i) for i in card_ids if i > 0]
    items = []
    for c in cards:
        if c is None or not c.active:
            continue
        items.append(
            {
                "topic": c.topic,
                "front": c.front_text,
                "back": c.back_text[:400],
                "kind": c.card_kind,
            }
        )
    return {"version": 1, "count": len(items), "items": items}
