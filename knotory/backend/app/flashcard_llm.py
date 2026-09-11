"""用大模型从章节/摘要生成问答式闪卡。"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Any, Literal

import threading

from app.config import settings
from app.corpus_store import notify_path_written
from app.flashcard_visual import sanitize_mermaid
from app.llm import ExtractionNotConfiguredError, _openai_client_and_model, _parse_llm_json_object

logger = logging.getLogger("knotory.flashcard_llm")

_QA_CACHE_DIR = "flashcard_qa"
_MAX_FRONT = 220
_MAX_BACK = 1400
_MIN_ANSWER_CHARS = 120
_QA_PROMPT_VERSION = "v5-density"


def _clip(text: str, limit: int) -> str:
    t = re.sub(r"\s+", " ", (text or "").strip())
    if len(t) <= limit:
        return t
    return t[: limit - 1].rstrip() + "…"


def _normalize_front(text: str) -> str:
    t = re.sub(r"^(问[：:]\s*|Q[：:]\s*)", "", (text or "").strip(), flags=re.I)
    t = re.sub(r'^[\s"\'「『""''`]+', "", t)
    t = re.sub(r'[\s"\'」』""''`]+$', "", t)
    return t.strip()


def _source_hash(text: str, *, style_fingerprint: str = "") -> str:
    payload = f"{_QA_PROMPT_VERSION}\n{style_fingerprint or ''}\n{text or ''}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _cache_path(wiki_name: str, section_id: str) -> Path:
    stem = Path(wiki_name).stem or "doc"
    safe_sec = re.sub(r"[^\w\u4e00-\u9fff-]+", "_", section_id)[:80] or "sec"
    root = settings.resolved_data_dir / "outputs" / _QA_CACHE_DIR
    root.mkdir(parents=True, exist_ok=True)
    return root / f"{stem}.{safe_sec}.json"


def _read_cache(path: Path, expected_hash: str) -> list[dict[str, str]] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(data, dict) or data.get("source_sha256") != expected_hash:
        return None
    cards = data.get("cards")
    if not isinstance(cards, list):
        return None
    out: list[dict[str, str]] = []
    for item in cards:
        if not isinstance(item, dict):
            continue
        q = str(item.get("question", "")).strip()
        a = str(item.get("answer", "")).strip()
        if len(q) >= 10 and len(a) >= _MIN_ANSWER_CHARS:
            row: dict[str, str] = {"question": q, "answer": a}
            m = sanitize_mermaid(str(item.get("visual_mermaid", "")))
            if m:
                row["visual_mermaid"] = m
            cap = str(item.get("visual_caption", "")).strip()
            if cap:
                row["visual_caption"] = cap[:120]
            img_p = str(item.get("image_prompt", "")).strip()
            if img_p:
                row["image_prompt"] = img_p[:200]
            out.append(row)
    return out or None


def _write_cache(path: Path, *, source_hash: str, provider: str, cards: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"source_sha256": source_hash, "provider": provider, "cards": cards},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    notify_path_written(path)


def _clip_answer(text: str, limit: int) -> str:
    """保留段落换行，便于移动端扫读。"""
    t = (text or "").strip()
    if len(t) <= limit:
        return t
    cut = t[:limit].rstrip()
    if "\n" in cut:
        cut = cut.rsplit("\n", 1)[0].rstrip()
    return cut + "…"


def section_has_qa_cache(
    wiki_name: str,
    section_id: str,
    section_text: str,
    *,
    style_fingerprint: str = "",
) -> bool:
    """磁盘已有 QA 缓存则 LLM 预算可让给未缓存节。"""
    body = (section_text or "").strip()
    if len(body) < 120:
        return True
    return _read_cache(_cache_path(wiki_name, section_id), _source_hash(body, style_fingerprint=style_fingerprint)) is not None


def _coerce_qa_cards(parsed: dict[str, Any], *, max_cards: int) -> list[dict[str, str]]:
    raw = parsed.get("cards")
    if raw is None and "question" in parsed:
        raw = [parsed]
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for item in raw[: max(1, max_cards)]:
        if not isinstance(item, dict):
            continue
        q = str(item.get("question", "")).strip()
        a = str(item.get("answer", "")).strip()
        if len(q) < 10 or len(a) < _MIN_ANSWER_CHARS:
            continue
        row: dict[str, str] = {
            "question": _clip(_normalize_front(q), _MAX_FRONT),
            "answer": _clip_answer(a, _MAX_BACK),
        }
        m = sanitize_mermaid(str(item.get("visual_mermaid", "")))
        if m:
            row["visual_mermaid"] = m
        cap = str(item.get("visual_caption", "")).strip()
        if cap:
            row["visual_caption"] = cap[:120]
        img_p = str(item.get("image_prompt", "")).strip()
        if img_p:
            row["image_prompt"] = img_p[:200]
        out.append(row)
    return out


_QA_SYSTEM = (
    "你是知识闪卡出题助手。根据章节正文生成「块级」问答卡——每张卡覆盖一整块要义，"
    "检验读者是否真正理解，而不是背定义。\n"
    "问题：用好奇心或反直觉角度提问（避免「这一块在讲什么」「什么是 X」式空泛题）。\n"
    "答案结构（4～8 句、≥120 字，分段便于扫读）：\n"
    "1) 一句钩子点出为什么值得懂；\n"
    "2) 讲清核心机制/概念及彼此关系；\n"
    "3) 必须含生活类比或 1 个具体例子/场景；\n"
    "4) 结尾用「💡 Aha：…」给一句可带走的顿悟。\n"
    "只依据给定正文，不编造；口语化、好记忆，禁止大段摘抄原文或教科书定义腔。\n"
    "禁止：只写一句定义、枚举碎题、无例子的抽象堆砌。\n"
    "每张卡可选：\n"
    "- visual_mermaid：简短 Mermaid（mindmap/flowchart LR，≤8 节点）；\n"
    "- visual_caption：读者应从画面理解什么（≤30 字）；\n"
    "- image_prompt：文生图描述（≤100 字），优先生活类比、场景、因果过程。\n"
    "只输出一个 JSON 对象，不要 markdown 代码块。"
    '格式：{"cards":[{"question":"...","answer":"...","visual_mermaid":"...","visual_caption":"...","image_prompt":"..."}]}'
    "若正文过短或全是噪声，返回 {\"cards\":[]}。"
)


def _looks_like_excerpt(answer: str, source: str) -> bool:
    """答案是否像原文摘抄（连续长片段与正文高度重合）。"""
    a = re.sub(r"\s+", "", (answer or "")[:400])
    s = re.sub(r"\s+", "", (source or "")[:6000])
    if len(a) < 100 or len(s) < 100:
        return False
    window = 48
    hits = 0
    for i in range(0, min(len(a) - window, 240), 24):
        if a[i : i + window] in s:
            hits += 1
            if hits >= 2:
                return True
    return False


def _card_needs_retry(cards: list[dict[str, str]], source: str) -> bool:
    if not cards:
        return True
    row = cards[0]
    answer = str(row.get("answer", "")).strip()
    question = str(row.get("question", "")).strip()
    if len(answer) < _MIN_ANSWER_CHARS:
        return True
    if _looks_like_excerpt(answer, source):
        return True
    bland = ("这一块在讲什么", "关键概念与联系", "什么是", "请简述")
    if any(p in question for p in bland):
        return True
    if "💡" not in answer and "Aha" not in answer and "就像" not in answer and "例如" not in answer:
        if len(re.findall(r"[。！？\n]", answer)) < 3:
            return True
    return False


def _qa_card_limit(section_text: str, *, max_cards: int | None = None) -> int:
    base = max(1, int(max_cards if max_cards is not None else settings.flashcard_qa_per_section))
    n = len((section_text or "").strip())
    if n >= 8000:
        return min(base + 2, 4)
    if n >= 4000:
        return min(base + 1, 3)
    return base


def generate_qa_cards_with_llm(
    *,
    section_title: str,
    section_text: str,
    doc_title: str,
    topics: list[str],
    max_cards: int | None = None,
    style_hint: str = "",
) -> tuple[list[dict[str, str]], Literal["ark", "cloud"]]:
    limit = _qa_card_limit(section_text, max_cards=max_cards)
    body = (section_text or "").strip()
    if len(body) < 120:
        return [], "ark"
    snippet = body[: settings.flashcard_section_input_chars]
    topic_hint = "、".join(topics[:6]) if topics else "未分类"
    style_block = ""
    if (style_hint or "").strip():
        style_block = f"\n用户讲法偏好（请尽量贴合）：\n{style_hint.strip()}\n"
    card_phrase = f"{limit} 张" if limit > 1 else "1 张"
    user = (
        f"文档：{doc_title}\n"
        f"章节标题：{section_title or '正文'}\n"
        f"主题标签（参考）：{topic_hint}\n"
        f"{style_block}"
        f"请为本块生成 {card_phrase}块级问答闪卡（每张覆盖一个完整知识点，不要碎题；"
        f"若 {limit} 张则各卡角度应不同）。\n\n"
        f"章节正文：\n{snippet}"
    )
    client, model, provider = _openai_client_and_model()

    def _call_llm(extra_user: str = "", temperature: float = 0.42) -> list[dict[str, str]]:
        messages = [
            {"role": "system", "content": _QA_SYSTEM},
            {"role": "user", "content": user + extra_user},
        ]
        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
        )
        content = resp.choices[0].message.content or "{}"
        parsed = _parse_llm_json_object(content)
        return _coerce_qa_cards(parsed, max_cards=limit)

    cards = _call_llm()
    if _card_needs_retry(cards, body):
        retry_hint = (
            "\n\n【二次要求】上次输出不够易懂。请：用反直觉或场景化问题；"
            "答案必须含生活类比或具体例子；结尾加「💡 Aha：…」；不要摘抄原文。"
        )
        retry_cards = _call_llm(extra_user=retry_hint, temperature=0.48)
        if retry_cards and not _card_needs_retry(retry_cards, body):
            cards = retry_cards
        elif retry_cards and not cards:
            cards = retry_cards
    return cards, provider


_REGEN_SYSTEM = (
    "你是知识闪卡改写助手。用户觉得当前闪卡不够易懂，需要你按指定方向重写。"
    "写好理解、好记忆的块级表述（覆盖完整知识点，不是碎句摘抄）；"
    "问题检验是否理解这一块，答案 4～8 句、不少于 120 字，只依据给定正文。\n"
    "可选字段：visual_mermaid（简短 Mermaid）、visual_caption（≤30 字）、image_prompt（文生图描述，≤100 字）。\n"
    "只输出一个 JSON 对象，不要 markdown 代码块。"
    '格式：{"question":"...","answer":"...","visual_mermaid":"...","visual_caption":"...","image_prompt":"..."}'
)


def regenerate_card_with_llm(
    *,
    doc_title: str,
    section_title: str,
    section_text: str,
    topics: list[str],
    old_front: str,
    old_back: str,
    direction: str,
    note_hint: str = "",
) -> tuple[dict[str, str], Literal["ark", "cloud"]]:
    body = (section_text or "").strip()
    if len(body) < 24:
        raise ValueError("出处正文过短")
    snippet = body[: settings.flashcard_section_input_chars]
    topic_hint = "、".join(topics[:6]) if topics else "未分类"
    note_block = f"\n用户笔记（可参考）：{note_hint}\n" if note_hint.strip() else ""
    user = (
        f"文档：{doc_title}\n"
        f"章节：{section_title or '正文'}\n"
        f"主题标签：{topic_hint}\n"
        f"改写方向：{direction.strip()}\n"
        f"当前问题：{old_front.strip() or '（无）'}\n"
        f"当前答案：{old_back.strip() or '（无）'}\n"
        f"{note_block}\n"
        f"章节正文（依据）：\n{snippet}\n\n"
        "请输出 1 张重写后的问答闪卡。"
    )
    client, model, provider = _openai_client_and_model()
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _REGEN_SYSTEM},
            {"role": "user", "content": user},
        ],
        temperature=0.45,
    )
    content = resp.choices[0].message.content or "{}"
    parsed = _parse_llm_json_object(content)
    cards = _coerce_qa_cards(parsed, max_cards=1)
    if not cards:
        raise ValueError("模型未返回有效闪卡")
    row = cards[0]
    return {
        "question": row["question"],
        "answer": row["answer"],
        **{k: row[k] for k in ("visual_mermaid", "visual_caption", "image_prompt") if k in row},
    }, provider


def _reserve_llm_budget(llm_budget: list[int], budget_lock: threading.Lock | None) -> bool:
    if budget_lock is not None:
        with budget_lock:
            if llm_budget[0] <= 0:
                return False
            llm_budget[0] -= 1
            return True
    if llm_budget[0] <= 0:
        return False
    llm_budget[0] -= 1
    return True


def qa_cards_for_section(
    *,
    wiki_name: str,
    section_id: str,
    section_title: str,
    section_text: str,
    topics: list[str],
    llm_budget: list[int],
    budget_lock: threading.Lock | None = None,
    style_hint: str = "",
    style_fingerprint: str = "",
) -> list[dict[str, str]]:
    """
    优先读磁盘缓存；在预算内调用 LLM；失败或未配置时返回空列表（由上层回退模板卡）。
    llm_budget: 单元素列表，调用前递减，用于限制单次 sync 的 LLM 次数。
    """
    if not settings.flashcard_llm_enabled:
        return []
    body = (section_text or "").strip()
    if len(body) < 120:
        return []
    fp = (style_fingerprint or "").strip()
    src_hash = _source_hash(body, style_fingerprint=fp)
    cache = _cache_path(wiki_name, section_id)
    cached = _read_cache(cache, src_hash)
    if cached is not None:
        return cached[: _qa_card_limit(body)]

    if not _reserve_llm_budget(llm_budget, budget_lock):
        return []
    try:
        cards, provider = generate_qa_cards_with_llm(
            section_title=section_title,
            section_text=body,
            doc_title=wiki_name,
            topics=topics,
            max_cards=_qa_card_limit(body),
            style_hint=style_hint,
        )
        if cards:
            _write_cache(cache, source_hash=src_hash, provider=provider, cards=cards)
        return cards
    except ExtractionNotConfiguredError:
        return []
    except Exception as exc:  # noqa: BLE001
        logger.warning("QA flashcard LLM failed wiki=%s sec=%s: %s", wiki_name, section_id, exc)
        return []


def qa_cards_for_summary(
    *,
    record_id: int,
    file_name: str,
    summary: str,
    topics: list[str],
    llm_budget: list[int],
    budget_lock: threading.Lock | None = None,
    style_hint: str = "",
    style_fingerprint: str = "",
) -> list[dict[str, str]]:
    if not settings.flashcard_llm_enabled:
        return []
    body = (summary or "").strip()
    if len(body) < 48:
        return []
    cache = settings.resolved_data_dir / "outputs" / _QA_CACHE_DIR / f"summary.record{record_id}.json"
    fp = (style_fingerprint or "").strip()
    src_hash = _source_hash(body, style_fingerprint=fp)
    cached = _read_cache(cache, src_hash)
    if cached is not None:
        return cached[:1]

    if not _reserve_llm_budget(llm_budget, budget_lock):
        return []
    try:
        cards, provider = generate_qa_cards_with_llm(
            section_title=f"全文摘要：{file_name}",
            section_text=body,
            doc_title=file_name,
            topics=topics,
            max_cards=1,
            style_hint=style_hint,
        )
        if cards:
            _write_cache(cache, source_hash=src_hash, provider=provider, cards=cards[:1])
        return cards[:1]
    except ExtractionNotConfiguredError:
        return []
    except Exception as exc:  # noqa: BLE001
        logger.warning("QA summary flashcard failed record=%s: %s", record_id, exc)
        return []


UNDERSTANDING_MODE_LABELS: dict[str, str] = {
    "explain": "拆解要点",
    "analogy": "生活类比",
    "steps": "分步骤",
    "eli5": "零基础",
    "compare": "对比说明",
}

_UNDERSTAND_MODE_DIRECTIONS: dict[str, str] = {
    "analogy": "用生活化类比重新讲解，先给一句「就像…」的比喻，再展开说明。",
    "steps": "按 1→2→3 分步骤讲清因果与逻辑，适合过程型知识。",
    "eli5": "假设读者零基础，避免术语堆砌，用短句和例子讲明白。",
    "compare": "与相近概念或常见误解对照，说明「是什么 / 不是什么」。",
}

_UNDERSTAND_SYSTEM = (
    "你是知识闪卡「易懂化」助手。用户看不懂当前闪卡，需要你换一种更好理解的讲法。\n"
    "只依据给定出处正文，不编造；语言口语、好扫读。\n"
    "只输出一个 JSON 对象，不要 markdown 代码块。\n"
    '格式：{"question":"...","answer":"...","analogy":"一句话类比（可选）",'
    '"bullets":["要点1","要点2"],"one_liner":"一句话总结",'
    '"visual_mermaid":"可选简短 Mermaid"}'
)

_EXPLAIN_SYSTEM = (
    "你是知识闪卡辅读助手。用户已看到问答卡但仍不懂，请补充解释，不要重复原文摘抄。\n"
    "只依据给定出处正文；输出 JSON，不要 markdown 代码块。\n"
    '格式：{"summary":"2-3句概括","analogy":"生活类比","key_points":["要点1","要点2","要点3"],'
    '"why_hard":"为什么可能难懂（1句）","remember_tip":"记忆/理解技巧（1句）"}'
)


def _coerce_understanding(parsed: dict[str, Any], *, mode: str) -> dict[str, Any]:
    if mode == "explain":
        summary = str(parsed.get("summary", "")).strip()
        if len(summary) < 16:
            raise ValueError("模型未返回有效解释")
        out: dict[str, Any] = {
            "mode": mode,
            "mode_label": UNDERSTANDING_MODE_LABELS.get(mode, mode),
            "summary": _clip_answer(summary, 600),
        }
        analogy = str(parsed.get("analogy", "")).strip()
        if analogy:
            out["analogy"] = _clip(analogy, 240)
        raw_pts = parsed.get("key_points")
        if isinstance(raw_pts, list):
            pts = [str(p).strip() for p in raw_pts if str(p).strip()]
            if pts:
                out["key_points"] = [_clip(p, 160) for p in pts[:6]]
        why = str(parsed.get("why_hard", "")).strip()
        if why:
            out["why_hard"] = _clip(why, 180)
        tip = str(parsed.get("remember_tip", "")).strip()
        if tip:
            out["remember_tip"] = _clip(tip, 180)
        return out

    q = str(parsed.get("question", "")).strip()
    a = str(parsed.get("answer", "")).strip()
    if len(q) < 8 or len(a) < 48:
        raise ValueError("模型未返回有效讲法")
    out = {
        "mode": mode,
        "mode_label": UNDERSTANDING_MODE_LABELS.get(mode, mode),
        "question": _clip(_normalize_front(q), _MAX_FRONT),
        "answer": _clip_answer(a, _MAX_BACK),
    }
    analogy = str(parsed.get("analogy", "")).strip()
    if analogy:
        out["analogy"] = _clip(analogy, 240)
    one = str(parsed.get("one_liner", "")).strip()
    if one:
        out["one_liner"] = _clip(one, 160)
    raw_bullets = parsed.get("bullets")
    if isinstance(raw_bullets, list):
        bullets = [str(b).strip() for b in raw_bullets if str(b).strip()]
        if bullets:
            out["bullets"] = [_clip(b, 160) for b in bullets[:8]]
    m = sanitize_mermaid(str(parsed.get("visual_mermaid", "")))
    if m:
        out["visual_mermaid"] = m
    return out


def generate_understanding_with_llm(
    *,
    mode: str,
    doc_title: str,
    section_title: str,
    section_text: str,
    topics: list[str],
    old_front: str,
    old_back: str,
    note_hint: str = "",
) -> tuple[dict[str, Any], Literal["ark", "cloud"]]:
    mode = (mode or "explain").strip().lower()
    if mode not in UNDERSTANDING_MODE_LABELS:
        raise ValueError(f"不支持的理解模式: {mode}")
    body = (section_text or "").strip()
    if len(body) < 24:
        raise ValueError("出处正文过短")
    snippet = body[: settings.flashcard_section_input_chars]
    topic_hint = "、".join(topics[:6]) if topics else "未分类"
    note_block = f"\n用户笔记：{note_hint}\n" if note_hint.strip() else ""

    if mode == "explain":
        user = (
            f"文档：{doc_title}\n章节：{section_title or '正文'}\n主题：{topic_hint}\n"
            f"当前问题：{old_front.strip() or '（无）'}\n"
            f"当前答案：{old_back.strip() or '（无）'}\n{note_block}\n"
            f"章节正文：\n{snippet}\n\n请补充易懂解释，帮助用户真正理解。"
        )
        system = _EXPLAIN_SYSTEM
        temperature = 0.4
    else:
        direction = _UNDERSTAND_MODE_DIRECTIONS.get(mode, "更易懂地讲")
        user = (
            f"文档：{doc_title}\n章节：{section_title or '正文'}\n主题：{topic_hint}\n"
            f"理解模式：{UNDERSTANDING_MODE_LABELS[mode]} — {direction}\n"
            f"当前问题：{old_front.strip() or '（无）'}\n"
            f"当前答案：{old_back.strip() or '（无）'}\n{note_block}\n"
            f"章节正文：\n{snippet}\n\n请输出 1 张更易懂的问答闪卡。"
        )
        system = _UNDERSTAND_SYSTEM
        temperature = 0.45

    client, model, provider = _openai_client_and_model()
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temperature,
    )
    content = resp.choices[0].message.content or "{}"
    parsed = _parse_llm_json_object(content)
    return _coerce_understanding(parsed, mode=mode), provider


def direction_for_understanding_mode(mode: str) -> str:
    mode = (mode or "").strip().lower()
    label = UNDERSTANDING_MODE_LABELS.get(mode, "")
    hint = _UNDERSTAND_MODE_DIRECTIONS.get(mode, "")
    if label and hint:
        return f"「{label}」{hint}"
    if label:
        return f"用「{label}」的方式重写，更简单易懂。"
    return "用更简单、好理解、好记忆的方式讲解。"
