"""Policy：图谱约束 + Contextual Bandit + LLM Function Calling。"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.learning_tools import ACTION_SCHEMAS
from app.contextual_bandit import arm_stats, select_arm

logger = logging.getLogger("knotory.learning_policy")


def choose_teaching_action(
    *,
    diagnosis: dict[str, Any],
    plan: dict[str, Any],
    attempted_actions: list[str] | None = None,
    forced_action: str = "",
) -> dict[str, Any]:
    attempted = set(attempted_actions or [])
    weak = diagnosis.get("weak_concepts") or []
    blockers = diagnosis.get("prerequisite_blockers") or []
    due_count = int(diagnosis.get("due_count") or 0)
    focus = ""
    if blockers:
        focus = str(blockers[0].get("prerequisite_key") or "")
    elif weak:
        focus = str(weak[0].get("concept_label") or "")
    profile_action = _preferred_profile_action(diagnosis.get("profile") or {})

    if forced_action and forced_action not in attempted:
        return {
            "action": forced_action,
            "arguments": _default_arguments(forced_action, focus, plan),
            "policy": "replan_constraint",
            "context_key": focus,
        }

    candidates = _candidate_actions(
        due_count=due_count,
        has_weak=bool(weak),
        has_blockers=bool(blockers),
    )
    remaining = [action for action in candidates if action not in attempted]
    if not remaining:
        remaining = [action for action in ("deep_read", "feed_review") if action not in attempted]
    if not remaining:
        remaining = ["feed_review"]

    llm_choice = _llm_function_choice(
        diagnosis=diagnosis,
        plan=plan,
        allowed=remaining,
        focus=focus,
    )
    if llm_choice:
        return {
            **llm_choice,
            "policy": "llm_function_call",
            "context_key": focus,
            "candidates": remaining,
        }

    stats = arm_stats(context_key=focus)
    has_reward_history = any(
        int(item.get("pulls", 0)) > 0
        for item in stats
        if item.get("arm") in remaining
    )
    action = (
        profile_action
        if profile_action in remaining and not has_reward_history
        else select_arm(candidates=remaining, context_key=focus)
    )
    return {
        "action": action,
        "arguments": _default_arguments(action, focus, plan),
        "policy": (
            "profile_preference"
            if action == profile_action and not has_reward_history
            else "contextual_bandit"
        ),
        "context_key": focus,
        "candidates": remaining,
    }


def _preferred_profile_action(profile: dict[str, Any]) -> str:
    raw = profile.get("preferred_actions") or []
    if not isinstance(raw, list):
        return ""
    mapping = {
        "feynman": "feynman",
        "srs_review": "srs_due",
        "review": "srs_due",
        "save": "feed_review",
        "like": "feed_review",
        "open_source": "deep_read",
    }
    for item in raw:
        if not isinstance(item, dict) or int(item.get("count", 0)) < 2:
            continue
        action = mapping.get(str(item.get("name") or ""))
        if action:
            return action
    return ""


def _candidate_actions(
    *,
    due_count: int,
    has_weak: bool,
    has_blockers: bool,
) -> list[str]:
    if has_blockers:
        return ["deep_read", "rag_clarify", "feynman"]
    if due_count >= 8:
        return ["srs_due", "exam", "feed_review"]
    if has_weak:
        return ["feynman", "rag_clarify", "deep_read", "feed_review"]
    return ["feed_review", "deep_read", "exam"]


def _default_arguments(
    action: str,
    focus: str,
    plan: dict[str, Any],
) -> dict[str, Any]:
    first = (plan.get("steps") or [{}])[0]
    if action == "srs_due":
        return {"limit": 12}
    if action in {"feynman", "exam"}:
        return {"concept": focus}
    if action == "rag_clarify":
        return {"query": f"请解释 {focus} 的核心机制与常见误区" if focus else ""}
    if action == "deep_read":
        return {"wiki_file_name": first.get("wiki_file_name") or ""}
    return {}


def _llm_function_choice(
    *,
    diagnosis: dict[str, Any],
    plan: dict[str, Any],
    allowed: list[str],
    focus: str,
) -> dict[str, Any] | None:
    """让 LLM 通过原生 tools/function calling 选 Action；失败回退 Bandit。"""
    try:
        from app.llm import _openai_client_and_model  # noqa: PLC0415

        client, model, _ = _openai_client_and_model()
        schemas = [
            schema
            for schema in ACTION_SCHEMAS
            if schema["function"]["name"] in allowed
        ]
        prompt = {
            "goal": plan.get("goal"),
            "focus": focus,
            "due_count": diagnosis.get("due_count"),
            "weak_concepts": (diagnosis.get("weak_concepts") or [])[:5],
            "prerequisite_blockers": (
                diagnosis.get("prerequisite_blockers") or []
            )[:5],
            "profile": diagnosis.get("profile") or {},
            "recent_memory": (diagnosis.get("memory_episodes") or [])[:5],
            "error_patterns": [
                {
                    "concept": item.get("concept_label"),
                    "errors": item.get("error_patterns") or [],
                }
                for item in (diagnosis.get("weak_concepts") or [])[:5]
            ],
            "attempted_actions": diagnosis.get("attempted_actions") or [],
        }
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是教学 Policy。必须调用且只调用一个可用工具。"
                        "优先满足先修约束；避免重复已失败 Action；选择当前最可执行的动作。"
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(prompt, ensure_ascii=False),
                },
            ],
            tools=schemas,
            tool_choice="required",
            temperature=0.1,
        )
        calls = response.choices[0].message.tool_calls or []
        if not calls:
            return None
        call = calls[0]
        action = str(call.function.name)
        if action not in allowed:
            return None
        try:
            arguments = json.loads(call.function.arguments or "{}")
        except json.JSONDecodeError:
            arguments = {}
        if not isinstance(arguments, dict):
            arguments = {}
        defaults = _default_arguments(action, focus, plan)
        return {
            "action": action,
            "arguments": {**defaults, **arguments},
            "function_call_id": call.id,
        }
    except Exception as exc:  # noqa: BLE001
        logger.info("policy function calling unavailable, fallback bandit: %s", exc)
        return None
