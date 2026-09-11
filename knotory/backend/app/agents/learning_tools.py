"""Learning Agent 的可执行工具注册表。"""

from __future__ import annotations

from typing import Any, Callable

from app.flashcard_feed import build_feed, get_active_flashcards
from app.flashcard_srs import list_due_flashcards
from app.hybrid_search import search_corpus_hybrid
from app.storage import list_wiki_docs, read_wiki_doc


ACTION_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "srs_due",
            "description": "复习已经到期的闪卡；适合遗忘风险或到期积压较高时。",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 30}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "feynman",
            "description": "让学生口述解释弱知识点并接受语义诊断。",
            "parameters": {
                "type": "object",
                "properties": {"concept": {"type": "string"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "deep_read",
            "description": "打开与目标知识点相关的文库材料深读。",
            "parameters": {
                "type": "object",
                "properties": {"wiki_file_name": {"type": "string"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "exam",
            "description": "对目标知识点进行专题测验。",
            "parameters": {
                "type": "object",
                "properties": {"concept": {"type": "string"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "rag_clarify",
            "description": "用个人知识库 RAG 澄清具体疑问或错误概念。",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "feed_review",
            "description": "用个性化推荐流进行轻量刷读。",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def _srs_due(args: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    limit = max(1, min(30, int(args.get("limit") or 12)))
    due = list_due_flashcards(limit=limit)
    if not due:
        return {"ok": False, "error": "当前没有到期闪卡", "retryable": True}
    return {
        "ok": True,
        "tool": "list_due_flashcards",
        "count": len(due),
        "payload": {
            "cards": [
                {
                    "id": card.id,
                    "topic": card.topic,
                    "question": card.front_text,
                    "source": card.source_title,
                }
                for card in due[:limit]
            ]
        },
        "cta": {"label": f"巩固 {len(due)} 张到期卡", "href": "/review"},
    }


def _feynman(args: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    cards = get_active_flashcards()
    if not cards:
        return {"ok": False, "error": "尚无可讲解闪卡", "retryable": True}
    concept = str(args.get("concept") or context.get("focus_concept") or "").strip()
    ordered = sorted(
        cards,
        key=lambda card: 0 if concept and concept.lower() in (card.topic or "").lower() else 1,
    )
    brief = None
    for card in ordered[:12]:
        if card.id is None:
            continue
        try:
            from app.feynman_session import build_feynman_brief  # noqa: PLC0415

            brief = build_feynman_brief(card.id, use_note=True)
            break
        except ValueError:
            continue
    if brief is None:
        return {"ok": False, "error": "缺少可用于费曼讲解的出处正文", "retryable": True}
    return {
        "ok": True,
        "tool": "feynman_session",
        "concept": concept,
        "payload": {"brief": brief},
        "cta": {"label": "开始费曼讲解", "href": "/feynman"},
    }


def _deep_read(args: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    docs = list_wiki_docs()
    if not docs:
        return {"ok": False, "error": "文库中暂无可深读材料", "retryable": True}
    requested = str(args.get("wiki_file_name") or context.get("wiki_file_name") or "")
    names = [str(doc.get("name") or "") for doc in docs if doc.get("name")]
    wiki = requested if requested in names else names[0]
    markdown = read_wiki_doc(wiki)
    headings = [
        line.lstrip("#").strip()
        for line in markdown.splitlines()
        if line.startswith("#")
    ][:12]
    return {
        "ok": True,
        "tool": "wiki_reader",
        "wiki_file_name": wiki,
        "payload": {
            "title": wiki.removesuffix(".md"),
            "headings": headings,
            "preview": markdown[:1800],
        },
        "cta": {"label": "深读文库", "href": f"/library?wiki={wiki}"},
    }


def _exam(args: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    cards = get_active_flashcards()
    if len(cards) < 5:
        return {"ok": False, "error": "闪卡不足 5 张，无法生成专题测验", "retryable": True}
    concept = str(args.get("concept") or context.get("focus_concept") or "").strip()
    matched = [
        card
        for card in cards
        if not concept or concept.lower() in (card.topic or "").lower()
    ]
    selected = (matched if len(matched) >= 5 else cards)[:12]
    return {
        "ok": True,
        "tool": "topic_exam",
        "concept": concept,
        "payload": {
            "questions": [
                {
                    "id": card.id,
                    "topic": card.topic,
                    "question": card.front_text,
                }
                for card in selected
            ]
        },
        "cta": {"label": "开始专题测验", "href": "/exam"},
    }


def _rag_clarify(args: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    query = str(args.get("query") or context.get("focus_concept") or "").strip()
    if not query:
        return {"ok": False, "error": "缺少需要澄清的问题", "retryable": True}
    hits = search_corpus_hybrid(query, limit=5)
    if not hits:
        return {"ok": False, "error": "个人知识库中没有足够依据", "retryable": True}
    from app.rag_chat import answer_with_rag  # noqa: PLC0415

    answer = answer_with_rag(query, limit=5)
    return {
        "ok": True,
        "tool": "rag_chat",
        "query": query,
        "evidence_count": len(hits),
        "payload": answer,
        "cta": {"label": "用 RAG 澄清", "href": f"/chat?q={query}"},
    }


def _feed_review(args: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    cards = get_active_flashcards()
    if not cards:
        return {"ok": False, "error": "尚无闪卡，请先入库资料", "retryable": False}
    feed, _has_more = build_feed("learning-agent", limit=6)
    return {
        "ok": True,
        "tool": "flashcard_feed",
        "count": len(feed),
        "payload": {
            "cards": [
                {
                    "id": item.card.id,
                    "topic": item.card.topic,
                    "question": item.card.front_text,
                    "reason": item.explain,
                }
                for item in feed
            ]
        },
        "cta": {"label": "刷推荐流", "href": "/"},
    }


_TOOLS: dict[str, Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]]] = {
    "srs_due": _srs_due,
    "feynman": _feynman,
    "deep_read": _deep_read,
    "exam": _exam,
    "rag_clarify": _rag_clarify,
    "feed_review": _feed_review,
}


def execute_learning_tool(
    name: str,
    *,
    arguments: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """校验白名单后真正调用工具；错误作为可重规划反馈返回。"""
    tool = _TOOLS.get(name)
    if tool is None:
        return {
            "ok": False,
            "error": f"未知教学工具：{name}",
            "retryable": True,
            "tool": name,
        }
    try:
        result = tool(arguments or {}, context or {})
        return {"action": name, **result}
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "error": str(exc)[:300],
            "retryable": True,
            "tool": name,
            "action": name,
        }
