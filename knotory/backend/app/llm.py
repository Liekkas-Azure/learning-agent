import base64
import json
import logging
import re
from pathlib import Path
from typing import Any, Literal

from openai import OpenAI, OpenAIError

from app.agents.knowledge_extract import KnowledgeExtractAgent
from app.config import settings

logger = logging.getLogger("knotory.llm")

_MAX_TAGS = 500
_EXTRACT_TEXT_CHARS = 24_000
# 单次排版请求的输入上限（留出 system / 说明文字空间）
_FORMAT_CHUNK_INPUT_CHARS = 10_000
_FORMAT_MAX_CHUNKS = 64


class ExtractionNotConfiguredError(Exception):
    """未配置可用的文本大模型 API（ARK 或 KNOTORY_CLOUD_*）。"""


def _normalize_tag_label(s: str) -> str:
    s = str(s).strip().strip("#").strip()
    if not s or len(s) > 200:
        return ""
    if all(ord(c) < 128 for c in s):
        return s.lower()
    return s


def normalize_llm_tags(raw: Any, *, max_tags: int = _MAX_TAGS) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        norm = _normalize_tag_label(item)
        if not norm:
            continue
        key = norm.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(norm)
        if len(out) >= max_tags:
            break
    return out


def _openai_client_and_model() -> tuple[OpenAI, str, Literal["ark", "cloud"]]:
    if settings.resolved_ark_api_key:
        base = settings.ark_api_base.rstrip("/")
        client = OpenAI(api_key=settings.resolved_ark_api_key, base_url=base)
        return client, settings.resolved_ark_text_model, "ark"
    key = (settings.cloud_api_key or "").strip()
    if not key:
        raise ExtractionNotConfiguredError(
            "未配置大模型：请设置 ARK_API_KEY（或 DOUBAO_API_KEY）或 KNOTORY_CLOUD_API_KEY。"
        )
    base = (settings.cloud_base_url or "").strip()
    kwargs: dict[str, str] = {"api_key": key}
    if base:
        kwargs["base_url"] = base.rstrip("/")
    client = OpenAI(**kwargs)
    return client, settings.cloud_model, "cloud"


def _strip_markdown_json_fences(content: str) -> str:
    c = content.strip()
    if not c.startswith("```"):
        return c
    lines = c.split("\n")
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _parse_llm_json_object(content: str) -> dict[str, Any]:
    c = _strip_markdown_json_fences(content)
    try:
        parsed = json.loads(c)
    except json.JSONDecodeError:
        start = c.find("{")
        end = c.rfind("}")
        if start < 0 or end <= start:
            raise
        parsed = json.loads(c[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("LLM JSON root must be an object")
    return parsed


def _coerce_llm_payload(parsed: dict[str, Any]) -> dict[str, Any]:
    summary = parsed.get("summary", "")
    if summary is None:
        summary = ""
    elif not isinstance(summary, str):
        summary = str(summary)
    summary = summary.strip() or "No summary."

    insights_raw = parsed.get("insights", [])
    if isinstance(insights_raw, str):
        insights_raw = [insights_raw]
    if not isinstance(insights_raw, list):
        insights_raw = []
    insights = [str(x).strip() for x in insights_raw if str(x).strip()]

    tags_raw = parsed.get("tags")
    if isinstance(tags_raw, str):
        parts = [p.strip() for p in re.split(r"[,，、;；]\s*", tags_raw) if p.strip()]
        tags = normalize_llm_tags(parts if len(parts) > 1 else [tags_raw])
    else:
        tags = normalize_llm_tags(tags_raw)
    tags = KnowledgeExtractAgent.refine_tags(tags)

    concepts_raw = parsed.get("concepts", [])
    if isinstance(concepts_raw, str):
        concepts_raw = [concepts_raw]
    concepts = normalize_llm_tags(concepts_raw, max_tags=20)

    prerequisites: list[dict[str, Any]] = []
    prereq_raw = parsed.get("prerequisites", [])
    if isinstance(prereq_raw, list):
        for edge in prereq_raw[:30]:
            if not isinstance(edge, dict):
                continue
            before = _normalize_tag_label(edge.get("before", ""))
            after = _normalize_tag_label(edge.get("after", ""))
            if not before or not after or before == after:
                continue
            try:
                confidence = max(0.0, min(1.0, float(edge.get("confidence", 0.5))))
            except (TypeError, ValueError):
                confidence = 0.5
            prerequisites.append(
                {"before": before, "after": after, "confidence": confidence}
            )

    return {
        "summary": summary,
        "tags": tags,
        "insights": insights,
        "concepts": concepts or tags[:20],
        "prerequisites": prerequisites,
    }


def _split_text_for_formatting(text: str, *, max_chunk: int = _FORMAT_CHUNK_INPUT_CHARS) -> list[str]:
    """按段落尽量合并，超长段再硬切，供分段排版。"""
    t = (text or "").strip()
    if not t:
        return []
    if len(t) <= max_chunk:
        return [t]
    paras = [p for p in t.split("\n\n") if p.strip() != ""]
    if not paras:
        return [t[:max_chunk]]
    chunks: list[str] = []
    current = ""
    for p in paras:
        candidate = p if not current else f"{current}\n\n{p}"
        if len(candidate) <= max_chunk:
            current = candidate
            continue
        if current:
            chunks.append(current)
            current = ""
        while p:
            if len(p) <= max_chunk:
                current = p
                p = ""
            else:
                chunks.append(p[:max_chunk])
                p = p[max_chunk:]
    if current:
        chunks.append(current)
    return chunks


_FORMAT_SYSTEM_PROMPT = (
    "你是专业中文/双语排版编辑，只做「版式整理」，不做摘要或改写观点。\n"
    "要求：\n"
    "1) 保留原文的事实、术语、数字与引用，不增删技术含义，不编造句子。\n"
    "2) 去除 PDF/扫描/OCR 产生的多余空格、孤立标点行、重复断行；"
    "把被错误拆开的英文单词合并；中文删除无意义的全角空格，但保留列表与代码中的必要空格。\n"
    "3) 用空行分隔自然段；标题行若明显来自原文则单独成段。\n"
    "4) 若原文含表格或对齐的列数据，请用 **GitHub 风格 Markdown 表格**（| 列 |）还原结构，勿用截图描述代替表格。\n"
    "5) 若存在清晰的流程、时序、类图等结构关系，可用 ```mermaid 代码块输出（仅当确有结构可画时；不要空块）。\n"
    "6) 不要输出任何前言、后记或「以下是整理结果」；不要使用包裹整篇的 Markdown 代码围栏（不要用 ``` 包住全文）。\n"
    "7) 若本段几乎只有噪声，可输出一行：「（本段无有效正文）」。\n"
)


def format_extracted_body_with_llm(text: str) -> tuple[str, Literal["ark", "cloud"], int]:
    """
    用已配置的文本大模型对抽取正文做全文重新排版（超长则分段处理后再拼接）。
    返回 (正文, 线路, 分段数)。
    """
    raw = (text or "").strip()
    if not raw:
        return "", "ark", 0

    pieces = _split_text_for_formatting(raw, max_chunk=_FORMAT_CHUNK_INPUT_CHARS)
    if len(pieces) > _FORMAT_MAX_CHUNKS:
        raise ValueError(
            f"正文过长，分段数超过 {_FORMAT_MAX_CHUNKS}，暂无法一次性完成全文排版；"
            "可将文档拆成多份导入或后续再支持更高上限。"
        )

    client, model, provider = _openai_client_and_model()
    out: list[str] = []
    total = len(pieces)
    for i, chunk in enumerate(pieces):
        user_msg = (
            f"全文在排版时被分为 {total} 段，这是第 {i + 1} 段。"
            "只输出本段整理后的正文，不要重复说明分段信息。\n\n"
            "需要整理的文本：\n\n"
            f"{chunk}"
        )
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _FORMAT_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.12,
        )
        part = (resp.choices[0].message.content or "").strip()
        part = _strip_markdown_json_fences(part)
        if part.startswith("```"):
            part = _strip_markdown_json_fences(part)
        out.append(part)
    merged = "\n\n".join(x for x in out if x)
    return merged.strip(), provider, total


def extract_with_llm(text: str) -> tuple[dict, Literal["ark", "cloud"]]:
    """
    摘要与标签由大模型根据正文推断；正文先经 KnowledgeExtractAgent 降噪与长文档分层采样。
    凭证：优先 ARK_API_KEY（火山方舟），否则 KNOTORY_CLOUD_*（OpenAI 兼容 chat.completions）。
    """
    raw = (text or "").strip()

    client, model, provider = _openai_client_and_model()
    if not raw:
        return {
            "summary": "No content extracted.",
            "tags": [],
            "insights": [],
            "concepts": [],
            "prerequisites": [],
        }, provider

    try:
        snippet = KnowledgeExtractAgent.prepare_body(raw, max_chars=_EXTRACT_TEXT_CHARS)
    except Exception as exc:  # noqa: BLE001
        logger.warning("prepare_body failed, fallback to raw prefix: %s", exc)
        snippet = raw[:_EXTRACT_TEXT_CHARS]
    snippet = snippet[:_EXTRACT_TEXT_CHARS]
    prompt = KnowledgeExtractAgent.user_prompt_prefix() + snippet

    resp = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "你是知识提取助手。必须只输出合法 JSON（单个对象），不得输出 markdown 围栏或其它说明。"
                    "对电子书/扫描 PDF 要区分版式噪声与真正的技术论述；标签只反映后者。"
                ),
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
    )
    content = resp.choices[0].message.content or "{}"
    try:
        parsed = _parse_llm_json_object(content)
        return _coerce_llm_payload(parsed), provider
    except (json.JSONDecodeError, ValueError) as exc:
        logger.exception("LLM extraction JSON parse failed: %s", exc)
        raise ValueError(
            "大模型返回的内容无法解析为预期的 JSON（summary / tags / insights）。"
        ) from exc


_COMPANION_MAX_SECTION = 8000
_COMPANION_MAX_CORPUS = 8
_COMPANION_SUMMARY_EACH = 420
_COMPANION_FULL_RAW_MAX = 16_000


def excerpt_text_for_companion_raw(raw: str, *, max_chars: int = _COMPANION_FULL_RAW_MAX) -> str:
    """全文抽取过长时取头尾摘录，供伴读交叉理解术语与上下文。"""
    t = (raw or "").strip()
    if not t:
        return ""
    if len(t) <= max_chars:
        return t
    head = (max_chars * 55) // 100
    tail = (max_chars * 38) // 100
    return (
        f"{t[:head]}\n\n"
        f"…[全文约 {len(t)} 字：伴读仅附前段与后段 raw 摘录，请勿将摘录当作独立文献]…\n\n"
        f"{t[-tail:]}"
    )


def _reading_companion_user_content(
    *,
    section_title: str,
    section_text: str,
    doc_title: str,
    corpus: list[tuple[str, str]],
    full_raw_excerpt: str,
) -> str:
    sec = (section_text or "").strip()[:_COMPANION_MAX_SECTION]
    stitle = (section_title or "该段").strip() or "该段"
    dtitle = (doc_title or "当前文档").strip() or "当前文档"
    lines: list[str] = []
    for fn, summ in corpus[:_COMPANION_MAX_CORPUS]:
        s = (summ or "").strip().replace("\n", " ")[:_COMPANION_SUMMARY_EACH]
        if not s:
            continue
        label = (fn or "未命名").strip()
        lines.append(f"- 《{label}》摘要摘录：{s}")
    corpus_block = (
        "\n".join(lines) if lines else "（暂无其它已入库文档摘要；仅基于本段与全文摘录回答。）"
    )
    raw_block = (
        "【全文抽取 raw 摘录（与下方「本段正文」为同一文档；用于术语、指代与上下文交叉理解；"
        "勿将摘录当作另一本书或编造未出现的细节）】\n"
        f"{full_raw_excerpt.strip()}\n\n"
        if full_raw_excerpt.strip()
        else "（本库未找到该文档的 raw/*.txt 全文抽取；仅依据本段正文与书架摘要伴读。）\n\n"
    )
    return (
        f"当前在阅读文档：{dtitle}\n"
        f"本段小标题/主题：{stitle}\n\n"
        f"{raw_block}"
        f"【本段正文（阅读焦点）】\n{sec}\n\n"
        f"【用户书架上其它材料的摘要（供联想对照，勿编造其中未出现的具体事实）】\n"
        f"{corpus_block}\n\n"
        "请用简体中文输出一段「伴读」，帮助读者更快读懂上文。要求：\n"
        "1) 使用 Markdown：可有二/三级标题、无序列表、**加粗**关键词；不要用 ``` 围栏包裹全文。\n"
        "2) 建议结构：先用一两句话概括本段核心；再「要点拆解」分点说明；如合适再给「小例子或类比」；"
        "最后给 1～3 条「洞察或自检问题」。\n"
        "3) 若全文 raw 摘录中有与本段呼应的术语或背景，可点到为止地串起来；若其它摘要中有明显相关主题，可一句提示「可与某篇对照」。\n"
        "4) 总篇幅约 400～900 个汉字等效；避免空洞套话。"
    )


def _sse_data(obj: dict) -> bytes:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode("utf-8")


def iter_reading_companion_sse(
    *,
    section_title: str,
    section_text: str,
    doc_title: str,
    corpus: list[tuple[str, str]],
    full_raw_excerpt: str,
):
    """SSE：meta → delta* → done；异常时发 error 帧。"""
    try:
        client, model, provider = _openai_client_and_model()
    except ExtractionNotConfiguredError as exc:
        yield _sse_data({"type": "error", "message": str(exc)})
        return

    user_msg = _reading_companion_user_content(
        section_title=section_title,
        section_text=section_text,
        doc_title=doc_title,
        corpus=corpus,
        full_raw_excerpt=full_raw_excerpt,
    )
    yield _sse_data({"type": "meta", "provider": provider})

    try:
        stream = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是耐心、严谨的阅读伴侣。只做解释、梳理与温和联想，不替用户下最终结论；"
                        "不编造来源中不存在的事实、数据或引用。"
                    ),
                },
                {"role": "user", "content": user_msg},
            ],
            temperature=0.35,
            stream=True,
        )
        for chunk in stream:
            ch0 = chunk.choices[0] if chunk.choices else None
            if ch0 is None or ch0.delta is None:
                continue
            piece = ch0.delta.content or ""
            if piece:
                yield _sse_data({"type": "delta", "text": piece})
    except OpenAIError as exc:
        logger.warning("reading-companion stream LLM error: %s", exc)
        yield _sse_data({"type": "error", "message": f"大模型接口错误: {exc}"})
        return
    except Exception as exc:  # noqa: BLE001
        logger.exception("reading-companion stream failed: %s", exc)
        yield _sse_data({"type": "error", "message": f"伴读生成失败: {type(exc).__name__}"})
        return

    yield _sse_data({"type": "done"})


def generate_reading_companion(
    *,
    section_title: str,
    section_text: str,
    doc_title: str,
    corpus: list[tuple[str, str]],
    full_raw_excerpt: str = "",
) -> tuple[str, Literal["ark", "cloud"]]:
    """
    非流式：为当前阅读段落生成「伴读」Markdown。
    full_raw_excerpt 为已截断的全文 raw 摘录（可为空）。
    """
    client, model, provider = _openai_client_and_model()
    user_msg = _reading_companion_user_content(
        section_title=section_title,
        section_text=section_text,
        doc_title=doc_title,
        corpus=corpus,
        full_raw_excerpt=full_raw_excerpt,
    )
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "你是耐心、严谨的阅读伴侣。只做解释、梳理与温和联想，不替用户下最终结论；"
                    "不编造来源中不存在的事实、数据或引用。"
                ),
            },
            {"role": "user", "content": user_msg},
        ],
        temperature=0.35,
        timeout=float(settings.companion_llm_timeout_sec),
    )
    text = (resp.choices[0].message.content or "").strip()
    return text or "（模型未返回伴读内容，请稍后重试。）", provider


def vision_transcribe_image(path: Path) -> str:
    """图片识图：火山方舟豆包多模态（见 app.doubao）。"""
    from app.doubao import transcribe_image  # noqa: PLC0415

    return transcribe_image(path)


_CLOUD_IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
}


def _cloud_image_mime(path: Path) -> str:
    return _CLOUD_IMAGE_MIME.get(path.suffix.lower(), "image/png")


def transcribe_page_image_cloud(path: Path) -> str:
    """OpenAI 兼容云端：用支持视觉的 chat.completions 转写单页图片（扫描 PDF 兜底）。"""
    key = settings.resolved_cloud_api_key
    if not key:
        return ""
    try:
        raw = path.read_bytes()
    except OSError as exc:
        logger.warning("Cloud vision: cannot read %s: %s", path, exc)
        return ""
    if not raw:
        return ""

    base = (settings.cloud_base_url or "").strip()
    kwargs: dict[str, str] = {"api_key": key}
    if base:
        kwargs["base_url"] = base.rstrip("/")
    client = OpenAI(**kwargs)

    mime = _cloud_image_mime(path)
    b64 = base64.b64encode(raw).decode("ascii")
    prompt = (
        "请转写图片中的全部可见文字，尽量保持原有换行与段落。"
        "若几乎没有文字，用一两句话客观描述图片内容。只输出正文，不要 Markdown 围栏。"
    )
    try:
        resp = client.chat.completions.create(
            model=settings.cloud_model,
            temperature=0.1,
            max_tokens=4096,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{b64}"},
                        },
                    ],
                }
            ],
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Cloud vision transcribe failed (%s): %s", settings.cloud_model, exc)
        return ""

    content = resp.choices[0].message.content
    text = (content or "").strip() if isinstance(content, str) else ""
    return text


def transcribe_image_multivendor(path: Path) -> str:
    """识图：优先火山方舟；否则使用 KNOTORY_CLOUD_*（须为支持 image_url 的模型）。"""
    if settings.resolved_ark_api_key:
        return vision_transcribe_image(path)
    return transcribe_page_image_cloud(path)
