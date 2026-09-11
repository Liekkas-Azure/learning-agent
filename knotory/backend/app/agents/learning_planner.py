"""LLM Planner：把 Student State、Memory 与图谱约束转成可执行学习路径。"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger("knotory.learning_planner")
_ALLOWED_HREFS = {"/", "/review", "/feynman", "/exam", "/chat", "/library"}


def refine_plan_with_llm(
    *,
    goal: str,
    diagnosis: dict[str, Any],
    base_plan: dict[str, Any],
    days: int,
) -> dict[str, Any]:
    """LLM 规划失败时返回启发式计划，保证闭环可用。"""
    try:
        from app.llm import _openai_client_and_model, _parse_llm_json_object  # noqa: PLC0415

        client, model, provider = _openai_client_and_model()
        payload = {
            "goal": goal,
            "days": days,
            "weak_concepts": (diagnosis.get("weak_concepts") or [])[:8],
            "prerequisite_blockers": (
                diagnosis.get("prerequisite_blockers") or []
            )[:8],
            "profile": diagnosis.get("profile") or {},
            "recent_memory": (diagnosis.get("memory_episodes") or [])[:5],
            "due_count": diagnosis.get("due_count") or 0,
            "base_steps": (base_plan.get("steps") or [])[:days],
        }
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是个性化学习 Planner。按先修关系、掌握概率、典型错误、"
                        "用户偏好和历史经验生成可执行计划。只输出 JSON："
                        '{"steps":[{"day":1,"title":"","wiki_file_name":"","focus_topic":"",'
                        '"tasks":[""],"why":"","actions":[{"label":"","href":"/review"}]}],'
                        '"strategy_summary":""}。'
                        "href 只能是 /、/review、/feynman、/exam、/chat、/library。"
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(payload, ensure_ascii=False)[:20_000],
                },
            ],
            temperature=0.2,
            max_tokens=1800,
        )
        parsed = _parse_llm_json_object(
            response.choices[0].message.content or "{}"
        )
        steps = _validate_steps(parsed.get("steps"), days=days)
        if not steps:
            return base_plan
        return {
            **base_plan,
            "steps": steps,
            "strategy_summary": str(parsed.get("strategy_summary") or "")[:500],
            "planner_provider": provider,
            "planner_mode": "llm",
        }
    except Exception as exc:  # noqa: BLE001
        logger.info("LLM planner unavailable, using deterministic plan: %s", exc)
        return {**base_plan, "planner_mode": "deterministic"}


def _validate_steps(raw: Any, *, days: int) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    steps: list[dict[str, Any]] = []
    for index, item in enumerate(raw[:days], start=1):
        if not isinstance(item, dict):
            continue
        tasks_raw = item.get("tasks")
        tasks = (
            [str(task).strip()[:180] for task in tasks_raw[:6] if str(task).strip()]
            if isinstance(tasks_raw, list)
            else []
        )
        if not tasks:
            continue
        actions = []
        actions_raw = item.get("actions")
        if isinstance(actions_raw, list):
            for action in actions_raw[:4]:
                if not isinstance(action, dict):
                    continue
                href = str(action.get("href") or "")
                root = "/" + href.strip("/").split("/", 1)[0] if href != "/" else "/"
                if root not in _ALLOWED_HREFS:
                    continue
                actions.append(
                    {
                        "label": str(action.get("label") or "开始")[:40],
                        "href": href[:500],
                    }
                )
        steps.append(
            {
                "day": index,
                "title": str(item.get("title") or f"第 {index} 天")[:120],
                "wiki_file_name": str(item.get("wiki_file_name") or "")[:255],
                "focus_topic": str(item.get("focus_topic") or "")[:120],
                "tasks": tasks,
                "why": str(item.get("why") or "")[:500],
                "actions": actions,
            }
        )
    return steps
