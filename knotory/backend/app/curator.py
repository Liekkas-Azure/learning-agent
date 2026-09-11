"""Knowledge Curator：对 wiki 章节给出标签与质量建议。"""

from __future__ import annotations

import json
import logging

from app.llm import ExtractionNotConfiguredError, _openai_client_and_model, _parse_llm_json_object
from app.storage import read_wiki_doc

logger = logging.getLogger("knotory.curator")


def suggest_curation(*, wiki_file_name: str, max_chars: int = 6000) -> dict:
    name = (wiki_file_name or "").strip()
    if not name:
        raise ValueError("wiki_file_name required")
    body = read_wiki_doc(name)
    if not body or len(body.strip()) < 40:
        raise ValueError("正文过短，无法策展")
    excerpt = body.strip()[:max_chars]

    try:
        client, model, provider = _openai_client_and_model()
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是知识策展助手。输出 JSON："
                        '{"suggested_tags":[],"quality_notes":"","split_suggestions":[],"flashcard_ideas":[]}'
                        "标签 3～8 个；quality_notes 指出噪声/重复/缺失定义；"
                        "split_suggestions 建议拆分的章节标题；flashcard_ideas 1～3 个可出题方向。"
                    ),
                },
                {"role": "user", "content": f"文档：{name}\n\n{excerpt}"},
            ],
            temperature=0.35,
            max_tokens=900,
        )
        raw = (resp.choices[0].message.content or "").strip()
        data = _parse_llm_json_object(raw)
        return {
            "wiki_file_name": name,
            "suggested_tags": data.get("suggested_tags") or [],
            "quality_notes": str(data.get("quality_notes") or ""),
            "split_suggestions": data.get("split_suggestions") or [],
            "flashcard_ideas": data.get("flashcard_ideas") or [],
            "provider": provider,
        }
    except ExtractionNotConfiguredError:
        return {
            "wiki_file_name": name,
            "suggested_tags": [],
            "quality_notes": "未配置 LLM，无法生成策展建议。",
            "split_suggestions": [],
            "flashcard_ideas": [],
            "provider": "none",
        }
    except json.JSONDecodeError:
        logger.warning("curator json parse failed for %s", name)
        raise ValueError("策展结果解析失败") from None
    except Exception as exc:  # noqa: BLE001
        logger.warning("curator failed: %s", exc)
        raise
