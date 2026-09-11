"""费曼会话：用户用自己的话讲解知识点，LLM 诊断理解缺口。"""

from __future__ import annotations

import logging
from typing import Any

from sqlmodel import Session

from app.config import settings
from app.flashcard_regenerate import _section_context, _topics_from_card
from app.llm import ExtractionNotConfiguredError, _openai_client_and_model, _parse_llm_json_object
from app.models import FlashcardUserNote, KnowledgeFlashcard
from app.storage import engine

logger = logging.getLogger("knotory.feynman_session")

_FEYNMAN_EVAL_SYSTEM = (
    "你是费曼学习法教练。用户正在尝试用自己的话解释一个知识点。\n"
    "依据「标准答案要点」与「出处正文」判断用户讲解是否真正理解，而非背诵。\n"
    "要求：\n"
    "- 鼓励口语化、类比、因果链；不要求与原文逐字一致\n"
    "- gaps 只列用户没讲清或讲错的具体点（每条 ≤40 字）\n"
    "- passed=true 当且仅当 score>=78 且核心因果/定义无重大遗漏\n"
    "- 语气支持、具体，不说教\n"
    "只输出 JSON，不要 markdown 代码块。\n"
    '格式：{"passed":bool,"score":0-100,"coach_message":"...",'
    '"gaps":["..."],"strengths":["..."],"reference_points":["..."],'
    '"followup_prompt":"下一轮可追问的一句（可选）"}'
)


def _clip_list(items: Any, *, max_items: int = 6, max_len: int = 120) -> list[str]:
    if not isinstance(items, list):
        return []
    out: list[str] = []
    for raw in items:
        s = str(raw).strip()
        if not s:
            continue
        out.append(s[:max_len])
        if len(out) >= max_items:
            break
    return out


def _load_card(card_id: int) -> KnowledgeFlashcard:
    with Session(engine) as session:
        card = session.get(KnowledgeFlashcard, card_id)
        if card is None or not card.active:
            raise ValueError("闪卡不存在")
        return card


def build_feynman_brief(card_id: int, *, use_note: bool = True) -> dict[str, Any]:
    card = _load_card(card_id)
    section_title, section_text = _section_context(card)
    if len((section_text or "").strip()) < 24:
        raise ValueError("找不到足够出处正文，暂无法开始费曼讲解")

    note_hint = ""
    if use_note:
        with Session(engine) as session:
            note_row = session.get(FlashcardUserNote, card_id)
            if note_row and (note_row.text or "").strip():
                note_hint = note_row.text.strip()[:800]

    concept = (card.front_text or card.topic or "这个知识点").strip()
    topics = _topics_from_card(card)
    wiki = (card.wiki_file_name or "").strip()
    sec = (card.section_id or "").strip()

    return {
        "card_id": card_id,
        "concept": concept,
        "topic": card.topic or topics[0],
        "topics": topics[:6],
        "source_title": (card.source_title or section_title or wiki or "").strip(),
        "wiki_file_name": wiki,
        "section_id": sec,
        "reference_question": (card.front_text or "").strip(),
        "reference_answer_preview": (card.back_text or "").strip()[:280],
        "prompt": (
            f"请用自己的话解释：{concept}\n\n"
            "假装讲给完全不懂的朋友听，3～6 句话即可。尽量不用术语；"
            "若必须用，请先说一句「就像…」。"
        ),
        "tips": [
            "先讲「它是什么 / 解决什么问题」",
            "再说「怎么运作或为什么成立」",
            "最后举一个你自己的例子",
        ],
        "note_hint": note_hint,
    }


def evaluate_feynman_explanation(
    card_id: int,
    *,
    explanation: str,
    attempt: int = 1,
) -> dict[str, Any]:
    text = (explanation or "").strip()
    if len(text) < 12:
        raise ValueError("讲解太短，请至少写 2～3 句完整的话")
    if len(text) > 4000:
        raise ValueError("讲解过长，请控制在 4000 字以内")

    card = _load_card(card_id)
    section_title, section_text = _section_context(card)
    body = (section_text or "").strip()
    if len(body) < 24:
        raise ValueError("找不到足够出处正文，无法评估")

    snippet = body[: settings.flashcard_section_input_chars]
    topics = _topics_from_card(card)
    topic_hint = "、".join(topics[:6]) if topics else "未分类"

    user = (
        f"主题：{topic_hint}\n"
        f"章节：{section_title or '正文'}\n"
        f"标准问题：{(card.front_text or '').strip()}\n"
        f"标准答案要点：{(card.back_text or '').strip()[:1200]}\n"
        f"出处正文：\n{snippet}\n\n"
        f"第 {max(1, attempt)} 轮用户讲解：\n{text}\n\n"
        "请评估用户是否真正理解，并给出 gaps / strengths。"
    )

    client, model, provider = _openai_client_and_model()
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _FEYNMAN_EVAL_SYSTEM},
                {"role": "user", "content": user},
            ],
            temperature=0.35,
        )
        content = resp.choices[0].message.content or "{}"
        parsed = _parse_llm_json_object(content)
    except ExtractionNotConfiguredError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("feynman evaluate failed id=%s: %s", card_id, exc)
        raise ValueError("评估失败，请稍后重试") from exc

    score_raw = parsed.get("score", 0)
    try:
        score = int(score_raw)
    except (TypeError, ValueError):
        score = 0
    score = max(0, min(100, score))

    gaps = _clip_list(parsed.get("gaps"))
    strengths = _clip_list(parsed.get("strengths"))
    reference_points = _clip_list(parsed.get("reference_points"), max_items=8)

    passed = bool(parsed.get("passed")) and score >= 65
    if score >= 78 and len(gaps) <= 1:
        passed = True
    if score < 55 or len(gaps) >= 4:
        passed = False

    coach = str(parsed.get("coach_message", "")).strip() or (
        "讲得不错，核心点已经说到了。" if passed else "还有几处没讲透，对照下面的缺口再试一轮。"
    )

    result = {
        "card_id": card_id,
        "attempt": max(1, attempt),
        "passed": passed,
        "score": score,
        "coach_message": coach[:600],
        "gaps": gaps,
        "strengths": strengths,
        "reference_points": reference_points,
        "followup_prompt": str(parsed.get("followup_prompt", "")).strip()[:240],
        "provider": provider,
    }

    try:
        from app.contextual_bandit import record_reward  # noqa: PLC0415
        from app.student_state import observe_feynman_result  # noqa: PLC0415
        from app.wiki_memory import reflect_and_write  # noqa: PLC0415

        observe_feynman_result(card, passed=passed, score=score, gaps=gaps)
        record_reward("feynman", 1.0 if passed else 0.25)
        reflect_and_write(
            event="feynman_evaluate",
            payload={
                "passed": passed,
                "score": score,
                "gaps": gaps,
                "coach_message": coach[:200],
                "concept": card.topic or card.front_text[:40],
            },
            concepts=[card.topic or "未分类"],
        )
    except Exception as exc:  # noqa: BLE001
        logger.info("feynman state/memory write skipped: %s", exc)

    return result
