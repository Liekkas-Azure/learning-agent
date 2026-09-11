"""Chat + RAG：基于语料检索片段回答，并返回引用。"""

from __future__ import annotations

import logging

from app.hybrid_search import search_corpus_hybrid
from app.llm import ExtractionNotConfiguredError, _openai_client_and_model

logger = logging.getLogger("knotory.rag")


def answer_with_rag(query: str, *, limit: int = 6) -> dict:
    q = (query or "").strip()
    if len(q) < 2:
        raise ValueError("问题过短")
    hits = search_corpus_hybrid(q, limit=limit)
    if not hits:
        return {
            "answer": "文库中未找到相关内容。请先上传材料，或在阅读时摘录段落。",
            "sources": [],
            "provider": "none",
        }

    context_blocks: list[str] = []
    sources: list[dict] = []
    try:
        from app.student_state import build_student_state_snapshot  # noqa: PLC0415
        from app.wiki_memory import list_memory_episodes  # noqa: PLC0415

        state = build_student_state_snapshot(use_llm=False)
        profile_context = {
            "summary": state.get("summary"),
            "weak_concepts": (state.get("weak_concepts") or [])[:5],
            "profile": state.get("profile") or {},
            "recent_experience": list_memory_episodes(limit=3),
        }
        context_blocks.append(f"[学习者上下文]\n{profile_context}")
    except Exception:  # noqa: BLE001
        pass
    for i, h in enumerate(hits[:limit], start=1):
        title = h.get("title") or "未命名"
        snippet = (h.get("snippet") or "").strip()
        context_blocks.append(f"[{i}] {title}\n{snippet}")
        sources.append(
            {
                "index": i,
                "kind": h.get("kind"),
                "title": title,
                "wiki_file_name": h.get("wiki_file_name") or "",
                "record_id": h.get("record_id"),
                "clip_id": h.get("clip_id"),
                "snippet": snippet[:400],
            }
        )

    context = "\n\n".join(context_blocks)
    system = (
        "你是个人知识库助手。仅根据提供的语料片段回答，"
        "回答末尾用「引用：[1][2]」标注使用了哪些片段编号。"
        "若片段不足以回答，请明确说明并建议用户补充材料。"
    )
    user = f"问题：{q}\n\n语料片段：\n{context}"

    try:
        client, model, provider = _openai_client_and_model()
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user[:24_000]},
            ],
            temperature=0.3,
            max_tokens=1200,
        )
        answer = (resp.choices[0].message.content or "").strip()
        return {"answer": answer, "sources": sources, "provider": provider}
    except ExtractionNotConfiguredError:
        # 无 LLM 时返回检索摘要
        lines = [f"（未配置 LLM，以下为检索摘要）\n"]
        for s in sources:
            lines.append(f"- [{s['index']}] {s['title']}：{s['snippet'][:200]}")
        return {"answer": "\n".join(lines), "sources": sources, "provider": "retrieval_only"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("rag chat failed: %s", exc)
        raise
