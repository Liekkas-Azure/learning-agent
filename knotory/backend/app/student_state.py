"""实时 Student State：BKT 概念掌握度 + LLM 语义诊断摘要。"""

from __future__ import annotations

import json
import logging
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session, select

from app.models import (
    ConceptMastery,
    KnowledgeFlashcard,
    StudentObservation,
    UserLearningProfile,
)
from app.paths import tenant_data_dir
from app.corpus_store import notify_path_written
from app.storage import engine
from app.storage import WIKI_DIR
from app.tenant import current_user_id

logger = logging.getLogger("knotory.student_state")

# BKT 默认参数（可后续按概念个性化）
_P_TRANSIT = 0.12
_P_SLIP = 0.08
_P_GUESS = 0.22
_P_INIT = 0.2


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def concept_key_from_label(label: str) -> str:
    raw = (label or "").strip().lower()
    raw = re.sub(r"\s+", " ", raw)
    return raw[:240] or "未分类"


def _bkt_update(p_know: float, *, correct: bool) -> float:
    """经典 BKT 单步后验更新。"""
    p = max(0.01, min(0.99, float(p_know)))
    if correct:
        numer = p * (1.0 - _P_SLIP)
        denom = numer + (1.0 - p) * _P_GUESS
    else:
        numer = p * _P_SLIP
        denom = numer + (1.0 - p) * (1.0 - _P_GUESS)
    p_post = numer / max(denom, 1e-9)
    p_next = p_post + (1.0 - p_post) * _P_TRANSIT
    return max(0.01, min(0.99, p_next))


def _fused_probability(bkt: float, dkt: float, observations: int) -> tuple[float, float]:
    """证据较少时偏 BKT，时序积累后提高 DKT 权重。"""
    confidence = min(1.0, max(0.0, observations / 12.0))
    dkt_weight = 0.2 + 0.35 * confidence
    fused = (1.0 - dkt_weight) * bkt + dkt_weight * dkt
    return max(0.01, min(0.99, fused)), confidence


def observe_concept(
    concept_label: str,
    *,
    correct: bool | None,
    error_patterns: list[str] | None = None,
    source_wiki: str = "",
    evidence_weight: float = 1.0,
    source: str = "review",
    semantic_score: float | None = None,
    dwell_ms: int = 0,
    action: str = "",
    payload: dict[str, Any] | None = None,
) -> ConceptMastery:
    """写入一次多源观测（答题 / 费曼 / 行为推断）。"""
    owner = current_user_id()
    key = concept_key_from_label(concept_label)
    label = (concept_label or key).strip()[:256]
    weight = max(0.25, min(2.0, float(evidence_weight)))

    with Session(engine) as session:
        row = session.exec(
            select(ConceptMastery).where(
                ConceptMastery.user_id == owner,
                ConceptMastery.concept_key == key,
            )
        ).first()
        if row is None:
            row = ConceptMastery(
                user_id=owner,
                concept_key=key,
                concept_label=label,
                p_know=_P_INIT,
                source_wiki=(source_wiki or "")[:512],
            )

        bkt = float(row.bkt_probability or row.p_know)
        dkt = float(row.dkt_probability or row.p_know)
        if correct is not None:
            whole_steps = int(weight)
            for _ in range(whole_steps):
                bkt = _bkt_update(bkt, correct=correct)
            fraction = weight - whole_steps
            if fraction > 0 or whole_steps == 0:
                fraction = fraction if whole_steps > 0 else weight
                target = _bkt_update(bkt, correct=correct)
                bkt += fraction * (target - bkt)
        row.observations = int(row.observations) + 1
        fused, confidence = _fused_probability(bkt, dkt, row.observations)
        row.bkt_probability = bkt
        row.dkt_probability = dkt
        row.p_know = fused
        row.confidence = confidence
        row.last_correct = correct
        row.concept_label = label or row.concept_label
        if source_wiki:
            row.source_wiki = source_wiki[:512]
        if error_patterns:
            prev = []
            try:
                prev = json.loads(row.error_patterns_json or "[]")
            except json.JSONDecodeError:
                prev = []
            if not isinstance(prev, list):
                prev = []
            merged = [str(x).strip()[:80] for x in (prev + list(error_patterns)) if str(x).strip()]
            # 去重保序，截断
            seen: set[str] = set()
            uniq: list[str] = []
            for item in merged:
                if item in seen:
                    continue
                seen.add(item)
                uniq.append(item)
            row.error_patterns_json = json.dumps(uniq[-12:], ensure_ascii=False)
        row.updated_at = _utcnow()
        session.add(row)
        session.add(
            StudentObservation(
                user_id=owner,
                concept_key=key,
                source=(source or "review")[:64],
                correct=correct,
                semantic_score=semantic_score,
                dwell_ms=max(0, int(dwell_ms)),
                action=(action or "")[:64],
                evidence_weight=weight,
                payload_json=json.dumps(payload or {}, ensure_ascii=False)[:4000],
                created_at=_utcnow(),
            )
        )
        session.commit()
        session.refresh(row)
        result = row

    if correct is not None:
        try:
            from app.dkt import train_and_predict  # noqa: PLC0415

            dkt_result = train_and_predict(key)
        except Exception as exc:  # noqa: BLE001
            logger.warning("DKT update failed for %s: %s", key, exc)
            dkt_result = None
        if dkt_result is not None:
            with Session(engine) as session:
                persisted = session.exec(
                    select(ConceptMastery).where(
                        ConceptMastery.user_id == owner,
                        ConceptMastery.concept_key == key,
                    )
                ).first()
                if persisted is not None:
                    persisted.dkt_probability = float(dkt_result["probability"])
                    persisted.dkt_model = str(dkt_result["model"])
                    persisted.dkt_sequence_length = int(
                        dkt_result["sequence_length"]
                    )
                    persisted.dkt_loss = dkt_result.get("loss")
                    persisted.p_know, persisted.confidence = _fused_probability(
                        float(persisted.bkt_probability),
                        float(persisted.dkt_probability),
                        int(persisted.observations),
                    )
                    persisted.updated_at = _utcnow()
                    session.add(persisted)
                    session.commit()
                    session.refresh(persisted)
                    result = persisted

    _update_learning_profile(
        action=action or source,
        concept_label=label,
        dwell_ms=dwell_ms,
    )
    _index_student_memory(result)
    return result


def observe_flashcard_review(card: KnowledgeFlashcard, rating: int) -> ConceptMastery | None:
    """SRS 评分 → BKT：again/hard 为错，good/easy 为对。"""
    topic = (card.topic or "").strip() or "未分类"
    correct = rating >= 2
    weight = 1.0 if rating in (0, 2) else (1.4 if rating == 3 else 0.7)
    patterns = ["回忆失败 / 需重学"] if rating == 0 else (["吃力但仍有印象"] if rating == 1 else None)
    return observe_concept(
        topic,
        correct=correct,
        error_patterns=patterns,
        source_wiki=card.wiki_file_name or "",
        evidence_weight=weight,
        source="review",
        semantic_score=rating / 3.0,
        action="srs_review",
        payload={"rating": rating, "flashcard_id": card.id},
    )


def observe_feynman_result(
    card: KnowledgeFlashcard,
    *,
    passed: bool,
    score: int,
    gaps: list[str],
) -> ConceptMastery | None:
    """费曼 LLM 诊断 → BKT（语义诊断权重更高）。"""
    topic = (card.topic or "").strip() or "未分类"
    weight = 1.6 if score >= 78 else (1.2 if passed else 1.0)
    return observe_concept(
        topic,
        correct=passed,
        error_patterns=gaps[:6] if gaps else None,
        source_wiki=card.wiki_file_name or "",
        evidence_weight=weight,
        source="feynman",
        semantic_score=max(0.0, min(1.0, score / 100.0)),
        action="feynman",
        payload={"passed": passed, "score": score, "gaps": gaps[:6], "flashcard_id": card.id},
    )


def observe_behavior(
    card: KnowledgeFlashcard,
    *,
    action: str,
    dwell_ms: int = 0,
) -> ConceptMastery:
    """Feed 行为作为低权重证据，不把“喜欢”直接等同于“掌握”。"""
    positive = action in {"save", "like", "open_source"}
    negative = action in {"skip", "dislike"}
    correct: bool | None = True if positive else (False if negative else None)
    return observe_concept(
        card.topic or "未分类",
        correct=correct,
        source_wiki=card.wiki_file_name or "",
        evidence_weight=0.35,
        source="behavior",
        dwell_ms=dwell_ms,
        action=action,
        payload={"flashcard_id": card.id},
    )


def _update_learning_profile(*, action: str, concept_label: str, dwell_ms: int) -> None:
    owner = current_user_id()
    with Session(engine) as session:
        row = session.get(UserLearningProfile, owner)
        if row is None:
            row = UserLearningProfile(user_id=owner)
        try:
            actions = json.loads(row.preferred_actions_json or "{}")
        except json.JSONDecodeError:
            actions = {}
        try:
            topics = json.loads(row.preferred_topics_json or "{}")
        except json.JSONDecodeError:
            topics = {}
        if not isinstance(actions, dict):
            actions = {}
        if not isinstance(topics, dict):
            topics = {}
        if action:
            actions[action] = int(actions.get(action, 0)) + 1
        if concept_label:
            topics[concept_label] = int(topics.get(concept_label, 0)) + 1
        old_n = int(row.total_events)
        if dwell_ms > 0:
            row.average_dwell_ms = (
                float(row.average_dwell_ms) * old_n + max(0, int(dwell_ms))
            ) / max(1, old_n + 1)
        row.total_events = old_n + 1
        row.preferred_actions_json = json.dumps(actions, ensure_ascii=False)
        row.preferred_topics_json = json.dumps(topics, ensure_ascii=False)
        row.updated_at = _utcnow()
        session.add(row)
        session.commit()


def get_learning_profile() -> dict[str, Any]:
    owner = current_user_id()
    with Session(engine) as session:
        row = session.get(UserLearningProfile, owner)
    if row is None:
        return {"total_events": 0, "preferred_actions": [], "preferred_topics": []}

    def _top(raw: str) -> list[dict[str, Any]]:
        try:
            data = json.loads(raw or "{}")
        except json.JSONDecodeError:
            data = {}
        if not isinstance(data, dict):
            return []
        return [
            {"name": name, "count": count}
            for name, count in Counter(data).most_common(8)
        ]

    return {
        "total_events": row.total_events,
        "average_dwell_ms": round(float(row.average_dwell_ms), 1),
        "preferred_actions": _top(row.preferred_actions_json),
        "preferred_topics": _top(row.preferred_topics_json),
        "state_summary": row.state_summary,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _index_student_memory(mastery: ConceptMastery) -> None:
    """把结构化错误模式和画像写入向量记忆，供 RAG/Agent 再消费。"""
    try:
        from app.vector_store import upsert_document_chunks  # noqa: PLC0415

        patterns = json.loads(mastery.error_patterns_json or "[]")
        if not isinstance(patterns, list):
            patterns = []
        concept_text = (
            f"知识点：{mastery.concept_label or mastery.concept_key}\n"
            f"融合掌握概率：{float(mastery.p_know):.3f}\n"
            f"BKT：{float(mastery.bkt_probability):.3f}\n"
            f"DKT：{float(mastery.dkt_probability):.3f}\n"
            f"典型错误：{'；'.join(str(item) for item in patterns) or '暂无'}\n"
            f"证据次数：{mastery.observations}"
        )
        upsert_document_chunks(
            source_kind="student_state",
            source_ref=f"concept:{mastery.concept_key}",
            title=f"Student State · {mastery.concept_label or mastery.concept_key}",
            text=concept_text,
        )
        profile = get_learning_profile()
        upsert_document_chunks(
            source_kind="profile",
            source_ref="current",
            title="User Learning Profile",
            text=json.dumps(profile, ensure_ascii=False),
        )
        _write_student_state_wiki()
    except Exception as exc:  # noqa: BLE001
        logger.info("student memory vector index skipped: %s", exc)


def _write_student_state_wiki() -> None:
    """维护可读、可导出的 Student State / 用户画像 Wiki 页面。"""
    concepts = list_concept_mastery(limit=30)
    profile = get_learning_profile()
    lines = [
        "---",
        "title: Student State",
        "tags: [student-state, profile, bkt, dkt]",
        "---",
        "",
        "# Student State",
        "",
        "## 用户画像",
        "",
        f"- 累计学习事件：{profile.get('total_events', 0)}",
        f"- 平均停留时长：{profile.get('average_dwell_ms', 0)} ms",
        "- 偏好 Action："
        + "、".join(
            str(item.get("name"))
            for item in profile.get("preferred_actions", [])[:6]
        ),
        "- 偏好主题："
        + "、".join(
            str(item.get("name"))
            for item in profile.get("preferred_topics", [])[:8]
        ),
        "",
        "## 知识掌握与典型错误",
        "",
    ]
    for item in concepts:
        lines.extend(
            [
                f"### {item['concept_label']}",
                f"- 融合掌握度：{item['mastery_pct']}%",
                f"- BKT：{round(float(item['bkt_probability']) * 100)}%",
                f"- DKT：{round(float(item['dkt_probability']) * 100)}%"
                + (
                    f"（{item.get('dkt_model')}，序列 {item.get('dkt_sequence_length')}）"
                    if item.get("dkt_model")
                    else ""
                ),
                "- 典型错误："
                + ("；".join(item.get("error_patterns") or []) or "暂无"),
                "",
            ]
        )
    path = tenant_data_dir() / WIKI_DIR / "_student_state.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    notify_path_written(path)


def list_concept_mastery(*, limit: int = 40) -> list[dict[str, Any]]:
    owner = current_user_id()
    with Session(engine) as session:
        rows = list(
            session.exec(
                select(ConceptMastery)
                .where(ConceptMastery.user_id == owner)
                .order_by(ConceptMastery.p_know.asc(), ConceptMastery.updated_at.desc())
                .limit(max(1, limit))
            )
        )
    out: list[dict[str, Any]] = []
    for row in rows:
        patterns: list[str] = []
        try:
            raw = json.loads(row.error_patterns_json or "[]")
            if isinstance(raw, list):
                patterns = [str(x) for x in raw][:8]
        except json.JSONDecodeError:
            patterns = []
        out.append(
            {
                "concept_key": row.concept_key,
                "concept_label": row.concept_label or row.concept_key,
                "p_know": round(float(row.p_know), 4),
                "bkt_probability": round(float(row.bkt_probability), 4),
                "dkt_probability": round(float(row.dkt_probability), 4),
                "dkt_model": row.dkt_model,
                "dkt_sequence_length": row.dkt_sequence_length,
                "dkt_loss": row.dkt_loss,
                "confidence": round(float(row.confidence), 4),
                "mastery_pct": round(100 * float(row.p_know)),
                "observations": row.observations,
                "last_correct": row.last_correct,
                "error_patterns": patterns,
                "source_wiki": row.source_wiki,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            }
        )
    return out


def weak_concepts(*, limit: int = 8, threshold: float = 0.55) -> list[dict[str, Any]]:
    items = list_concept_mastery(limit=80)
    weak = [c for c in items if float(c["p_know"]) < threshold]
    weak.sort(key=lambda c: (float(c["p_know"]), -int(c["observations"])))
    return weak[:limit]


def build_student_state_snapshot(*, use_llm: bool = False) -> dict[str, Any]:
    """聚合多源状态：BKT 概念 + 弱项 + 可选 LLM 语义摘要。"""
    concepts = list_concept_mastery(limit=50)
    weak = [c for c in concepts if float(c["p_know"]) < 0.55][:8]
    strong = sorted(concepts, key=lambda c: -float(c["p_know"]))[:6]
    profile = get_learning_profile()
    owner = current_user_id()
    with Session(engine) as session:
        source_rows = list(
            session.exec(
                select(StudentObservation.source).where(StudentObservation.user_id == owner)
            )
        )
    source_counts = dict(Counter(source_rows))

    summary = ""
    if use_llm and concepts:
        summary = _llm_state_summary(weak=weak, strong=strong)
    if not summary:
        if weak:
            names = "、".join(c["concept_label"] for c in weak[:4])
            summary = f"当前需优先巩固：{names}。建议走「诊断→规划→执行→评估」短闭环。"
        elif concepts:
            summary = "整体掌握较稳，可推进拓展阅读与综合练习。"
        else:
            summary = "尚无足够答题/费曼证据，先入库拆卡并完成几轮复习以初始化 Student State。"

    return {
        "summary": summary,
        "concepts": concepts[:30],
        "weak_concepts": weak,
        "strong_concepts": strong,
        "profile": profile,
        "observation_sources": source_counts,
        "concept_count": len(concepts),
        "updated_at": _utcnow().isoformat(),
    }


def _llm_state_summary(*, weak: list[dict], strong: list[dict]) -> str:
    try:
        from app.llm import ExtractionNotConfiguredError, _openai_client_and_model  # noqa: PLC0415

        client, model, _provider = _openai_client_and_model()
        user = (
            "根据学生知识点掌握情况，用 2 句中文给出学习状态诊断（不含客套）。\n"
            f"弱项：{json.dumps(weak[:5], ensure_ascii=False)}\n"
            f"强项：{json.dumps(strong[:4], ensure_ascii=False)}"
        )
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "你是学习诊断教练，只输出简洁中文诊断。"},
                {"role": "user", "content": user},
            ],
            temperature=0.3,
            max_tokens=180,
        )
        return (resp.choices[0].message.content or "").strip()[:400]
    except Exception as exc:  # noqa: BLE001
        logger.info("student state llm summary skipped: %s", exc)
        return ""
