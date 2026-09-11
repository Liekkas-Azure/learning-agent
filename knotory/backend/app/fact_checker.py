"""FactChecker：对照语料检验陈述是否有一致依据。"""

from __future__ import annotations

import logging

from app.hybrid_search import search_corpus_hybrid
from app.llm import ExtractionNotConfiguredError, _openai_client_and_model, _parse_llm_json_object

logger = logging.getLogger("knotory.fact_checker")


def check_claim(claim: str, *, limit: int = 5) -> dict:
    text = (claim or "").strip()
    if len(text) < 6:
        raise ValueError("陈述过短")
    hits = search_corpus_hybrid(text, limit=limit)
    if not hits:
        return {
            "verdict": "unknown",
            "confidence": 0.2,
            "summary": "语料中未找到相关依据。",
            "sources": [],
            "provider": "none",
        }

    context = "\n\n".join(
        f"[{i}] {(h.get('title') or '')}\n{(h.get('snippet') or '')[:500]}"
        for i, h in enumerate(hits, start=1)
    )
    sources = [
        {
            "index": i,
            "title": h.get("title"),
            "wiki_file_name": h.get("wiki_file_name") or "",
            "snippet": (h.get("snippet") or "")[:300],
        }
        for i, h in enumerate(hits, start=1)
    ]

    try:
        client, model, provider = _openai_client_and_model()
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        '对照语料判断用户陈述。输出 JSON：'
                        '{"verdict":"supported|contradicted|partial|unknown","confidence":0.0,"summary":"..."}'
                    ),
                },
                {"role": "user", "content": f"陈述：{text}\n\n语料：\n{context[:20_000]}"},
            ],
            temperature=0.2,
            max_tokens=600,
        )
        raw = (resp.choices[0].message.content or "").strip()
        data = _parse_llm_json_object(raw)
        return {
            "verdict": str(data.get("verdict") or "unknown"),
            "confidence": float(data.get("confidence") or 0.5),
            "summary": str(data.get("summary") or ""),
            "sources": sources,
            "provider": provider,
        }
    except ExtractionNotConfiguredError:
        return {
            "verdict": "unknown",
            "confidence": 0.3,
            "summary": "未配置 LLM。检索到相关片段，请人工核对。",
            "sources": sources,
            "provider": "retrieval_only",
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("fact check failed: %s", exc)
        raise
