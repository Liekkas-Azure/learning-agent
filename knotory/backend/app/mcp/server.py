"""Knotory MCP 工具服务（stdio JSON-RPC 简化实现）。"""

from __future__ import annotations

import json
import sys
from typing import Any

from app.hybrid_search import search_corpus_hybrid
from app.flashcard_feed import build_feed
from app.flashcard_ingest import save_clip


TOOLS = {
    "search_corpus": {
        "description": "Hybrid 检索个人语料（wiki/入库/剪藏）",
        "parameters": {"query": "string", "limit": "number?"},
    },
    "ingest_clip": {
        "description": "剪藏一段文本入库",
        "parameters": {"text": "string", "source_title": "string?", "source_url": "string?"},
    },
    "flashcards_feed": {
        "description": "获取推荐闪卡 feed",
        "parameters": {"session_id": "string?", "limit": "number?"},
    },
}


def _handle_tool(name: str, arguments: dict[str, Any]) -> Any:
    if name == "search_corpus":
        q = str(arguments.get("query", ""))
        limit = int(arguments.get("limit") or 10)
        return search_corpus_hybrid(q, limit=limit)
    if name == "ingest_clip":
        text = str(arguments.get("text", ""))
        if len(text.strip()) < 8:
            raise ValueError("text too short")
        clip = save_clip(
            text=text,
            source_title=str(arguments.get("source_title") or "MCP 剪藏"),
            source_url=str(arguments.get("source_url") or ""),
        )
        return {"ok": True, "clip_id": clip.id, "wiki_file_name": clip.wiki_file_name}
    if name == "flashcards_feed":
        sid = str(arguments.get("session_id") or "mcp")
        limit = int(arguments.get("limit") or 5)
        items, _ = build_feed(sid, limit=limit)
        return [
            {
                "id": it.card.id,
                "topic": it.card.topic,
                "front": it.card.front_text[:200],
                "explain": it.explain,
            }
            for it in items
        ]
    raise ValueError(f"unknown tool: {name}")


def _write(msg: dict) -> None:
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def run_stdio_server() -> None:
    """极简 MCP 兼容循环：每行一个 JSON 请求 {id, method, params}。"""
    _write({"type": "ready", "tools": TOOLS})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            _write({"error": "invalid json"})
            continue
        rid = req.get("id")
        method = req.get("method")
        params = req.get("params") or {}
        try:
            if method == "list_tools":
                result = TOOLS
            elif method == "call_tool":
                result = _handle_tool(str(params.get("name")), dict(params.get("arguments") or {}))
            else:
                raise ValueError(f"unknown method: {method}")
            _write({"id": rid, "result": result})
        except Exception as exc:  # noqa: BLE001
            _write({"id": rid, "error": str(exc)})


if __name__ == "__main__":
    run_stdio_server()
